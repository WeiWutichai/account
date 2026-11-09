// M4 ขาย + รับเงิน (docs/technical-plan-M4.md) — เอกสาร QO/SO/IV/CN/DN/DP/BN/RV · ลงบัญชีผ่าน Posting Engine · ทุกอย่างใน withCompany (RLS)
import { docTotals, Money, post, receiptTotals, type CompanyRole, type MoneyString, type RuleDefinition } from '@innovera/ledger';
import { bahtText, whtOnReceipt } from '@innovera/tax-th';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { DEFAULT_RULES } from '@innovera/ledger';
import { LedgerError, nextNumber, postJournalTx, reserveNumber, voidJournalTx } from './ledger-service.ts';
import { emitTx } from './hub.ts';

export const SALES_TYPES = ['QO', 'SO', 'IV', 'CN', 'DN', 'DP', 'BN', 'RV'] as const;
export type SalesType = (typeof SALES_TYPES)[number];
/** เอกสารที่ไม่ลงบัญชี — อนุมัติแล้วได้เลขที่ สถานะ approved */
const NON_POSTING: readonly SalesType[] = ['QO', 'SO', 'BN'];
/** สูตรตั้งต้นต่อประเภท (เปลี่ยนได้ต่อเอกสาร · ScreenInvoice "สูตรลงบัญชี") */
export const DEFAULT_RULE: Partial<Record<SalesType, string>> = { IV: 'Service[IV]', CN: 'CN[ref IV]', DN: 'DN[ref IV]', DP: 'Deposit[DP]', RV: 'Receive[RV]' };
const BOOK: Record<string, 'SJ' | 'RJ'> = { IV: 'SJ', CN: 'SJ', DN: 'SJ', DP: 'RJ', RV: 'RJ' };

export interface SalesLineInput {
  lineType?: 'item' | 'heading' | 'note';
  productCode?: string | null;
  description: string;
  qty?: string;
  unitPrice?: string;
  discount?: MoneyString;
  vat?: boolean;
  accountCode?: string | null;
}
export interface SalesDraftInput {
  docType: Exclude<SalesType, 'BN' | 'RV'>;
  contactId: string;
  issueDate: string;       // YYYY-MM-DD (ค.ศ.)
  dueDate?: string | null;
  priceInclVat?: boolean;
  billDiscount?: MoneyString;
  taxMode?: 'on_payment' | 'immediate';
  ruleCode?: string;
  address?: string | null;
  notes?: string | null;
  reference?: string | null;
  refDocumentId?: string | null;
  creditDays?: number | null;
  receiveAccount?: string | null;  // DP / ขายสด: บัญชีที่รับเงินเข้า
  deposits?: { documentId: string; amount: MoneyString }[]; // IV หักมัดจำ (ฐานก่อน VAT)
  lines: SalesLineInput[];
}
export interface Actor { userId: string | null; role: CompanyRole }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

export function totalsOf(input: Pick<SalesDraftInput, 'lines' | 'priceInclVat' | 'billDiscount' | 'deposits'>) {
  const items = input.lines.filter((l) => (l.lineType ?? 'item') === 'item');
  for (const l of items) if (!l.qty || !l.unitPrice) throw new LedgerError(`บรรทัด "${l.description}" ต้องมีจำนวนและราคา`);
  const t = docTotals(items.map((l) => ({ qty: l.qty!, unitPrice: l.unitPrice!, discount: l.discount ?? '0.00', vat: l.vat ?? true })), { priceInclVat: input.priceInclVat ?? false, billDiscount: input.billDiscount ?? '0.00' });
  const deposit = Money.sum((input.deposits ?? []).map((d) => Money.of(d.amount)));
  if (deposit.isZero()) return { ...t, deposit: '0.00' as MoneyString, receivable: t.grandTotal };
  if (input.priceInclVat) throw new LedgerError('หักมัดจำใช้ได้กับราคาไม่รวม VAT เท่านั้น');
  // มัดจำเสียภาษีไปแล้วตอนรับ → VAT ใบนี้คิดเฉพาะส่วนที่เกินมัดจำ (fixtures DP2610-0006 apply_example)
  const taxable = Money.of(t.vatBase).minus(deposit);
  if (taxable.isNegative()) throw new LedgerError('หักมัดจำเกินมูลค่าที่มี VAT');
  const vat = taxable.times('0.07').round();
  const receivable = Money.of(t.net).minus(deposit).plus(vat);
  return { ...t, vat: vat.toString(), grandTotal: Money.of(t.net).plus(vat).toString(), deposit: deposit.toString(), receivable: receivable.toString() };
}

