// M5 ซื้อ + จ่ายเงิน (docs/technical-plan-M5.md) — PR/PO/AP/CNR/DNR/EXP · PV (สายอนุมัติ + 50 ทวิ) · รอบจ่าย · เงินสดย่อย
// กติกา (CLAUDE.md): หัก ณ ที่จ่ายรับรู้ตอนจ่ายเงินจริง · ออก 50 ทวิ และเข้า ภ.ง.ด.3/53 เดือนที่จ่าย · ฟรีแลนซ์ = ค่าตั้งของบริษัท "รอยืนยัน"
import { Money, post, type MoneyString } from '@innovera/ledger';
import { bahtText, FREELANCE_DEFAULT, pndOf, whtOnPayment, whtTypeFor, type FreelanceWhtConfig } from '@innovera/tax-th';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, nextNumber, postJournalTx, reserveNumber } from './ledger-service.ts';
import { docOrThrow, event, outstandingTx, prefixOf, ruleFor, totalsOf, type Actor } from './sales.ts';
import { emitTx } from './hub.ts';

export const PURCHASE_TYPES = ['PR', 'PO', 'AP', 'CNR', 'DNR', 'EXP'] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];
const NON_POSTING: readonly string[] = ['PR', 'PO'];
/**
 * วงเงินสายอนุมัติ (ค่าตั้งบริษัท acct.company_setting · ค่าตั้งต้นจากแบบร่าง/fixtures):
 * - จ่าย (ScreenPayment · fixtures PAYRUN-2569-11-28.approval.l2_limit): 1. บัญชีจัดทำ · 2. ผู้จัดการบัญชีอนุมัติ ≤ 1,000,000 · 3. กรรมการ เมื่อเกิน
 * - ใบสั่งซื้อ (ScreenPurchaseOrder · fixtures PO2611-0018.approval_limit_l2): ผู้จัดการบัญชี ≤ 300,000 · เกิน = กรรมการ · ยอด AP เกิน PO > 5% ต้องให้ผู้อนุมัติ PO ยืนยัน
 */
export const APPROVAL_DEFAULTS = { payment: { l2Limit: '1000000.00' }, purchaseOrder: { l2Limit: '300000.00', overPoTolerance: '0.05' } } as const;
export const APPROVAL_KEYS = { payment: 'approval.payment', purchaseOrder: 'approval.purchase_order' } as const;
export interface ApprovalSettings { payment: { l2Limit: MoneyString }; purchaseOrder: { l2Limit: MoneyString; overPoTolerance: string } }
const MONEY_RE = /^\d+(\.\d{1,2})?$/u;
const RATE_RE = /^0(\.\d{1,4})?$/u;
export async function approvalSettingsTx(tx: CompanyTx): Promise<ApprovalSettings> {
  const rows = await tx.selectFrom('acct.company_setting').select(['key', 'value']).where('key', 'in', Object.values(APPROVAL_KEYS)).execute();
  const get = (k: string) => (rows.find((r) => r.key === k)?.value ?? {}) as Record<string, unknown>;
  const pay = get(APPROVAL_KEYS.payment);
  const po = get(APPROVAL_KEYS.purchaseOrder);
  const m = (v: unknown, d: string) => Money.of(typeof v === 'string' && MONEY_RE.test(v) ? v : d).toString();
  return {
    payment: { l2Limit: m(pay.l2_limit, APPROVAL_DEFAULTS.payment.l2Limit) },
    purchaseOrder: { l2Limit: m(po.l2_limit, APPROVAL_DEFAULTS.purchaseOrder.l2Limit),
      overPoTolerance: typeof po.over_po_tolerance === 'string' && RATE_RE.test(po.over_po_tolerance) ? po.over_po_tolerance : APPROVAL_DEFAULTS.purchaseOrder.overPoTolerance },
  };
}
export async function approvalSettings(db: Db, companyId: string): Promise<ApprovalSettings> {
  return db.withCompany(companyId, (tx) => approvalSettingsTx(tx));
}
/** ตรวจรูปค่าตั้งสายอนุมัติก่อนบันทึก (PUT company-settings/:key) */
export function validApprovalSetting(key: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (key === APPROVAL_KEYS.payment) return typeof v.l2_limit === 'string' && MONEY_RE.test(v.l2_limit);
  if (key === APPROVAL_KEYS.purchaseOrder) return typeof v.l2_limit === 'string' && MONEY_RE.test(v.l2_limit) && (v.over_po_tolerance === undefined || (typeof v.over_po_tolerance === 'string' && RATE_RE.test(v.over_po_tolerance)));
  return false;
}

export interface PurchaseLineInput {
  lineType?: 'item' | 'heading' | 'note';
  productCode?: string | null;
  description: string;
  qty?: string;
  unitPrice?: string;
  discount?: MoneyString;
  vat?: boolean;
  accountCode?: string | null;
  whtType?: string | null;        // ประเภทเงินได้ (หักตอนจ่าย)
}
export interface PurchaseDraftInput {
  docType: PurchaseType;
  contactId: string;
  issueDate: string;
  dueDate?: string | null;
  vendorRef?: string | null;
  priceInclVat?: boolean;
  billDiscount?: MoneyString;
  refDocumentId?: string | null;  // CNR/DNR → AP · AP → PO · PO → PR
  payNow?: boolean;               // EXP จ่ายทันที
  payFrom?: string | null;        // บัญชีที่จ่ายเงินออก (EXP จ่ายทันที)
  notes?: string | null;
  reference?: string | null;
  /** ม.82/3 เดือนที่ใช้ภาษีซื้อ YYYY-MM (เดือนตามบิล ถึง +6 เดือน) · ว่าง = เดือนตามบิล */
  vatClaimMonth?: string | null;
  lines: PurchaseLineInput[];
}

async function freelanceConfig(tx: CompanyTx): Promise<FreelanceWhtConfig> {
  const s = await tx.selectFrom('acct.company_setting').select('value').where('key', '=', 'tax.wht.freelance_software_dev').executeTakeFirst();
  return (s?.value as FreelanceWhtConfig | undefined) ?? FREELANCE_DEFAULT;
}

