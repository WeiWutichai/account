// M5 ซื้อ + จ่ายเงิน (docs/technical-plan-M5.md) — PR/PO/AP/CNR/DNR/EXP · PV (สายอนุมัติ + 50 ทวิ) · รอบจ่าย · เงินสดย่อย
// กติกา (CLAUDE.md): หัก ณ ที่จ่ายรับรู้ตอนจ่ายเงินจริง · ออก 50 ทวิ และเข้า ภ.ง.ด.3/53 เดือนที่จ่าย · ฟรีแลนซ์ = ค่าตั้งของบริษัท "รอยืนยัน"
import { Money, post, type MoneyString } from '@innovera/ledger';
import { bahtText, FREELANCE_DEFAULT, pndOf, whtOnPayment, whtTypeFor, type FreelanceWhtConfig } from '@innovera/tax-th';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, nextNumber, postJournalTx, reserveNumber } from './ledger-service.ts';
import { docOrThrow, event, outstandingTx, prefixOf, ruleFor, totalsOf, type Actor } from './sales.ts';

export const PURCHASE_TYPES = ['PR', 'PO', 'AP', 'CNR', 'DNR', 'EXP'] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];
const NON_POSTING: readonly string[] = ['PR', 'PO'];
/** สายอนุมัติจ่าย (fixtures PAYRUN approval): L1 ฝ่ายบัญชี · เกิน 1,000,000 ต้องผู้มีวงเงินสูงกว่า (L3 กรรมการ) */
export const PAY_APPROVAL = { l2Limit: '1000000.00' } as const;

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
  const t = totalsOf({ lines: input.lines.map((l) => ({ ...l, vat: l.vat ?? true })), priceInclVat: input.priceInclVat ?? false, billDiscount: input.billDiscount ?? '0.00' });
  return db.withCompany(companyId, async (tx) => {
    const values = {
      doc_type: input.docType, issue_date: input.issueDate, due_date: input.dueDate ?? null, contact_id: input.contactId, price_incl_vat: input.priceInclVat ?? false,
      subtotal: t.subtotal, discount: t.discount, vat: t.vat, wht: '0.00', grand_total: t.grandTotal, bill_discount: input.billDiscount ?? '0.00', vendor_ref: input.vendorRef ?? null,
      ref_document_id: input.refDocumentId ?? null, pay_now: input.payNow ?? false, receive_account: input.payFrom ?? null, notes: input.notes ?? null, reference: input.reference ?? null,
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

export async function approvePurchase(db: Db, companyId: string, actor: Actor, id: string, opts: { docNo?: string } = {}) {
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError(`เอกสารสถานะ ${d.status} อนุมัติไม่ได้`);
    const docNo = opts.docNo ?? d.doc_no ?? (await nextNumber(tx, companyId, await prefixOf(tx, d.doc_type), d.issue_date));
    if (opts.docNo) await reserveNumber(tx, companyId, opts.docNo);
    if (NON_POSTING.includes(d.doc_type)) {
      await tx.updateTable('acct.document').set({ status: 'approved', doc_no: docNo, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
      await event(tx, companyId, id, actor.userId, 'approved', { docNo });
      return { docNo };
    }
    if (d.doc_type === 'CNR') {
      const o = await outstandingTx(tx, d.ref_document_id!);
      if (Money.parse(d.grand_total).gt(o.outstanding)) throw new LedgerError(`ลดหนี้เกินยอดค้างของบิลซื้อ (${o.outstanding.toString()})`);
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
    const { def, versionId } = await ruleFor(tx, d.rule_code!);
    const paid = Money.parse(d.grand_total).minus(wht);
    const jl = post(def, {
      docType: d.doc_type, amounts: { grand_total: d.grand_total, vat: d.vat, wht: wht.toString(), paid: paid.toString() },
      lines: lines.map((l) => ({ amounts: { amount: l.amount }, ...(l.account_code ? { account: l.account_code } : {}) })),
      contact: { apAccount: '2110100', ...(d.contact_id ? { id: d.contact_id } : {}) }, accounts: { ...(d.receive_account ? { cash: d.receive_account } : {}) },
    }).map((l) => (l.account === '2110100' && d.contact_id ? { ...l, contactId: d.contact_id } : l));
    const j = await postJournalTx(tx, companyId, { date: d.issue_date, lines: jl, role: actor.role, book: def.book, prefix: 'JV', description: docNo, sourceDocumentId: id, ...(versionId ? { ruleVersionId: versionId } : {}) });
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: j.id, wht: wht.toString(), approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    if (d.doc_type === 'CNR') await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: id, document_id: d.ref_document_id!, applied: d.grand_total, wht: '0.00', wht_base: null, vat_due: '0.00', voided: false }).execute();
    const issued = await issueCertificates(tx, companyId, id, d.contact_id!, d.issue_date, certs);
    await event(tx, companyId, id, actor.userId, 'posted', { docNo, journalNo: j.journalNo, certificates: issued });
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
  method?: 'transfer' | 'bulk_transfer' | 'cheque' | 'cash';
  cheque?: { chequeNo: string; bank: string; chequeDate: string } | null;
  batchRef?: string | null;
  notes?: string | null;
  docNo?: string;
}

/** สร้างใบสำคัญจ่าย (รออนุมัติ) — ยังไม่ลงบัญชีจนผ่านสายอนุมัติ · ภาษีหักคำนวณไว้ ณ วันที่จ่าย */
export async function createPayment(db: Db, companyId: string, actor: Actor, input: PaymentInput) {
  if (!input.bills.length) throw new LedgerError('เลือกบิลอย่างน้อย 1 ใบ');
  return db.withCompany(companyId, async (tx) => {
    let settled = Money.zero();
    let wht = Money.zero();
    const rows = [];
    for (const b of input.bills) {
      const o = await outstandingTx(tx, b.documentId);
      if (o.doc.status !== 'posted' || !['AP', 'EXP', 'DNR'].includes(o.doc.doc_type)) throw new LedgerError('จ่ายได้เฉพาะบิลซื้อ/ค่าใช้จ่ายที่ลงบัญชีแล้ว');
      if (o.doc.contact_id !== input.contactId) throw new LedgerError(`${o.doc.doc_no} ไม่ใช่ของผู้ขายรายนี้`);
      const settle = b.settle ? Money.of(b.settle) : o.outstanding;
      if (settle.gt(o.outstanding) || !settle.gt(Money.zero())) throw new LedgerError(`${o.doc.doc_no}: ยอดจ่ายต้องไม่เกินยอดค้าง ${o.outstanding.toString()}`);
      const w = await whtForBill(tx, b.documentId, settle);
      const billWht = Money.sum(w.map((x) => Money.of(x.amount as MoneyString)));
      settled = settled.plus(settle);
      wht = wht.plus(billWht);
      rows.push({ b, settle, w, billWht });
    }
    const paid = settled.minus(wht);
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
    if (input.cheque) await tx.insertInto('acct.cheque').values({ company_id: companyId, direction: 'issued', cheque_no: input.cheque.chequeNo, bank: input.cheque.bank, branch: null,
      cheque_date: input.cheque.chequeDate, amount: paid.toString(), status: 'issued', document_id: pv.id, contact_id: input.contactId, deposited_on: null, cleared_on: null }).execute();
    await event(tx, companyId, pv.id, actor.userId, 'submitted', { settled: settled.toString(), wht: wht.toString(), paid: paid.toString() });
    return { id: pv.id, settled: settled.toString(), wht: wht.toString(), paid: paid.toString(), amountText: bahtText(paid.toString() as MoneyString), bills: rows.map((r) => ({ documentId: r.b.documentId, settle: r.settle.toString(), wht: r.w })) };
  });
}

/**
 * อนุมัติจ่าย: ผู้อนุมัติต้องมีสิทธิ์อนุมัติจ่าย · วงเงิน (approval_limit ใน membership · null = ไม่จำกัด) ต้องไม่ต่ำกว่ายอดจ่าย
 * แบ่งหน้าที่ (SoD · ScreenUserEdit): ผู้สร้างใบสำคัญจ่ายอนุมัติใบของตนเองไม่ได้ · ผ่านแล้วลงบัญชี + ออก 50 ทวิ
 */
export async function approvePayment(db: Db, companyId: string, actor: Actor & { approvalLimit: string | null }, id: string, opts: { docNo?: string; certNos?: string[] } = {}) {
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.doc_type !== 'PV' || d.status !== 'pending_approval') throw new LedgerError('อนุมัติได้เฉพาะใบสำคัญจ่ายที่รออนุมัติ');
    if (actor.userId && d.created_by === actor.userId) throw new LedgerError('ผู้สร้างใบสำคัญจ่ายอนุมัติใบของตนเองไม่ได้ (แบ่งหน้าที่)');
    if (actor.approvalLimit !== null && Money.parse(d.grand_total).gt(Money.parse(actor.approvalLimit))) throw new LedgerError(`ยอดจ่ายเกินวงเงินอนุมัติของคุณ (${actor.approvalLimit})`);
    const docNo = opts.docNo ?? d.doc_no ?? (await nextNumber(tx, companyId, await prefixOf(tx, 'PV'), d.issue_date));
    if (opts.docNo) await reserveNumber(tx, companyId, opts.docNo);
    const settlements = await tx.selectFrom('acct.settlement').selectAll().where('payment_id', '=', id).execute();
    const settled = Money.sum(settlements.map((s) => Money.parse(s.applied).plus(Money.parse(s.wht))));
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
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: j.id, approved_by: actor.userId, approved_at: new Date(), approval_level: 1, updated_at: new Date() }).where('id', '=', id).execute();
    const issued = await issueCertificates(tx, companyId, id, d.contact_id!, d.issue_date, [...certs.values()], opts.certNos);
    await event(tx, companyId, id, actor.userId, 'approved', { docNo, journalNo: j.journalNo, certificates: issued.map((c) => c.certNo) });
    return { docNo, journalNo: j.journalNo, certificates: issued, needsDirector: Money.parse(d.grand_total).gt(Money.of(PAY_APPROVAL.l2Limit)) };
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
      .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.due_date', 'd.grand_total', 'd.vendor_ref', 'c.id as contact_id', 'c.code as contact_code', 'c.name as contact_name'])
      .where('d.doc_type', 'in', ['AP', 'EXP', 'DNR']).where('d.status', '=', 'posted');
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