export async function event(tx: CompanyTx, companyId: string, documentId: string, actor: string | null, ev: string, detail: unknown = {}) {
  await tx.insertInto('acct.document_event').values({ company_id: companyId, document_id: documentId, actor, event: ev, detail: JSON.stringify(detail) }).execute();
}
export async function docOrThrow(tx: CompanyTx, id: string) {
  const d = await tx.selectFrom('acct.document').selectAll().where('id', '=', id).executeTakeFirst();
  if (!d) throw new LedgerError('ไม่พบเอกสาร');
  return d;
}
/** สูตรล่าสุดของบริษัท (version ที่บันทึกไว้) หรือสูตรตั้งต้น */
export async function ruleFor(tx: CompanyTx, code: string): Promise<{ def: RuleDefinition; versionId: string | null }> {
  const v = await tx.selectFrom('acct.posting_rule as r').innerJoin('acct.posting_rule_version as v', (j) => j.onRef('v.rule_id', '=', 'r.id').onRef('v.company_id', '=', 'r.company_id'))
    .select(['v.id', 'v.definition']).where('r.code', '=', code).orderBy('v.version', 'desc').executeTakeFirst();
  if (v) return { def: v.definition as RuleDefinition, versionId: v.id };
  const d = DEFAULT_RULES.find((r) => r.code === code);
  if (!d) throw new LedgerError(`ไม่พบสูตร ${code}`);
  return { def: d, versionId: null };
}
export async function prefixOf(tx: CompanyTx, docType: string): Promise<string> {
  const s = await tx.selectFrom('acct.doc_setting').select('prefix').where('doc_type', '=', docType).executeTakeFirst();
  return s?.prefix ?? docType;
}

// ---------- ร่าง ----------

export async function saveSalesDraft(db: Db, companyId: string, actor: Actor, input: SalesDraftInput, id?: string): Promise<string> {
  if (!SALES_TYPES.includes(input.docType)) throw new LedgerError('ประเภทเอกสารไม่ถูกต้อง');
  if (!input.lines.some((l) => (l.lineType ?? 'item') === 'item')) throw new LedgerError('ต้องมีอย่างน้อย 1 รายการ');
  if ((input.docType === 'CN' || input.docType === 'DN') && !input.refDocumentId) throw new LedgerError('ใบลดหนี้/เพิ่มหนี้ต้องอ้างใบกำกับภาษี');
  const t = totalsOf(input);
  return db.withCompany(companyId, async (tx) => {
    const values = {
      doc_type: input.docType, issue_date: input.issueDate, due_date: input.dueDate ?? null, contact_id: input.contactId, price_incl_vat: input.priceInclVat ?? false,
      subtotal: t.subtotal, discount: t.discount, vat: t.vat, wht: '0.00', grand_total: t.receivable, bill_discount: input.billDiscount ?? '0.00',
      tax_mode: input.taxMode ?? (input.docType === 'IV' ? 'on_payment' : null), rule_code: input.ruleCode ?? DEFAULT_RULE[input.docType] ?? null,
      address: input.address ?? null, notes: input.notes ?? null, reference: input.reference ?? null, ref_document_id: input.refDocumentId ?? null,
      credit_days: input.creditDays ?? null, receive_account: input.receiveAccount ?? null, updated_at: new Date(),
    };
    let docId = id;
    if (docId) {
      const d = await docOrThrow(tx, docId);
      if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError('แก้ได้เฉพาะเอกสารร่าง — เอกสารที่ผ่านรายการแล้วแก้ได้เฉพาะข้อมูลอ้างอิง');
      await tx.updateTable('acct.document').set({ ...values, status: 'draft' }).where('id', '=', docId).execute();
      await tx.deleteFrom('acct.document_line').where('document_id', '=', docId).execute();
      await tx.deleteFrom('acct.settlement').where('payment_id', 'in', (input.deposits ?? []).map((x) => x.documentId).concat(['00000000-0000-0000-0000-000000000000'])).where('document_id', '=', docId).execute();
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
        vat_rate: item ? ((l.vat ?? true) ? '0.0700' : null) : null, account_code: l.accountCode ?? null,
      }).execute();
    }
    // มัดจำที่หัก: settlement จาก DP → IV (ยังไม่มีผลจนกว่าจะลงบัญชี — voided = true จนอนุมัติ)
    for (const dep of input.deposits ?? []) {
      await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: dep.documentId, document_id: docId, applied: dep.amount, wht: '0.00', wht_base: null, vat_due: '0.00', voided: true }).execute();
    }
    return docId;
  });
}