export async function savePurchaseDraft(db: Db, companyId: string, actor: Actor, input: PurchaseDraftInput, id?: string): Promise<string> {
  if (!PURCHASE_TYPES.includes(input.docType)) throw new LedgerError('ประเภทเอกสารไม่ถูกต้อง');
  const items = input.lines.filter((l) => (l.lineType ?? 'item') === 'item');
  if (!items.length) throw new LedgerError('ต้องมีอย่างน้อย 1 รายการ');
  if (['AP', 'EXP', 'CNR', 'DNR'].includes(input.docType)) for (const l of items) if (!l.accountCode) throw new LedgerError(`บรรทัด "${l.description}" ต้องระบุบัญชีค่าใช้จ่าย`);
  if ((input.docType === 'CNR' || input.docType === 'DNR') && !input.refDocumentId) throw new LedgerError('ใบลดหนี้/เพิ่มหนี้ซื้อต้องอ้างบิลซื้อ');
  if (input.docType === 'EXP' && input.payNow && !input.payFrom) throw new LedgerError('จ่ายทันทีต้องเลือกบัญชีที่จ่ายเงินออก');
  for (const l of items) if (l.whtType) whtTypeFor(l.whtType);
  const claim = input.vatClaimMonth && input.vatClaimMonth !== input.issueDate.slice(0, 7) ? input.vatClaimMonth : null;
  if (claim) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(claim)) throw new LedgerError('เดือนที่ใช้ภาษีซื้อต้องเป็น YYYY-MM');
    const [y, m] = input.issueDate.split('-').map(Number) as [number, number];
    const max = `${Math.floor((y * 12 + m + 5) / 12)}-${String(((m + 5) % 12) + 1).padStart(2, '0')}`;
    if (claim < input.issueDate.slice(0, 7) || claim > max) throw new LedgerError('เดือนที่ใช้ภาษีซื้อเลื่อนได้ไม่เกิน 6 เดือนนับจากเดือนตามบิล (ม.82/3)');
  }
  const t = totalsOf({ lines: input.lines.map((l) => ({ ...l, vat: l.vat ?? true })), priceInclVat: input.priceInclVat ?? false, billDiscount: input.billDiscount ?? '0.00' });
  return db.withCompany(companyId, async (tx) => {
    const values = {
      doc_type: input.docType, issue_date: input.issueDate, due_date: input.dueDate ?? null, contact_id: input.contactId, price_incl_vat: input.priceInclVat ?? false,
      subtotal: t.subtotal, discount: t.discount, vat: t.vat, wht: '0.00', grand_total: t.grandTotal, bill_discount: input.billDiscount ?? '0.00', vendor_ref: input.vendorRef ?? null,
      ref_document_id: input.refDocumentId ?? null, pay_now: input.payNow ?? false, receive_account: input.payFrom ?? null, notes: input.notes ?? null, reference: input.reference ?? null,
      vat_claim_month: claim,
      rule_code: input.docType === 'AP' ? 'Credit[AP]' : input.docType === 'EXP' ? (input.payNow ? 'Cash[EXP]' : 'Credit[EXP]') : input.docType === 'CNR' ? 'CNR' : input.docType === 'DNR' ? 'DNR' : null,
      updated_at: new Date(),
    };
    let docId = id;
    if (docId) {
      const d = await docOrThrow(tx, docId);
      if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError('แก้ได้เฉพาะเอกสารร่าง — เอกสารที่ผ่านรายการแล้วแก้ได้เฉพาะข้อมูลอ้างอิง');
      await tx.updateTable('acct.document').set({ ...values, status: 'draft' }).where('id', '=', docId).execute();
      await tx.deleteFrom('acct.document_line').where('document_id', '=', docId).execute();
      await event(tx, companyId, docId, actor.userId, 'edited');
    } else {
      const r = await tx.insertInto('acct.document').values({ company_id: companyId, ...values, created_by: actor.userId, external_source: null, external_ref: null, doc_no: null, branch_code: '00000', fee: '0.00' } as never)
        .returning('id').executeTakeFirstOrThrow();
      docId = r.id;
      await event(tx, companyId, docId, actor.userId, 'created', input.refDocumentId ? { from: input.refDocumentId } : {});
    }
    let k = 0;
    for (const [i, l] of input.lines.entries()) {
      const item = (l.lineType ?? 'item') === 'item';
      await tx.insertInto('acct.document_line').values({
        company_id: companyId, document_id: docId, line_no: i + 1, line_type: l.lineType ?? 'item', product_code: l.productCode ?? null, description: l.description,
        qty: item ? l.qty! : null, unit_price: item ? l.unitPrice! : null, discount: l.discount ?? '0.00', amount: item ? t.lines[k++]!.amount : '0.00',
        vat_rate: item ? ((l.vat ?? true) ? '0.0700' : null) : null, account_code: l.accountCode ?? null, wht_type: item ? (l.whtType ?? null) : null,
      }).execute();
    }
    return docId;
  });
}

/** ภาษีหัก ณ ที่จ่ายของบิลเมื่อจ่ายจริง: ฐาน = บรรทัดที่มีประเภทเงินได้ − ใบลดหนี้ซื้อที่ลงบัญชีเดียวกัน · จ่ายบางส่วน = ตามสัดส่วน */
export async function whtForBill(tx: CompanyTx, billId: string, settle: Money) {
  const bill = await docOrThrow(tx, billId);
  const lines = await tx.selectFrom('acct.document_line').select(['amount', 'account_code', 'wht_type']).where('document_id', '=', billId).where('line_type', '=', 'item').execute();
  const cnrLines = await tx.selectFrom('acct.document as c').innerJoin('acct.document_line as l', (j) => j.onRef('l.document_id', '=', 'c.id').onRef('l.company_id', '=', 'c.company_id'))
    .select(['l.amount', 'l.account_code']).where('c.ref_document_id', '=', billId).where('c.doc_type', '=', 'CNR').where('c.status', '=', 'posted').where('l.line_type', '=', 'item').execute();
  const fl = await freelanceConfig(tx);
  const byType = new Map<string, Money>();
  for (const l of lines) {
    if (!l.wht_type) continue;
    byType.set(l.wht_type, (byType.get(l.wht_type) ?? Money.zero()).plus(Money.parse(l.amount)));
  }
  // ใบลดหนี้ซื้อ: หักจากฐานของประเภทที่บัญชีเดียวกัน
  for (const c of cnrLines) {
    const line = lines.find((l) => l.account_code === c.account_code && l.wht_type);
    if (line) byType.set(line.wht_type!, byType.get(line.wht_type!)!.minus(Money.parse(c.amount)));
  }
  const o = await outstandingTx(tx, billId);
  const full = o.outstanding.equals(settle);
  const out = [];
  for (const [type, base0] of byType) {
    const base = full ? base0 : base0.ratio(settle, o.outstanding.isZero() ? Money.parse(bill.grand_total) : o.outstanding).round();
    const t = whtTypeFor(type, fl);
    const w = whtOnPayment(base.toString(), t); // progressive → PendingAuditorError (ห้ามตัดสินแทนผู้สอบบัญชี)
    out.push({ type, label: t.label, section: t.section ?? null, base: base.toString(), rate: t.rate, amount: w.amount, pendingAuditor: w.pendingAuditor });
  }
  return out;
}

// ---------- อนุมัติ / ลงบัญชีเอกสารซื้อ ----------