export async function submitDocument(db: Db, companyId: string, actor: Actor, id: string) {
  await db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status !== 'draft') throw new LedgerError('ส่งอนุมัติได้เฉพาะเอกสารร่าง');
    await tx.updateTable('acct.document').set({ status: 'pending_approval', updated_at: new Date() }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'submitted');
  });
}
export async function rejectDocument(db: Db, companyId: string, actor: Actor, id: string, reason: string) {
  if (!reason.trim()) throw new LedgerError('ต้องระบุเหตุผลที่ปฏิเสธ');
  await db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status !== 'pending_approval') throw new LedgerError('ปฏิเสธได้เฉพาะเอกสารรออนุมัติ');
    await tx.updateTable('acct.document').set({ status: 'draft', updated_at: new Date() }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'rejected', { reason });
  });
}

// ---------- อนุมัติ / ลงบัญชี ----------

/** ยอดค้างของใบแจ้งหนี้/เพิ่มหนี้ (หลังรับชำระ ลดหนี้ มัดจำ) */
export async function outstandingTx(tx: CompanyTx, docId: string) {
  const d = await docOrThrow(tx, docId);
  const s = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
    .select(['s.applied', 's.wht', 's.vat_due', 'p.doc_type']).where('s.document_id', '=', docId).where('s.voided', '=', false).execute();
  const paid = s.filter((x) => x.doc_type === 'RV' || x.doc_type === 'PV');
  const credits = s.filter((x) => x.doc_type === 'CN' || x.doc_type === 'CNR');
  const settled = Money.sum(paid.map((x) => Money.parse(x.applied).plus(Money.parse(x.wht))));
  const credited = Money.sum(credits.map((x) => Money.parse(x.applied)));
  const vatDue = Money.sum(paid.map((x) => Money.parse(x.vat_due)));
  return { doc: d, settled, credited, vatDue, outstanding: Money.parse(d.grand_total).minus(settled).minus(credited) };
}

/** opts.docNo: ระบุเลขที่เอง (นำเข้าเอกสารจากระบบเดิม / dev seed ตาม fixtures) · ซ้ำไม่ได้ (unique index) */
export async function approveDocument(db: Db, companyId: string, actor: Actor, id: string, opts: { docNo?: string } = {}): Promise<{ docNo: string; journalNo?: string }> {
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError(`เอกสารสถานะ ${d.status} อนุมัติไม่ได้`);
    const docNo = opts.docNo ?? d.doc_no ?? (await nextNumber(tx, companyId, await prefixOf(tx, d.doc_type), d.issue_date));
    if (opts.docNo) await reserveNumber(tx, companyId, opts.docNo);
    if (NON_POSTING.includes(d.doc_type as SalesType)) {
      await tx.updateTable('acct.document').set({ status: 'approved', doc_no: docNo, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
      await event(tx, companyId, id, actor.userId, 'approved', { docNo });
      return { docNo };
    }
    const lines = await tx.selectFrom('acct.document_line as l').leftJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'l.product_code').onRef('p.company_id', '=', 'l.company_id'))
      .select(['l.amount', 'l.account_code', 'p.revenue_account']).where('l.document_id', '=', id).where('l.line_type', '=', 'item').orderBy('l.line_no').execute();
    const deposits = await tx.selectFrom('acct.settlement').select(['id', 'payment_id', 'applied']).where('document_id', '=', id).execute();
    const deposit = Money.sum(deposits.map((x) => Money.parse(x.applied)));
    if (d.doc_type === 'CN') {
      if (!d.ref_document_id) throw new LedgerError('ใบลดหนี้ต้องอ้างใบกำกับภาษี');
      const o = await outstandingTx(tx, d.ref_document_id);
      if (Money.parse(d.grand_total).gt(o.outstanding)) throw new LedgerError(`ลดหนี้เกินยอดค้างของใบอ้างอิง (${o.outstanding.toString()})`);
    }
    if (d.doc_type === 'DP' && !d.receive_account) throw new LedgerError('ต้องเลือกบัญชีที่รับเงินมัดจำเข้า');
    const { def, versionId } = await ruleFor(tx, d.rule_code ?? DEFAULT_RULE[d.doc_type as SalesType] ?? '');
    const net = Money.parse(d.subtotal).minus(Money.parse(d.discount));
    const jl = post(def, {
      docType: d.doc_type,
      amounts: { grand_total: d.grand_total, net: net.toString(), vat: d.vat, discount: d.discount, subtotal: d.subtotal, deposit: deposit.toString() },
      lines: lines.map((l) => ({ amounts: { amount: l.amount }, ...(l.account_code ? { account: l.account_code } : {}), ...(l.revenue_account ? { productAccount: l.revenue_account } : {}) })),
      contact: { arAccount: '1130100', ...(d.contact_id ? { id: d.contact_id } : {}) },
      accounts: { ...(d.receive_account ? { cash: d.receive_account } : {}) },
    }).map((l) => (l.account === '1130100' && d.contact_id ? { ...l, contactId: d.contact_id } : l));
    const j = await postJournalTx(tx, companyId, { date: d.issue_date, lines: jl, role: actor.role, book: BOOK[d.doc_type] ?? 'SJ', prefix: 'JV', description: `${docNo}`,
      sourceDocumentId: id, ...(versionId ? { ruleVersionId: versionId } : {}) });
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: j.id, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    if (d.doc_type === 'CN') {
      await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: id, document_id: d.ref_document_id!, applied: d.grand_total, wht: '0.00', wht_base: null, vat_due: '0.00', voided: false }).execute();
    }
    if (deposits.length) await tx.updateTable('acct.settlement').set({ voided: false }).where('document_id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'posted', { docNo, journalNo: j.journalNo });
    await emitTx(tx, companyId, 'document.posted', { id, doc_type: d.doc_type, doc_no: docNo, external_source: d.external_source, external_ref: d.external_ref, grand_total: d.grand_total, journal_no: j.journalNo });
    return { docNo, journalNo: j.journalNo };
  });
}