/** opts.confirmOverPo: ผู้อนุมัติ PO (หรือกรรมการ) ยืนยันบิลซื้อที่ยอดรวมเกิน PO มากกว่าเกณฑ์ (ScreenPurchaseOrder) */
export async function approvePurchase(db: Db, companyId: string, actor: Actor, id: string, opts: { docNo?: string; certNos?: string[]; confirmOverPo?: boolean } = {}) {
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError(`เอกสารสถานะ ${d.status} อนุมัติไม่ได้`);
    const cfg = await approvalSettingsTx(tx);
    // ใบสั่งซื้อเกินวงเงินผู้จัดการบัญชี → กรรมการ (เจ้าของ) อนุมัติ
    if (d.doc_type === 'PO' && Money.parse(d.grand_total).gt(Money.of(cfg.purchaseOrder.l2Limit)) && actor.role !== 'owner') {
      throw new LedgerError(`ใบสั่งซื้อเกิน ${cfg.purchaseOrder.l2Limit} ต้องให้กรรมการอนุมัติ`);
    }
    const po = d.doc_type === 'AP' && d.ref_document_id ? await tx.selectFrom('acct.document').selectAll().where('id', '=', d.ref_document_id).where('doc_type', '=', 'PO').executeTakeFirst() : undefined;
    let poBilled = Money.zero();
    if (po) {
      const prev = await tx.selectFrom('acct.document').select('grand_total').where('ref_document_id', '=', po.id).where('doc_type', '=', 'AP').where('status', '=', 'posted').where('id', '<>', id).execute();
      poBilled = Money.sum(prev.map((x) => Money.parse(x.grand_total))).plus(Money.parse(d.grand_total));
      const tol = cfg.purchaseOrder.overPoTolerance;
      const cap = Money.parse(po.grand_total).plus(Money.parse(po.grand_total).times(tol).round());
      if (poBilled.gt(cap)) {
        const pct = Money.of('100.00').times(tol).round().toString().replace(/\.?0+$/u, '');
        if (!opts.confirmOverPo) throw new LedgerError(`ยอดบิลซื้อรวม ${poBilled.toString()} เกิน ${po.doc_no ?? 'PO'} (${po.grand_total}) มากกว่า ${pct}% — ต้องให้ผู้อนุมัติ PO ยืนยัน`);
        if (actor.role !== 'owner' && (!actor.userId || actor.userId !== po.approved_by)) throw new LedgerError(`ยืนยันยอดเกิน PO ได้เฉพาะผู้อนุมัติ ${po.doc_no ?? 'PO'} หรือกรรมการ`);
      }
    }
    const docNo = opts.docNo ?? d.doc_no ?? (await nextNumber(tx, companyId, await prefixOf(tx, d.doc_type), d.issue_date));
    if (opts.docNo) await reserveNumber(tx, companyId, opts.docNo);
    if (NON_POSTING.includes(d.doc_type)) {
      await tx.updateTable('acct.document').set({ status: 'approved', doc_no: docNo, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
      await event(tx, companyId, id, actor.userId, 'approved', { docNo });
      return { docNo };
    }
    // ใบลดหนี้ซื้อ: ไม่เกินมูลค่าบิลเดิม (รวมใบลดหนี้ใบอื่น) · เกินยอดค้าง (บิลจ่ายแล้ว) → ส่วนเกินเป็นเครดิตคงเหลือกับผู้ขาย (สูตร CNR[Credit])
    let cnrApplied: Money | null = null;
    let ruleCode = d.rule_code!;
    if (d.doc_type === 'CNR') {
      const bill = await docOrThrow(tx, d.ref_document_id!);
      const others = await tx.selectFrom('acct.document').select('grand_total').where('ref_document_id', '=', bill.id).where('doc_type', '=', 'CNR').where('status', '=', 'posted').execute();
      const room = Money.parse(bill.grand_total).minus(Money.sum(others.map((x) => Money.parse(x.grand_total))));
      if (Money.parse(d.grand_total).gt(room)) throw new LedgerError(`ยอดลดหนี้ต้องไม่เกินมูลค่าบิลเดิม (คงเหลือให้ลดได้ ${room.toString()})`);
      const o = await outstandingTx(tx, bill.id);
      const open = o.outstanding.gt(Money.zero()) ? o.outstanding : Money.zero();
      cnrApplied = Money.parse(d.grand_total).gt(open) ? open : Money.parse(d.grand_total);
      if (Money.parse(d.grand_total).gt(open)) ruleCode = 'CNR[Credit]';
    }
    const lines = await tx.selectFrom('acct.document_line').select(['amount', 'account_code', 'wht_type']).where('document_id', '=', id).where('line_type', '=', 'item').orderBy('line_no').execute();
    let wht = Money.zero();
    const certs: Awaited<ReturnType<typeof whtForBill>> = [];
    if (d.doc_type === 'EXP' && d.pay_now) {
      // จ่ายทันที = จุดรับรู้ WHT (ตอนจ่ายจริง)
      const fl = await freelanceConfig(tx);
      const byType = new Map<string, Money>();
      for (const l of lines) if (l.wht_type) byType.set(l.wht_type, (byType.get(l.wht_type) ?? Money.zero()).plus(Money.parse(l.amount)));
      for (const [type, base] of byType) {
        const t = whtTypeFor(type, fl);
        const w = whtOnPayment(base.toString(), t);
        certs.push({ type, label: t.label, section: t.section ?? null, base: base.toString(), rate: t.rate, amount: w.amount, pendingAuditor: w.pendingAuditor });
        wht = wht.plus(Money.of(w.amount));
      }
    }
    const { def, versionId } = await ruleFor(tx, ruleCode);
    const paid = Money.parse(d.grand_total).minus(wht);
    const jl = post(def, {
      docType: d.doc_type, amounts: { grand_total: d.grand_total, vat: d.vat, wht: wht.toString(), paid: paid.toString() },
      lines: lines.map((l) => ({ amounts: { amount: l.amount }, ...(l.account_code ? { account: l.account_code } : {}) })),
      contact: { apAccount: '2110100', ...(d.contact_id ? { id: d.contact_id } : {}) }, accounts: { ...(d.receive_account ? { cash: d.receive_account } : {}) },
    }).map((l) => (l.account === '2110100' && d.contact_id ? { ...l, contactId: d.contact_id } : l));
    const j = await postJournalTx(tx, companyId, { date: d.issue_date, lines: jl, role: actor.role, book: def.book, prefix: 'JV', description: docNo, sourceDocumentId: id, ...(versionId ? { ruleVersionId: versionId } : {}) });
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: j.id, wht: wht.toString(), rule_code: ruleCode, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    if (cnrApplied && !cnrApplied.isZero()) await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: id, document_id: d.ref_document_id!, applied: cnrApplied.toString(), wht: '0.00', wht_base: null, vat_due: '0.00', voided: false }).execute();
    // PO ปิดอัตโนมัติเมื่อรับบิลครบ
    if (po && !po.closed_at && !poBilled.lt(Money.parse(po.grand_total))) {
      await tx.updateTable('acct.document').set({ closed_at: new Date(), updated_at: new Date() }).where('id', '=', po.id).execute();
      await event(tx, companyId, po.id, actor.userId, 'edited', { closed: true, auto: true, billed: poBilled.toString(), by: id });
    }
    const issued = await issueCertificates(tx, companyId, id, d.contact_id!, d.issue_date, certs, opts.certNos);
    await event(tx, companyId, id, actor.userId, 'posted', { docNo, journalNo: j.journalNo, certificates: issued });
    await emitTx(tx, companyId, 'document.posted', { id, doc_type: d.doc_type, doc_no: docNo, external_source: d.external_source, external_ref: d.external_ref, grand_total: d.grand_total, journal_no: j.journalNo });
    return { docNo, journalNo: j.journalNo, certificates: issued };
  });
}

async function issueCertificates(tx: CompanyTx, companyId: string, paymentId: string, contactId: string, date: string, certs: Awaited<ReturnType<typeof whtForBill>>, preset?: string[]) {
  if (!certs.length) return [];
  const contact = await tx.selectFrom('acct.contact').select('tax_id').where('id', '=', contactId).executeTakeFirstOrThrow();
  const pnd = pndOf(contact.tax_id);
  // 1 ใบต่อการจ่าย 1 ครั้ง ต่อประเภทเงินได้
  const out = [];
  for (const [i, c] of certs.entries()) {
    const certNo = preset?.[i] ?? (await nextNumber(tx, companyId, 'WHT', date));
    if (preset?.[i]) await reserveNumber(tx, companyId, certNo);
    await tx.insertInto('acct.wht_certificate').values({ company_id: companyId, cert_no: certNo, payment_id: paymentId, contact_id: contactId, pnd, income_type: c.type, income_section: c.section,
      pay_date: date, base: c.base, rate: c.rate, amount: c.amount, pending_auditor: c.pendingAuditor }).execute();
    out.push({ certNo, pnd, ...c });
  }
  return out;
}

// ---------- จ่ายชำระ (ScreenPayment) ----------