// ---------- รับชำระ (ScreenReceipt) ----------

export interface ReceiptInput {
  contactId: string;
  date: string;
  receiveAccount: string;         // 1100100 / 1100200 / 1000100 / 1150100 (เช็ครับ)
  applications: { documentId: string; applied: MoneyString; wht?: MoneyString; whtBase?: MoneyString }[];
  fee?: MoneyString;
  feeAccount?: string;            // 5401100 ค่าธรรมเนียมธนาคาร / 4900100 ส่วนต่าง
  whtCertNo?: string | null;      // เลขที่ 50 ทวิ ที่ได้รับ
  whtRate?: string | null;        // "0.03"
  billingId?: string | null;      // อ้างอิงใบวางบิล
  cheque?: { chequeNo: string; bank: string; branch?: string; chequeDate: string } | null;
  notes?: string | null;
}

export async function receivePayment(db: Db, companyId: string, actor: Actor, input: ReceiptInput & { docNo?: string }) {
  if (!input.applications.length) throw new LedgerError('เลือกเอกสารที่จะตัดยอดอย่างน้อย 1 ใบ');
  return db.withCompany(companyId, async (tx) => {
    const apps = [];
    const warnings: string[] = [];
    for (const a of input.applications) {
      const o = await outstandingTx(tx, a.documentId);
      if (o.doc.status !== 'posted' || !['IV', 'DN'].includes(o.doc.doc_type)) throw new LedgerError('ตัดยอดได้เฉพาะใบแจ้งหนี้/เพิ่มหนี้ที่ลงบัญชีแล้ว');
      if (o.doc.contact_id !== input.contactId) throw new LedgerError(`${o.doc.doc_no} ไม่ใช่ของลูกค้ารายนี้`);
      const wht = a.wht ?? '0.00';
      if (Money.of(a.applied).plus(Money.of(wht)).gt(o.outstanding)) throw new LedgerError(`${o.doc.doc_no}: ตัดยอดเกินยอดค้าง ${o.outstanding.toString()}`);
      if (input.whtRate && a.whtBase && Money.of(wht).gt(Money.zero())) {
        const w = whtOnReceipt({ base: a.whtBase, rate: input.whtRate, certified: wht });
        if (w.warning) warnings.push(`${o.doc.doc_no}: ${w.warning}`);
      }
      apps.push({ o, a: { ...a, wht } });
    }
    const totals = receiptTotals(apps.map(({ o, a }) => ({
      invoiceTotal: o.doc.grand_total, invoiceVat: o.doc.vat, vatOnPayment: o.doc.tax_mode === 'on_payment', settledBefore: o.settled.plus(o.credited).toString(),
      vatDueBefore: o.vatDue.toString(), applied: a.applied, wht: a.wht,
    })), input.fee ?? '0.00');
    const docNo = input.docNo ?? (await nextNumber(tx, companyId, await prefixOf(tx, 'RV'), input.date));
    if (input.docNo) await reserveNumber(tx, companyId, input.docNo);
    const rv = await tx.insertInto('acct.document').values({
      company_id: companyId, doc_type: 'RV', doc_no: docNo, status: 'posted', issue_date: input.date, due_date: null, contact_id: input.contactId, price_incl_vat: false,
      subtotal: totals.settled, discount: '0.00', vat: totals.vatDue, wht: totals.wht, grand_total: totals.cashIn, fee: totals.fee, fee_account: input.feeAccount ?? '5401100',
      receive_account: input.receiveAccount, wht_cert_no: input.whtCertNo ?? null, wht_rate: input.whtRate ?? null, ref_document_id: input.billingId ?? null,
      rule_code: 'Receive[RV]', notes: input.notes ?? null, created_by: actor.userId, approved_by: actor.userId, approved_at: new Date(), external_source: null, external_ref: null, branch_code: '00000', bill_discount: '0.00',
    } as never).returning('id').executeTakeFirstOrThrow();
    for (const [i, { a }] of apps.entries()) {
      await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: rv.id, document_id: a.documentId, applied: a.applied, wht: a.wht, wht_base: a.whtBase ?? null, vat_due: totals.perDoc[i]!.vatDue, voided: false }).execute();
    }
    const { def, versionId } = await ruleFor(tx, 'Receive[RV]');
    const jl = post(def, {
      docType: 'RV', amounts: { cash_in: totals.cashIn, wht: totals.wht, fee: totals.fee, vat_due: totals.vatDue, settled: totals.settled },
      contact: { arAccount: '1130100', id: input.contactId }, accounts: { cash: input.receiveAccount, ...(input.feeAccount ? { fee: input.feeAccount } : {}) },
    }).map((l) => (l.account === '1130100' ? { ...l, contactId: input.contactId } : l));
    const j = await postJournalTx(tx, companyId, { date: input.date, lines: jl, role: actor.role, book: 'RJ', prefix: 'JV', description: docNo, sourceDocumentId: rv.id, ...(versionId ? { ruleVersionId: versionId } : {}) });
    await tx.updateTable('acct.document').set({ journal_id: j.id }).where('id', '=', rv.id).execute();
    if (input.cheque) {
      await tx.insertInto('acct.cheque').values({ company_id: companyId, direction: 'received', cheque_no: input.cheque.chequeNo, bank: input.cheque.bank, branch: input.cheque.branch ?? null,
        cheque_date: input.cheque.chequeDate, amount: totals.cashIn, document_id: rv.id, contact_id: input.contactId, deposited_on: null, cleared_on: null }).execute();
    }
    await event(tx, companyId, rv.id, actor.userId, 'posted', { docNo, journalNo: j.journalNo });
    await emitTx(tx, companyId, 'payment.received', { id: rv.id, doc_no: docNo, contact_id: input.contactId, cash_in: totals.cashIn, wht: totals.wht,
      applications: apps.map(({ o, a }) => ({ document_id: a.documentId, doc_no: o.doc.doc_no, external_ref: o.doc.external_ref, applied: a.applied, wht: a.wht })) });
    return { id: rv.id, docNo, journalNo: j.journalNo, totals, warnings, amountText: bahtText(totals.settled as MoneyString) };
  });
}

// ---------- ใบวางบิล (ScreenBilling) — ไม่ลงบัญชี ----------

export async function createBilling(db: Db, companyId: string, actor: Actor, input: { contactId: string; date: string; dueDate?: string | null; documentIds: string[]; notes?: string | null; docNo?: string }) {
  if (!input.documentIds.length) throw new LedgerError('เลือกใบแจ้งหนี้อย่างน้อย 1 ใบ');
  return db.withCompany(companyId, async (tx) => {
    let total = Money.zero();
    for (const id of input.documentIds) {
      const o = await outstandingTx(tx, id);
      if (o.doc.contact_id !== input.contactId || o.doc.status !== 'posted') throw new LedgerError('ใบแจ้งหนี้ไม่ถูกต้องสำหรับลูกค้ารายนี้');
      total = total.plus(o.outstanding);
    }
    const docNo = input.docNo ?? (await nextNumber(tx, companyId, await prefixOf(tx, 'BN'), input.date));
    if (input.docNo) await reserveNumber(tx, companyId, input.docNo);
    const bn = await tx.insertInto('acct.document').values({
      company_id: companyId, doc_type: 'BN', doc_no: docNo, status: 'approved', issue_date: input.date, due_date: input.dueDate ?? null, contact_id: input.contactId, price_incl_vat: false,
      subtotal: total.toString(), discount: '0.00', vat: '0.00', wht: '0.00', grand_total: total.toString(), notes: input.notes ?? null, created_by: actor.userId, approved_by: actor.userId,
      approved_at: new Date(), external_source: null, external_ref: null, branch_code: '00000', fee: '0.00', bill_discount: '0.00',
    } as never).returning('id').executeTakeFirstOrThrow();
    for (const [i, id] of input.documentIds.entries()) await tx.insertInto('acct.billing_item').values({ company_id: companyId, billing_id: bn.id, document_id: id, line_no: i + 1 }).execute();
    await event(tx, companyId, bn.id, actor.userId, 'approved', { docNo });
    return { id: bn.id, docNo, total: total.toString() };
  });
}

// ---------- ยกเลิก (ScreenDocVoid) / แก้ข้อมูลอ้างอิง (ScreenDocEdit) ----------