export interface PaymentInput {
  contactId: string;
  date: string;
  payFrom: string;                                    // 1100100 / 1100200 / 1000100
  bills: { documentId: string; settle?: MoneyString }[];  // settle = ยอดที่ตัดจากเจ้าหนี้ (ค่าตั้งต้น = ยอดค้างทั้งหมด)
  method?: 'transfer' | 'bulk_transfer' | 'cheque' | 'cash' | 'promptpay';
  cheque?: { chequeNo: string; bank: string; chequeDate: string } | null;
  /** ใช้เครดิตคงเหลือกับผู้ขาย (ใบลดหนี้ซื้อที่เกินยอดค้าง · CNR[Credit]) หักจากเงินที่ต้องจ่าย · amount ค่าตั้งต้น = เครดิตคงเหลือทั้งหมด (ไม่เกินยอดจ่าย) */
  credits?: { documentId: string; amount?: MoneyString }[];
  batchRef?: string | null;
  notes?: string | null;
  docNo?: string;
}

export const PAYMENT_METHODS: readonly NonNullable<PaymentInput['method']>[] = ['transfer', 'bulk_transfer', 'cheque', 'cash', 'promptpay'];

/**
 * เครดิตคงเหลือกับผู้ขาย: ใบลดหนี้ซื้อที่ลงบัญชีแล้ว − ส่วนที่ตัดบิลเดิม − ส่วนที่ใช้ในใบสำคัญจ่าย (รวมใบที่รออนุมัติ เพื่อกันใช้ซ้ำ)
 * = ยอดเดบิตของผู้ขายในบัญชีเจ้าหนี้ 2110100 ที่ยังไม่ได้หักกับบิลใด
 */
export async function vendorCreditsTx(tx: CompanyTx, contactId?: string) {
  let q = tx.selectFrom('acct.document as c').select(['c.id', 'c.doc_no', 'c.contact_id', 'c.issue_date', 'c.grand_total', 'c.ref_document_id',
    sql<string>`coalesce((select sum(s.applied) from acct.settlement s where s.company_id = c.company_id and s.payment_id = c.id and not s.voided), 0)`.as('applied'),
    sql<string>`coalesce((select sum(s.applied) from acct.settlement s join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
      where s.company_id = c.company_id and s.document_id = c.id and (not s.voided or p.status = 'pending_approval')), 0)`.as('used')])
    .where('c.doc_type', '=', 'CNR').where('c.status', '=', 'posted');
  if (contactId) q = q.where('c.contact_id', '=', contactId);
  const out = [];
  for (const r of await q.orderBy('c.issue_date').execute()) {
    const remaining = Money.parse(r.grand_total).minus(Money.parse(r.applied)).minus(Money.parse(r.used));
    if (remaining.gt(Money.zero())) out.push({ id: r.id, doc_no: r.doc_no, contact_id: r.contact_id, issue_date: r.issue_date, grand_total: r.grand_total, ref_document_id: r.ref_document_id, remaining: remaining.toString() });
  }
  return out;
}
export async function vendorCredits(db: Db, companyId: string, contactId?: string) {
  return db.withCompany(companyId, (tx) => vendorCreditsTx(tx, contactId));
}

/** สร้างใบสำคัญจ่าย (รออนุมัติ) — ยังไม่ลงบัญชีจนผ่านสายอนุมัติ · ภาษีหักคำนวณไว้ ณ วันที่จ่าย */
export async function createPayment(db: Db, companyId: string, actor: Actor, input: PaymentInput) {
  if (!input.bills.length) throw new LedgerError('เลือกบิลอย่างน้อย 1 ใบ');
  if (input.method && !PAYMENT_METHODS.includes(input.method)) throw new LedgerError('วิธีจ่ายไม่ถูกต้อง');
  return db.withCompany(companyId, async (tx) => {
    let settled = Money.zero();
    let wht = Money.zero();
    const rows = [];
    for (const b of input.bills) {
      const o = await outstandingTx(tx, b.documentId);
      if (o.doc.status !== 'posted' || !['AP', 'EXP', 'DNR'].includes(o.doc.doc_type)) throw new LedgerError('จ่ายได้เฉพาะบิลซื้อ/ค่าใช้จ่ายที่ลงบัญชีแล้ว');
      if (o.doc.pay_now) throw new LedgerError(`${o.doc.doc_no} จ่ายไปแล้วตอนบันทึก (จ่ายทันที) — จ่ายซ้ำไม่ได้`);
      if (o.doc.contact_id !== input.contactId) throw new LedgerError(`${o.doc.doc_no} ไม่ใช่ของผู้ขายรายนี้`);
      const settle = b.settle ? Money.of(b.settle) : o.outstanding;
      if (settle.gt(o.outstanding) || !settle.gt(Money.zero())) throw new LedgerError(`${o.doc.doc_no}: ยอดจ่ายต้องไม่เกินยอดค้าง ${o.outstanding.toString()}`);
      const w = await whtForBill(tx, b.documentId, settle);
      const billWht = Money.sum(w.map((x) => Money.of(x.amount as MoneyString)));
      settled = settled.plus(settle);
      wht = wht.plus(billWht);
      rows.push({ b, settle, w, billWht });
    }
    // เครดิตคงเหลือกับผู้ขาย (CNR[Credit]) หักจากเงินที่ต้องจ่าย — ฐานภาษีหัก ณ ที่จ่ายของบิลที่จ่ายครั้งนี้ไม่เปลี่ยน
    // TODO(Wei): บิลเดิมที่จ่ายไปแล้วถูกหัก ณ ที่จ่ายจากฐานก่อนลดหนี้ — จะปรับ 50 ทวิ/ภ.ง.ด. ของเดือนที่จ่ายเดิมหรือไม่ ต้องให้ผู้สอบบัญชียืนยัน (ระบบไม่ปรับให้)
    const available = input.credits?.length ? await vendorCreditsTx(tx, input.contactId) : [];
    const credits: { documentId: string; amount: Money }[] = [];
    let room = settled.minus(wht);
    for (const c of input.credits ?? []) {
      const cr = available.find((x) => x.id === c.documentId);
      if (!cr) throw new LedgerError('ไม่พบเครดิตคงเหลือของผู้ขายรายนี้ (ใบลดหนี้ซื้อ)');
      const rem = Money.parse(cr.remaining);
      const amt = c.amount ? Money.of(c.amount) : (rem.gt(room) ? room : rem);
      if (!amt.gt(Money.zero()) || amt.gt(rem)) throw new LedgerError(`${cr.doc_no ?? 'CNR'}: ใช้เครดิตได้ไม่เกิน ${rem.toString()}`);
      if (amt.gt(room)) throw new LedgerError('เครดิตที่ใช้ต้องไม่เกินยอดที่ต้องจ่าย');
      room = room.minus(amt);
      credits.push({ documentId: cr.id, amount: amt });
    }
    const credit = Money.sum(credits.map((c) => c.amount));
    const paid = settled.minus(wht).minus(credit);
    const pv = await tx.insertInto('acct.document').values({
      company_id: companyId, doc_type: 'PV', doc_no: input.docNo ?? null, status: 'pending_approval', issue_date: input.date, due_date: null, contact_id: input.contactId, price_incl_vat: false,
      subtotal: settled.toString(), discount: '0.00', vat: '0.00', wht: wht.toString(), grand_total: paid.toString(), receive_account: input.payFrom, rule_code: 'Pay[PV]',
      batch_ref: input.batchRef ?? null, notes: input.notes ?? null, reference: input.method ?? 'transfer', created_by: actor.userId, external_source: null, external_ref: null, branch_code: '00000', fee: '0.00', bill_discount: '0.00',
    } as never).returning('id').executeTakeFirstOrThrow();
    for (const r of rows) {
      // voided = true จนกว่าจะอนุมัติ (ยังไม่ตัดเจ้าหนี้)
      await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: pv.id, document_id: r.b.documentId, applied: r.settle.minus(r.billWht).toString(), wht: r.billWht.toString(),
        wht_base: r.w.length ? Money.sum(r.w.map((x) => Money.of(x.base as MoneyString))).toString() : null, vat_due: '0.00', voided: true }).execute();
    }
    for (const c of credits) {
      await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: pv.id, document_id: c.documentId, applied: c.amount.toString(), wht: '0.00', wht_base: null, vat_due: '0.00', voided: true }).execute();
    }
    if (input.cheque) await tx.insertInto('acct.cheque').values({ company_id: companyId, direction: 'issued', cheque_no: input.cheque.chequeNo, bank: input.cheque.bank, branch: null,
      cheque_date: input.cheque.chequeDate, amount: paid.toString(), status: 'issued', document_id: pv.id, contact_id: input.contactId, deposited_on: null, cleared_on: null }).execute();
    await event(tx, companyId, pv.id, actor.userId, 'submitted', { settled: settled.toString(), wht: wht.toString(), paid: paid.toString(), ...(credits.length ? { credit: credit.toString() } : {}) });
    return { id: pv.id, settled: settled.toString(), wht: wht.toString(), credit: credit.toString(), paid: paid.toString(), amountText: bahtText(paid.toString() as MoneyString), bills: rows.map((r) => ({ documentId: r.b.documentId, settle: r.settle.toString(), wht: r.w })) };
  });
}