export async function voidDocument(db: Db, companyId: string, actor: Actor, id: string, p: { reason: string; date?: string }) {
  if (!p.reason.trim()) throw new LedgerError('ต้องระบุเหตุผลการยกเลิก');
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status === 'voided') throw new LedgerError('เอกสารถูกยกเลิกแล้ว');
    const active = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
      .select(['p.doc_no', 'p.doc_type']).where('s.document_id', '=', id).where('s.voided', '=', false).execute();
    if (active.length) throw new LedgerError(`มีเอกสารอ้างถึงใบนี้ (${active.map((a) => a.doc_no).join(', ')}) — ยกเลิกเอกสารเหล่านั้นก่อน`);
    let reversal: string | null = null;
    if (d.journal_id) {
      const r = await voidJournalTx(tx, companyId, d.journal_id, { date: p.date ?? d.issue_date, role: actor.role, reason: p.reason, ...(actor.userId ? { actorId: actor.userId } : {}) });
      reversal = r.journalNo;
    }
    await tx.updateTable('acct.settlement').set({ voided: true }).where('payment_id', '=', id).execute();
    // ยกเลิกการจ่าย = ยกเลิก 50 ทวิ ที่ออกจากการจ่ายนั้น (ไม่เข้า ภ.ง.ด.)
    await tx.updateTable('acct.wht_certificate').set({ voided: true }).where('payment_id', '=', id).execute();
    await tx.updateTable('acct.cheque').set({ status: 'cancelled' }).where('document_id', '=', id).execute();
    // ใบที่ยกเลิกถูกถอดออกจากใบวางบิล (ScreenDocVoid "จะถอดออกให้")
    await tx.deleteFrom('acct.billing_item').where('document_id', '=', id).execute();
    await tx.updateTable('acct.document').set({ status: 'voided', voided_at: new Date(), void_reason: p.reason, updated_at: new Date(),
      ...(reversal ? { void_journal_id: (await tx.selectFrom('acct.journal').select('id').where('journal_no', '=', reversal).executeTakeFirstOrThrow()).id } : {}) }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'voided', { reason: p.reason, reversal });
    await emitTx(tx, companyId, 'document.voided', { id, doc_type: d.doc_type, doc_no: d.doc_no, external_source: d.external_source, external_ref: d.external_ref, reason: p.reason, reversal });
    return { reversal };
  });
}

/** หลังผ่านรายการแก้ได้เฉพาะข้อมูลอ้างอิง (CLAUDE.md) — ยอด/ภาษี/บัญชีแก้ไม่ได้ */
export const REFERENCE_FIELDS = ['address', 'notes', 'reference', 'due_date'] as const;
export async function editReference(db: Db, companyId: string, actor: Actor, id: string, input: Partial<Record<(typeof REFERENCE_FIELDS)[number], string | null>> & Record<string, unknown> & { reason?: string }) {
  const { reason, ...patch } = input;
  const bad = Object.keys(patch).filter((k) => !(REFERENCE_FIELDS as readonly string[]).includes(k));
  if (bad.length) throw new LedgerError(`แก้ไม่ได้หลังผ่านรายการ: ${bad.join(', ')} — ต้องยกเลิกแล้วออกใหม่`);
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status === 'voided') throw new LedgerError('เอกสารถูกยกเลิกแล้ว');
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (d as Record<string, unknown>)[k] ?? null]));
    await tx.updateTable('acct.document').set({ ...(patch as Record<string, string | null>), updated_at: new Date() }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'reference_edited', { before, after: patch, ...(reason ? { reason } : {}) });
  });
}

// ---------- แปลงเอกสาร QO → SO → IV / QO → DP ----------

export async function convertDocument(db: Db, companyId: string, actor: Actor, id: string, to: 'SO' | 'IV' | 'DP', p: { issueDate?: string } = {}) {
  const src = await getDocument(db, companyId, id);
  if (!src) throw new LedgerError('ไม่พบเอกสาร');
  if (src.doc.status !== 'approved' && src.doc.status !== 'posted') throw new LedgerError('แปลงได้เฉพาะเอกสารที่อนุมัติแล้ว');
  const newId = await saveSalesDraft(db, companyId, actor, {
    docType: to, contactId: src.doc.contact_id!, issueDate: p.issueDate ?? today(), priceInclVat: src.doc.price_incl_vat, billDiscount: src.doc.bill_discount,
    address: src.doc.address, notes: src.doc.notes, reference: src.doc.doc_no, refDocumentId: id, creditDays: src.doc.credit_days,
    lines: src.lines.map((l) => ({ lineType: l.line_type, productCode: l.product_code, description: l.description, qty: l.qty ?? undefined, unitPrice: l.unit_price ?? undefined, discount: l.discount, vat: l.vat_rate !== null, accountCode: l.account_code })),
  } as SalesDraftInput);
  await db.withCompany(companyId, (tx) => event(tx, companyId, id, actor.userId, 'converted', { to, id: newId }));
  return newId;
}

// ---------- อ่าน ----------

export async function getDocument(db: Db, companyId: string, id: string) {
  return db.withCompany(companyId, async (tx) => {
    const doc = await tx.selectFrom('acct.document').selectAll().where('id', '=', id).executeTakeFirst();
    if (!doc) return null;
    const lines = await tx.selectFrom('acct.document_line as l').leftJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'l.product_code').onRef('p.company_id', '=', 'l.company_id'))
      .selectAll('l').select('p.unit').where('l.document_id', '=', id).orderBy('l.line_no').execute();
    const cheques = await tx.selectFrom('acct.cheque').selectAll().where('document_id', '=', id).execute();
    const contact = doc.contact_id ? await tx.selectFrom('acct.contact').selectAll().where('id', '=', doc.contact_id).executeTakeFirst() : null;
    const events = await tx.selectFrom('acct.document_event').select(['at', 'actor', 'event', 'detail']).where('document_id', '=', id).orderBy('at').orderBy('id').execute();
    const settlementsIn = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
      .select(['p.id', 'p.doc_no', 'p.doc_type', 'p.issue_date', 's.applied', 's.wht', 's.vat_due', 's.voided']).where('s.document_id', '=', id).execute();
    const settlementsOut = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as d', (j) => j.onRef('d.id', '=', 's.document_id').onRef('d.company_id', '=', 's.company_id'))
      .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.due_date', 'd.grand_total', 'd.vat', 's.applied', 's.wht', 's.wht_base', 's.vat_due', 's.voided']).where('s.payment_id', '=', id).execute();
    const billing = await tx.selectFrom('acct.billing_item as b').innerJoin('acct.document as d', (j) => j.onRef('d.id', '=', 'b.document_id').onRef('d.company_id', '=', 'b.company_id'))
      .select(['d.id', 'd.doc_no', 'd.issue_date', 'd.due_date', 'd.grand_total']).where('b.billing_id', '=', id).orderBy('b.line_no').execute();
    const journal = doc.journal_id ? await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .innerJoin('acct.account as a', (jn) => jn.onRef('a.code', '=', 'l.account_code').onRef('a.company_id', '=', 'l.company_id'))
      .select(['j.journal_no', 'l.line_no', 'l.account_code', 'a.name', 'l.debit', 'l.credit']).where('l.journal_id', '=', doc.journal_id).orderBy('l.line_no').execute() : [];
    const ref = doc.ref_document_id ? await tx.selectFrom('acct.document').select(['id', 'doc_no', 'doc_type', 'grand_total', 'issue_date']).where('id', '=', doc.ref_document_id).executeTakeFirst() : null;
    const o = ['IV', 'DN'].includes(doc.doc_type) && doc.status === 'posted' ? (await outstandingTx(tx, id)).outstanding.toString() : null;
    return { doc, lines, contact, events, settlementsIn, settlementsOut, billing, journal, ref, cheques, outstanding: o, amountText: bahtText(doc.grand_total as MoneyString) };
  });
}

export interface DocFilter { docType?: string | string[]; status?: string; from?: string; to?: string; contactId?: string; q?: string; limit?: number }
export async function listDocuments(db: Db, companyId: string, f: DocFilter = {}) {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.document as d').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_type', 'd.doc_no', 'd.status', 'd.issue_date', 'd.due_date', 'd.grand_total', 'd.subtotal', 'd.vat', 'd.wht', 'd.tax_mode', 'd.created_at', 'd.ref_document_id', 'd.sent_at', 'd.vendor_ref', 'd.external_source', 'd.external_ref', 'd.pay_now', 'd.batch_ref',
        'c.id as contact_id', 'c.code as contact_code', 'c.name as contact_name',
        sql<string>`coalesce((select sum(s.applied + s.wht) from acct.settlement s where s.document_id = d.id and s.company_id = d.company_id and not s.voided), 0)`.as('settled')])
      .orderBy('d.issue_date', 'desc').orderBy('d.doc_no', 'desc').limit(f.limit ?? 500);
    if (f.docType) q = q.where('d.doc_type', 'in', Array.isArray(f.docType) ? f.docType : [f.docType]);
    if (f.status) q = q.where('d.status', '=', f.status as never);
    if (f.from) q = q.where('d.issue_date', '>=', f.from);
    if (f.to) q = q.where('d.issue_date', '<=', f.to);
    if (f.contactId) q = q.where('d.contact_id', '=', f.contactId);
    if (f.q) q = q.where((eb) => eb.or([eb('d.doc_no', 'ilike', `%${f.q}%`), eb('c.name', 'ilike', `%${f.q}%`), eb('c.code', 'ilike', `%${f.q}%`)]));
    const rows = await q.execute();
    // ยอดค้าง: ขาย IV/DN · ซื้อ AP/EXP(ไม่ได้จ่ายทันที)/DNR
    const open = (r: (typeof rows)[number]) => r.status === 'posted' && (['IV', 'DN', 'AP', 'DNR'].includes(r.doc_type) || (r.doc_type === 'EXP' && !r.pay_now));
    return rows.map((r) => ({ ...r, outstanding: open(r) ? Money.parse(r.grand_total).minus(Money.parse(r.settled)).toString() : null }));
  });
}