/**
 * อนุมัติจ่าย (สายอนุมัติ ScreenPayment): 1. บัญชีจัดทำ (ผู้สร้าง) · 2. ผู้จัดการบัญชี (≤ วงเงินขั้น 2) · 3. กรรมการ (เจ้าของ) เมื่อยอดรอบจ่ายเกินวงเงินขั้น 2
 * - ยอดที่เทียบวงเงินขั้น 2 = ยอดจ่ายรวมของรอบจ่าย (batch_ref เดียวกัน ไม่นับใบที่ยกเลิก) · ไม่มีรอบ = ยอดใบนี้
 * - เกินวงเงิน: อนุมัติครั้งแรก = ขั้น 2 (approval_level = 2 ยังไม่ลงบัญชี) · ครั้งที่สอง = ขั้น 3 โดยกรรมการคนละคนกับขั้น 2 → ลงบัญชี (approval_level = 3)
 * - ไม่เกิน: อนุมัติครั้งเดียว → ลงบัญชี (approval_level = 2)
 * - วงเงินผู้อนุมัติ (approval_limit ใน membership · null = ไม่จำกัด): ขั้น 2 ของใบที่ต้องมีกรรมการ เทียบกับ min(ยอดใบ, วงเงินขั้น 2)
 * แบ่งหน้าที่ (SoD · ScreenUserEdit): ผู้สร้างใบสำคัญจ่ายอนุมัติใบของตนเองไม่ได้ทุกขั้น · ผ่านแล้วลงบัญชี + ออก 50 ทวิ
 */
export async function approvePayment(db: Db, companyId: string, actor: Actor & { approvalLimit: string | null }, id: string, opts: { docNo?: string; certNos?: string[] } = {}) {
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.doc_type !== 'PV' || d.status !== 'pending_approval') throw new LedgerError('อนุมัติได้เฉพาะใบสำคัญจ่ายที่รออนุมัติ');
    if (actor.userId && d.created_by === actor.userId) throw new LedgerError('ผู้สร้างใบสำคัญจ่ายอนุมัติใบของตนเองไม่ได้ (แบ่งหน้าที่)');
    const cfg = await approvalSettingsTx(tx);
    const l2 = Money.of(cfg.payment.l2Limit);
    const amount = Money.parse(d.grand_total);
    const runTotal = d.batch_ref
      ? Money.sum((await tx.selectFrom('acct.document').select('grand_total').where('doc_type', '=', 'PV').where('batch_ref', '=', d.batch_ref).where('status', '<>', 'voided').execute()).map((x) => Money.parse(x.grand_total)))
      : amount;
    const needsDirector = runTotal.gt(l2);
    const overLimit = (cap: Money) => actor.approvalLimit !== null && cap.gt(Money.parse(actor.approvalLimit));
    if (needsDirector && d.approval_level < 2) {
      // ขั้น 2: ผู้จัดการบัญชีอนุมัติ — ยังไม่ลงบัญชีจนกรรมการอนุมัติ
      if (overLimit(amount.gt(l2) ? l2 : amount)) throw new LedgerError(`ยอดจ่ายเกินวงเงินอนุมัติของคุณ (${actor.approvalLimit})`);
      await tx.updateTable('acct.document').set({ approval_level: 2, updated_at: new Date() }).where('id', '=', id).execute();
      // เหตุการณ์ 'approved' ที่ detail.level = 2 (ยังไม่ลงบัญชี) — ชื่อเหตุการณ์จำกัดตาม CHECK ของ document_event
      await event(tx, companyId, id, actor.userId, 'approved', { level: 2, posted: false, runTotal: runTotal.toString(), l2Limit: l2.toString() });
      const none: Awaited<ReturnType<typeof issueCertificates>> = [];
      return { level: 2, posted: false, needsDirector, docNo: d.doc_no, journalNo: null, certificates: none };
    }
    if (needsDirector) {
      // ขั้น 3: กรรมการ (เจ้าของ) คนละคนกับผู้อนุมัติขั้น 2
      if (actor.role !== 'owner') throw new LedgerError(`ยอดรอบจ่ายเกิน ${l2.toString()} ต้องให้กรรมการอนุมัติ (ขั้นที่ 3)`);
      const l2ev = await tx.selectFrom('acct.document_event').select('actor').where('document_id', '=', id).where('event', '=', 'approved')
        .where(sql<boolean>`detail->>'level' = '2'`).orderBy('at', 'desc').executeTakeFirst();
      if (actor.userId && l2ev?.actor === actor.userId) throw new LedgerError('ผู้อนุมัติแต่ละขั้นต้องเป็นคนละคน (แบ่งหน้าที่)');
    }
    if (overLimit(amount)) throw new LedgerError(`ยอดจ่ายเกินวงเงินอนุมัติของคุณ (${actor.approvalLimit})`);
    const level = needsDirector ? 3 : 2;
    const docNo = opts.docNo ?? d.doc_no ?? (await nextNumber(tx, companyId, await prefixOf(tx, 'PV'), d.issue_date));
    if (opts.docNo) await reserveNumber(tx, companyId, opts.docNo);
    const all = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as b', (j) => j.onRef('b.id', '=', 's.document_id').onRef('b.company_id', '=', 's.company_id'))
      .selectAll('s').select('b.doc_type').where('s.payment_id', '=', id).execute();
    const settlements = all.filter((s) => s.doc_type !== 'CNR');
    const credit = Money.sum(all.filter((s) => s.doc_type === 'CNR').map((s) => Money.parse(s.applied)));
    // เครดิตผู้ขายหักกันในบัญชีเจ้าหนี้เอง → Dr เจ้าหนี้ = ยอดตัดบิล − เครดิตที่ใช้
    const settled = Money.sum(settlements.map((s) => Money.parse(s.applied).plus(Money.parse(s.wht)))).minus(credit);
    const { def, versionId } = await ruleFor(tx, 'Pay[PV]');
    const jl = post(def, { docType: 'PV', amounts: { settled: settled.toString(), paid: d.grand_total, wht: d.wht }, contact: { apAccount: '2110100', id: d.contact_id! }, accounts: { cash: d.receive_account! } })
      .map((l) => (l.account === '2110100' ? { ...l, contactId: d.contact_id! } : l));
    const j = await postJournalTx(tx, companyId, { date: d.issue_date, lines: jl, role: actor.role, book: 'PV', prefix: 'JV', description: docNo, sourceDocumentId: id, ...(versionId ? { ruleVersionId: versionId } : {}) });
    // คำนวณ 50 ทวิ ก่อนตัดเจ้าหนี้ (ยอดค้างยังเป็นยอดก่อนจ่าย)
    // 50 ทวิ ต่อประเภทเงินได้ (รวมทุกบิลในใบสำคัญจ่ายนี้)
    const certs = new Map<string, Awaited<ReturnType<typeof whtForBill>>[number]>();
    for (const s of settlements) {
      for (const w of await whtForBill(tx, s.document_id, Money.parse(s.applied).plus(Money.parse(s.wht)))) {
        const cur = certs.get(w.type);
        certs.set(w.type, cur ? { ...cur, base: Money.of(cur.base as MoneyString).plus(Money.of(w.base as MoneyString)).toString(), amount: Money.of(cur.amount as MoneyString).plus(Money.of(w.amount as MoneyString)).toString() } : w);
      }
    }
    await tx.updateTable('acct.settlement').set({ voided: false }).where('payment_id', '=', id).execute();
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: j.id, approved_by: actor.userId, approved_at: new Date(), approval_level: level, updated_at: new Date() }).where('id', '=', id).execute();
    const issued = await issueCertificates(tx, companyId, id, d.contact_id!, d.issue_date, [...certs.values()], opts.certNos);
    await event(tx, companyId, id, actor.userId, 'approved', { level, docNo, journalNo: j.journalNo, certificates: issued.map((c) => c.certNo) });
    await emitTx(tx, companyId, 'payment.paid', { id, doc_no: docNo, contact_id: d.contact_id, paid: d.grand_total, wht: d.wht, certificates: issued.map((c) => c.certNo),
      bills: settlements.map((x) => ({ document_id: x.document_id, applied: x.applied, wht: x.wht })), ...(credit.isZero() ? {} : { vendor_credit: credit.toString() }) });
    return { level, posted: true, needsDirector, docNo, journalNo: j.journalNo, certificates: issued };
  });
}