/** เอกสารค้างชำระของลูกค้า เรียงตามครบกำหนด (เก่าก่อน) — ScreenReceipt / ScreenBilling */
export async function openItems(db: Db, companyId: string, contactId: string) {
  const docs = await listDocuments(db, companyId, { contactId, docType: ['IV', 'DN'], status: 'posted' });
  return docs.filter((d) => d.outstanding && Money.parse(d.outstanding).gt(Money.zero()))
    .sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date));
}

// ---------- ตั้งค่าเอกสาร (ScreenDocSettings / ScreenDocSeriesEdit) ----------

export async function docSettings(db: Db, companyId: string, today = new Date().toISOString().slice(0, 10)) {
  return db.withCompany(companyId, async (tx) => {
    const settings = await tx.selectFrom('acct.doc_setting').selectAll().orderBy('doc_type').execute();
    // ลำดับถัดไปของเดือนนี้ต่อคำนำหน้า (ScreenDocSettings "ลำดับปัจจุบัน")
    const key = `${today.slice(2, 4)}${today.slice(5, 7)}`;
    const counters = await tx.selectFrom('acct.number_series').select(['doc_type', 'period_key', 'next_no']).where('period_key', '=', key).execute();
    return { settings, counters };
  });
}
export async function saveDocSetting(db: Db, companyId: string, s: { docType: string; prefix: string; pattern?: string; reset?: 'monthly' | 'yearly' | 'never'; settings?: Record<string, unknown> }) {
  if (!/^[A-Z]{1,6}$/u.test(s.prefix)) throw new LedgerError('คำนำหน้าเลขที่ต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ 1–6 ตัว');
  // TODO(M4): รูปแบบเลขที่อื่นนอกจาก {PREFIX}{YY}{MM}-{SEQ:4} และรอบรีเซ็ตรายปี — ตัวสร้างเลขที่ยังรองรับรูปแบบเดียว
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.doc_setting').values({ company_id: companyId, doc_type: s.docType, prefix: s.prefix, pattern: s.pattern ?? '{PREFIX}{YY}{MM}-{SEQ:4}',
    reset: s.reset ?? 'monthly', settings: JSON.stringify(s.settings ?? {}), updated_at: new Date() })
    .onConflict((oc) => oc.columns(['company_id', 'doc_type']).doUpdateSet({ prefix: s.prefix, pattern: s.pattern ?? '{PREFIX}{YY}{MM}-{SEQ:4}', reset: s.reset ?? 'monthly', settings: JSON.stringify(s.settings ?? {}), updated_at: new Date() })).execute());
}

// ---------- ลิงก์สำหรับลูกค้า (ScreenSendDoc) ----------

export async function shareDocument(db: Db, companyId: string, actor: Actor, id: string, days = 30): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await db.withPublic((tx) => tx.insertInto('public.doc_share').values({ token_hash: sha(token), company_id: companyId, document_id: id, expires_at: new Date(Date.now() + days * 86_400_000), revoked_at: null }).execute());
  await db.withCompany(companyId, async (tx) => {
    await tx.updateTable('acct.document').set({ sent_at: new Date() }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'sent');
  });
  return token;
}
export async function sharedDocument(db: Db, token: string) {
  const s = await db.withPublic((tx) => tx.selectFrom('public.doc_share as s').innerJoin('public.company as c', 'c.id', 's.company_id')
    .select(['s.company_id', 's.document_id', 's.expires_at', 's.revoked_at', 'c.name_th', 'c.tax_id', 'c.branch_code']).where('s.token_hash', '=', sha(token)).executeTakeFirst());
  if (!s || s.revoked_at || (s.expires_at && s.expires_at.getTime() < Date.now())) return null;
  const d = await getDocument(db, s.company_id, s.document_id);
  if (!d || d.doc.status === 'draft') return null;
  return { company: { name: s.name_th, taxId: s.tax_id, branch: s.branch_code }, ...d, events: [], journal: [] };
}