/**
 * ไฟล์โอนชุด (ScreenPayment "สร้างไฟล์โอนชุดสำหรับ [ธนาคาร A] (รูปแบบ Bulk Payment)") — 1 บรรทัดต่อใบสำคัญจ่ายที่อนุมัติแล้วในรอบจ่าย
 * TODO(Wei): ยังไม่มี spec รูปแบบไฟล์ Bulk Payment ของธนาคาร — ตอนนี้เป็น CSV กลาง (ลำดับ, ชื่อผู้รับ, ธนาคาร, เลขบัญชี, จำนวนเงิน, อ้างอิง) ต้องยืนยันกับ spec ธนาคารจริง
 * บัญชีรับโอนจากทะเบียนผู้ติดต่อ (contact.bank_account ข้อความเดียว "ธนาคาร เลขบัญชี") · มีผู้ขายที่ยังไม่มีบัญชีธนาคาร → ไม่สร้างไฟล์
 */
export async function bulkPaymentFile(db: Db, companyId: string, batchRef: string) {
  return db.withCompany(companyId, async (tx) => {
    const rows = await tx.selectFrom('acct.document as d').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .select(['d.doc_no', 'd.grand_total', 'd.receive_account', 'c.code', 'c.name', 'c.bank_account'])
      .where('d.doc_type', '=', 'PV').where('d.batch_ref', '=', batchRef).where('d.status', '=', 'posted').where('d.grand_total', '>', '0').orderBy('d.doc_no').execute();
    if (!rows.length) throw new LedgerError('ไม่มีใบสำคัญจ่ายที่อนุมัติแล้วในรอบจ่ายนี้');
    const missing = rows.filter((r) => !r.bank_account?.trim());
    if (missing.length) throw new LedgerError(`ผู้ขายยังไม่มีบัญชีธนาคาร: ${missing.map((r) => `${r.code} ${r.name}`).join(', ')}`);
    const q = (v: string) => (/[",\r\n]/u.test(v) ? `"${v.replace(/"/gu, '""')}"` : v);
    const lines = ['seq,payee_name,bank,account_no,amount,reference'];
    for (const [i, r] of rows.entries()) {
      const text = r.bank_account!.trim();
      const m = /^(.*\S)\s+([0-9xX][0-9xX-]*)$/u.exec(text);
      lines.push([String(i + 1), r.name, m ? m[1]! : '', m ? m[2]! : text, r.grand_total, r.doc_no ?? ''].map(q).join(','));
    }
    const total = Money.sum(rows.map((r) => Money.parse(r.grand_total))).toString();
    return { filename: `bulk-${batchRef}.csv`, content: `${lines.join('\r\n')}\r\n`, count: rows.length, total, payFrom: rows[0]!.receive_account };
  });
}

/** รอบจ่าย (PAYRUN): บิลที่เลือก → ใบสำคัญจ่าย 1 ใบต่อผู้ขาย (รออนุมัติทั้งชุด) */
export async function createPaymentRun(db: Db, companyId: string, actor: Actor, input: { date: string; payFrom: string; billIds: string[]; batchRef: string; method?: PaymentInput['method'] }) {
  const bills = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.document').select(['id', 'contact_id', 'doc_no']).where('id', 'in', input.billIds).execute());
  const byVendor = new Map<string, string[]>();
  for (const id of input.billIds) {
    const b = bills.find((x) => x.id === id);
    if (!b?.contact_id) throw new LedgerError('ไม่พบบิล');
    byVendor.set(b.contact_id, [...(byVendor.get(b.contact_id) ?? []), id]);
  }
  const vouchers: Awaited<ReturnType<typeof createPayment>>[] = [];
  for (const [contactId, ids] of byVendor) {
    vouchers.push(await createPayment(db, companyId, actor, { contactId, date: input.date, payFrom: input.payFrom, bills: ids.map((documentId) => ({ documentId })), method: input.method ?? 'bulk_transfer', batchRef: input.batchRef }));
  }
  const sum = (k: 'settled' | 'wht' | 'paid') => Money.sum(vouchers.map((v) => Money.of(v[k] as MoneyString))).toString();
  return { batchRef: input.batchRef, vouchers, selectedTotal: sum('settled'), totalWht: sum('wht'), paidTotal: sum('paid') };
}

/** บิลค้างจ่ายของผู้ขาย / ทั้งหมด (เรียงตามครบกำหนด) — ScreenPayment */
export async function payables(db: Db, companyId: string, contactId?: string) {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.document as d').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.due_date', 'd.grand_total', 'd.vendor_ref', 'c.id as contact_id', 'c.code as contact_code', 'c.name as contact_name', 'c.bank_account'])
      .where('d.doc_type', 'in', ['AP', 'EXP', 'DNR']).where('d.status', '=', 'posted').where('d.pay_now', '=', false); // จ่ายทันทีไม่มียอดค้าง
    if (contactId) q = q.where('d.contact_id', '=', contactId);
    const out = [];
    for (const r of await q.execute()) {
      const o = await outstandingTx(tx, r.id);
      if (!o.outstanding.gt(Money.zero())) continue;
      const w = await whtForBill(tx, r.id, o.outstanding).catch((e: Error) => [{ type: 'error', label: e.message, section: null, base: '0.00', rate: '0', amount: '0.00', pendingAuditor: true }]);
      out.push({ ...r, outstanding: o.outstanding.toString(), wht: w });
    }
    return out.sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date));
  });
}

export async function whtCertificates(db: Db, companyId: string, f: { from?: string; to?: string; pnd?: '3' | '53' } = {}) {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.wht_certificate as w').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'w.contact_id').onRef('c.company_id', '=', 'w.company_id'))
      .innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 'w.payment_id').onRef('p.company_id', '=', 'w.company_id'))
      .select(['w.id', 'w.cert_no', 'w.pnd', 'w.income_type', 'w.income_section', 'w.pay_date', 'w.base', 'w.rate', 'w.amount', 'w.pending_auditor', 'w.voided', 'c.code', 'c.name', 'c.tax_id', 'p.doc_no as payment_no', 'p.id as payment_id'])
      .orderBy('w.pay_date').orderBy('w.cert_no');
    if (f.from) q = q.where('w.pay_date', '>=', f.from);
    if (f.to) q = q.where('w.pay_date', '<=', f.to);
    if (f.pnd) q = q.where('w.pnd', '=', f.pnd);
    return q.execute();
  });
}

export async function setCompanySetting(db: Db, companyId: string, key: string, value: unknown) {
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.company_setting').values({ company_id: companyId, key, value: JSON.stringify(value), updated_at: new Date() })
    .onConflict((oc) => oc.columns(['company_id', 'key']).doUpdateSet({ value: JSON.stringify(value), updated_at: new Date() })).execute());
}

// ---------- เงินสดย่อยแบบ imprest (ScreenPettyCash) ----------
// รายการย่อย (PC) ไม่ลง GL จนกว่าจะเบิกชดเชย → 1 journal: Dr ค่าใช้จ่ายตามบัญชี · Dr ภาษีซื้อ (เฉพาะใบกำกับเต็มรูป) · Cr ธนาคาร · Cr 2150300 (ถ้ามีหัก ณ ที่จ่าย)
// หลายกอง (acct.petty_cash_fund): รายการ PC ระบุกอง · ไม่ระบุ = กองตั้งต้น (is_default) · ยังไม่ตั้งกองเลย = กองเดียวแบบเดิม (วงเงิน = ยอด GL 1000200)
// TODO(Wei): fixtures petty_cash.reimburse_journal ไม่มีบรรทัดภาษีหักของ PC2611-005 (45.00 · ภ.ง.ด.3) — ระบบลงตามกติกา "หักตอนจ่ายจริง"
export const PETTY_CASH_ACCOUNT = '1000200';
export interface PettyCashInput {
  date: string; description: string; accountCode: string; amount: MoneyString;   // amount = ยอดตามหลักฐาน (รวม VAT)
  vatMode: 'none' | 'abbreviated_no_claim' | 'full_invoice'; inputVat?: MoneyString | null;
  whtType?: string | null; contactId?: string | null;                          // ผู้รับเงินที่ถูกหัก ณ ที่จ่าย (ต้องมีเพื่อออก 50 ทวิ)
  evidence: string; paidBy: string; docNo?: string;
  fundId?: string | null;                                                        // กองเงินสดย่อย (ว่าง = กองตั้งต้น)
}
export interface PettyCashFundInput { code: string; name: string; holder?: string | null; imprest: MoneyString; glAccount?: string; isDefault?: boolean }

type Fund = { id: string; code: string; name: string; holder: string | null; imprest: string; gl_account: string; is_default: boolean };
async function fundsTx(tx: CompanyTx): Promise<Fund[]> {
  return tx.selectFrom('acct.petty_cash_fund').select(['id', 'code', 'name', 'holder', 'imprest', 'gl_account', 'is_default']).where('active', '=', true)
    .orderBy('is_default', 'desc').orderBy('code').execute();
}
/** กองที่เลือก · ไม่ระบุ = กองตั้งต้น · ยังไม่มีกอง = null (กองเดียวแบบเดิม) */
async function fundOf(tx: CompanyTx, fundId?: string | null): Promise<Fund | null> {
  const funds = await fundsTx(tx);
  if (fundId) {
    const f = funds.find((x) => x.id === fundId);
    if (!f) throw new LedgerError('ไม่พบกองเงินสดย่อย');
    return f;
  }
  return funds[0] ?? null;
}
/** เงื่อนไขรายการ PC ของกอง (alias d) · กองตั้งต้นรวมรายการเดิมที่ไม่ระบุกอง */
const fundCond = (f: Fund | null) => (!f ? sql<boolean>`true` : f.is_default ? sql<boolean>`(d.petty_cash_fund_id = ${f.id} or d.petty_cash_fund_id is null)` : sql<boolean>`d.petty_cash_fund_id = ${f.id}`);

export async function createPettyCashFund(db: Db, companyId: string, input: PettyCashFundInput) {
  if (!input.code.trim() || !input.name.trim()) throw new LedgerError('ต้องระบุรหัสและชื่อกอง');
  if (!Money.of(input.imprest).gt(Money.zero())) throw new LedgerError('วงเงินกองต้องมากกว่า 0');
  return db.withCompany(companyId, async (tx) => {
    const first = !(await fundsTx(tx)).length;
    const makeDefault = first || Boolean(input.isDefault);
    if (makeDefault) await tx.updateTable('acct.petty_cash_fund').set({ is_default: false }).where('is_default', '=', true).execute();
    // TODO(Wei): ตั้งกองใหม่ยังไม่ลงบัญชีเบิกเงินตั้งกอง (Dr 1000200 / Cr ธนาคาร) — แบบร่างไม่ได้กำหนด · ลงด้วยสมุดรายวันแยก
    const r = await tx.insertInto('acct.petty_cash_fund').values({ company_id: companyId, code: input.code.trim(), name: input.name.trim(), holder: input.holder?.trim() || null,
      imprest: Money.of(input.imprest).toString(), gl_account: input.glAccount ?? PETTY_CASH_ACCOUNT, is_default: makeDefault }).returning('id').executeTakeFirstOrThrow();
    return { id: r.id };
  });
}

export async function savePettyCash(db: Db, companyId: string, actor: Actor, input: PettyCashInput) {
  if (input.whtType && !input.contactId) throw new LedgerError('รายการที่หัก ณ ที่จ่ายต้องระบุผู้รับเงิน (เพื่อออก 50 ทวิ)');
  const vat = input.vatMode === 'full_invoice' ? Money.of(input.inputVat ?? '0.00') : Money.zero();
  return db.withCompany(companyId, async (tx) => {
    const fund = input.fundId ? await fundOf(tx, input.fundId) : null;
    const docNo = input.docNo ?? (await nextNumber(tx, companyId, 'PC', input.date, 3));
    if (input.docNo) await reserveNumber(tx, companyId, input.docNo);
    const d = await tx.insertInto('acct.document').values({
      company_id: companyId, doc_type: 'PC', doc_no: docNo, status: 'approved', issue_date: input.date, due_date: null, contact_id: input.contactId ?? null, price_incl_vat: true,
      subtotal: Money.of(input.amount).minus(vat).toString(), discount: '0.00', vat: vat.toString(), wht: '0.00', grand_total: input.amount, reference: input.evidence, notes: input.paidBy,
      tax_mode: null, rule_code: null, created_by: actor.userId, approved_by: actor.userId, approved_at: new Date(), external_source: null, external_ref: null, branch_code: '00000', fee: '0.00', bill_discount: '0.00',
      receive_account: fund?.gl_account ?? PETTY_CASH_ACCOUNT, vendor_ref: input.vatMode, petty_cash_fund_id: fund?.id ?? null,
    } as never).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('acct.document_line').values({ company_id: companyId, document_id: d.id, line_no: 1, line_type: 'item', product_code: null, description: input.description, qty: '1',
      unit_price: Money.of(input.amount).minus(vat).toString(), discount: '0.00', amount: Money.of(input.amount).minus(vat).toString(), vat_rate: vat.isZero() ? null : '0.0700', account_code: input.accountCode, wht_type: input.whtType ?? null }).execute();
    return { id: d.id, docNo };
  });
}
export async function pettyCashSummary(db: Db, companyId: string, fundId?: string | null) {
  return db.withCompany(companyId, async (tx) => {
    const funds = await fundsTx(tx);
    const fund = await fundOf(tx, fundId);
    const account = fund?.gl_account ?? PETTY_CASH_ACCOUNT;
    const gl = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(sql<string>`coalesce(sum(l.debit) - sum(l.credit), 0)`.as('b')).where('l.account_code', '=', account).where('j.status', '<>', 'draft').executeTakeFirstOrThrow();
    const items = await tx.selectFrom('acct.document as d').innerJoin('acct.document_line as l', (j) => j.onRef('l.document_id', '=', 'd.id').onRef('l.company_id', '=', 'd.company_id'))
      .leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_no', 'd.issue_date', 'd.grand_total', 'd.vat', 'd.reference as evidence', 'd.notes as paid_by', 'd.vendor_ref as vat_mode', 'd.batch_ref', 'l.description', 'l.account_code', 'l.wht_type', 'c.name as payee'])
      .where('d.doc_type', '=', 'PC').where('d.status', '=', 'approved').where(fundCond(fund)).orderBy('d.issue_date').orderBy('d.doc_no').execute();
    const pending = items.filter((i) => !i.batch_ref);
    const spent = Money.sum(pending.map((i) => Money.parse(i.grand_total)));
    // วงเงิน: ตามทะเบียนกอง · ยังไม่ตั้งกอง = ยอด GL ของบัญชีเงินสดย่อย (imprest คงที่)
    const imprest = fund ? Money.parse(fund.imprest) : Money.parse(gl.b);
    const last = fund ? await tx.selectFrom('acct.petty_cash_count').select(['count_date', 'counted_at', 'counted_by', 'counted_by_name', 'cash_counted', 'vouchers', 'imprest', 'difference'])
      .where('fund_id', '=', fund.id).orderBy('counted_at', 'desc').executeTakeFirst() : undefined;
    return {
      account, imprest: imprest.toString(), glBalance: Money.parse(gl.b).toString(), spentPending: spent.toString(), onHand: imprest.minus(spent).toString(),
      inputVatPending: Money.sum(pending.map((i) => Money.parse(i.vat))).toString(), items,
      fund: fund ? { id: fund.id, code: fund.code, name: fund.name, holder: fund.holder, imprest: fund.imprest, isDefault: fund.is_default } : null,
      funds: funds.map((f) => ({ id: f.id, code: f.code, name: f.name, holder: f.holder, imprest: f.imprest, isDefault: f.is_default })),
      lastCount: last ?? null,
    };
  });
}
/** นับเงิน / ตรวจกอง: ผลต่าง = เงินสดนับได้ + ใบสำคัญจ่ายที่รอเบิกชดเชย − วงเงิน (0 = ตรงกัน) */
export async function countPettyCash(db: Db, companyId: string, actor: Actor, p: { fundId?: string | null; date: string; cashCounted: MoneyString; countedByName?: string | null; note?: string | null }) {
  const cash = Money.of(p.cashCounted);
  if (cash.isNegative()) throw new LedgerError('เงินสดนับได้ต้องไม่ติดลบ');
  return db.withCompany(companyId, async (tx) => {
    const fund = await fundOf(tx, p.fundId);
    if (!fund) throw new LedgerError('ยังไม่ได้ตั้งกองเงินสดย่อย');
    const pending = await tx.selectFrom('acct.document as d').select('d.grand_total').where('d.doc_type', '=', 'PC').where('d.status', '=', 'approved').where('d.batch_ref', 'is', null).where(fundCond(fund)).execute();
    const vouchers = Money.sum(pending.map((i) => Money.parse(i.grand_total)));
    const difference = cash.plus(vouchers).minus(Money.parse(fund.imprest));
    await tx.insertInto('acct.petty_cash_count').values({ company_id: companyId, fund_id: fund.id, count_date: p.date, counted_by: actor.userId, counted_by_name: p.countedByName?.trim() || null,
      cash_counted: cash.toString(), vouchers: vouchers.toString(), imprest: fund.imprest, difference: difference.toString(), note: p.note ?? null }).execute();
    return { fundId: fund.id, cashCounted: cash.toString(), vouchers: vouchers.toString(), imprest: Money.parse(fund.imprest).toString(), difference: difference.toString(), balanced: difference.isZero() };
  });
}
/** เบิกชดเชย: รายการที่ยังไม่เบิกของกองนี้ → 1 journal + 50 ทวิ ของรายการที่หัก ณ ที่จ่าย · วงเงินกองคงที่ */
export async function reimbursePettyCash(db: Db, companyId: string, actor: Actor, p: { date: string; payFrom: string; batchRef?: string; fundId?: string | null }) {
  return db.withCompany(companyId, async (tx) => {
    const fund = await fundOf(tx, p.fundId);
    const items = await tx.selectFrom('acct.document as d').innerJoin('acct.document_line as l', (j) => j.onRef('l.document_id', '=', 'd.id').onRef('l.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_no', 'd.contact_id', 'd.grand_total', 'd.vat', 'l.amount', 'l.account_code', 'l.wht_type']).where('d.doc_type', '=', 'PC').where('d.status', '=', 'approved').where('d.batch_ref', 'is', null).where(fundCond(fund)).execute();
    if (!items.length) throw new LedgerError('ไม่มีรายการรอเบิกชดเชย');
    const fl = await freelanceConfig(tx);
    const byAcc = new Map<string, Money>();
    let vat = Money.zero();
    let wht = Money.zero();
    const certs: { item: (typeof items)[number]; w: Awaited<ReturnType<typeof whtForBill>>[number] }[] = [];
    for (const i of items) {
      byAcc.set(i.account_code!, (byAcc.get(i.account_code!) ?? Money.zero()).plus(Money.parse(i.amount)));
      vat = vat.plus(Money.parse(i.vat));
      if (i.wht_type) {
        const t = whtTypeFor(i.wht_type, fl);
        const w = whtOnPayment(i.amount, t);
        wht = wht.plus(Money.of(w.amount));
        certs.push({ item: i, w: { type: i.wht_type, label: t.label, section: t.section ?? null, base: i.amount, rate: t.rate, amount: w.amount, pendingAuditor: w.pendingAuditor } });
      }
    }
    const total = Money.sum(items.map((i) => Money.parse(i.grand_total)));
    const lines = [
      ...[...byAcc].map(([account, amount]) => ({ side: 'Dr' as const, account, amount })),
      ...(vat.isZero() ? [] : [{ side: 'Dr' as const, account: '1170100', amount: vat }]),
      { side: 'Cr' as const, account: p.payFrom, amount: total.minus(wht) },
      ...(wht.isZero() ? [] : [{ side: 'Cr' as const, account: '2150300', amount: wht }]),
    ];
    const batch = p.batchRef ?? `PCR-${p.date}`;
    const j = await postJournalTx(tx, companyId, { date: p.date, lines, role: actor.role, book: 'PV', description: `เบิกชดเชยเงินสดย่อย ${batch}` });
    await tx.updateTable('acct.document').set({ batch_ref: batch, journal_id: j.id }).where('id', 'in', items.map((i) => i.id)).execute();
    const issued = [];
    for (const c of certs) issued.push(...(await issueCertificates(tx, companyId, c.item.id, c.item.contact_id!, p.date, [c.w])));
    return { journalNo: j.journalNo, total: total.toString(), vat: vat.toString(), wht: wht.toString(), paid: total.minus(wht).toString(), items: items.length, certificates: issued };
  });
}
