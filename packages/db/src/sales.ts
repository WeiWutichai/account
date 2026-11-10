// M4 ขาย + รับเงิน (docs/technical-plan-M4.md) — เอกสาร QO/SO/IV/CN/DN/DP/BN/RV · ลงบัญชีผ่าน Posting Engine · ทุกอย่างใน withCompany (RLS)
import { BASE_CURRENCY, carryingCleared, docTotals, Money, post, receiptTotals, settleAtOriginalRate, toBase, type CompanyRole, type JournalLine, type MoneyString, type RuleDefinition } from '@innovera/ledger';
import { bahtText, validateTaxId, whtOnReceipt } from '@innovera/tax-th';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { DEFAULT_RULES } from '@innovera/ledger';
import { LedgerError, nextNumber, postJournalTx, reserveNumber, voidJournalTx } from './ledger-service.ts';
import { emitTx, userNames } from './hub.ts';
import { convertDocumentJournal, docNumberTx, documentFx, FX_GAIN_ACCOUNT, FX_LOSS_ACCOUNT, rateOnTx, settledBaseTx, type DocFxInput } from './fx.ts';

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
  estCost?: MoneyString | null;    // ต้นทุนประมาณรวมของบรรทัด (ใบเสนอราคา · ScreenQuote)
  /** P2A FXB: zero = อัตรา 0% (ส่งออก ม.80/1 · vat_rate 0) · exempt = ยกเว้น · ว่าง = ตาม vat */
  vatCode?: 'vat7' | 'zero' | 'exempt';
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
  // ใบเสนอราคา (ScreenQuote): พนักงานขาย · โครงการ (มิติ) · เงื่อนไขชำระ · ระดับราคา
  salesperson?: string | null;
  projectCode?: string | null;
  paymentTerms?: string | null;
  priceLevel?: number | null;
  lines: SalesLineInput[];
  /** P2A FXB (ต้องเปิดโมดูล): สกุลเอกสาร · อัตรา (ว่าง = อัตรา ณ วันที่เอกสาร) · สาขา (ว่าง = 00000) */
  currency?: DocFxInput['currency'];
  fxRate?: DocFxInput['fxRate'];
  branchCode?: DocFxInput['branchCode'];
}
export interface Actor { userId: string | null; role: CompanyRole }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

/** บรรทัดมี VAT 7% หรือไม่ (vatCode มาก่อน vat) */
const vatOn = (l: Pick<SalesLineInput, 'vat' | 'vatCode'>) => (l.vatCode ? l.vatCode === 'vat7' : (l.vat ?? true));
/** vat_rate ของบรรทัด: 7% = 0.0700 · 0% (ส่งออก) = 0.0000 · ยกเว้น = NULL */
const vatRateOf = (l: Pick<SalesLineInput, 'vat' | 'vatCode'>) => (l.vatCode === 'zero' ? '0.0000' : vatOn(l) ? '0.0700' : null);

export function totalsOf(input: Pick<SalesDraftInput, 'lines' | 'priceInclVat' | 'billDiscount' | 'deposits'>) {
  const items = input.lines.filter((l) => (l.lineType ?? 'item') === 'item');
  for (const l of items) if (!l.qty || !l.unitPrice) throw new LedgerError(`บรรทัด "${l.description}" ต้องมีจำนวนและราคา`);
  const t = docTotals(items.map((l) => ({ qty: l.qty!, unitPrice: l.unitPrice!, discount: l.discount ?? '0.00', vat: vatOn(l) })), { priceInclVat: input.priceInclVat ?? false, billDiscount: input.billDiscount ?? '0.00' });
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

/** เหตุการณ์ของเอกสารที่บันทึกลง audit log ด้วย (ScreenAudit: สร้าง/แก้ไขร่าง/ส่งอนุมัติ/อนุมัติ/ผ่านรายการ/ยกเลิก) · reference_edited บันทึกแยกใน auditEdit */
const AUDITED_EVENTS: Record<string, string> = {
  created: 'document.create', edited: 'document.edit_draft', submitted: 'document.submit', rejected: 'document.reject',
  approved: 'document.approve', posted: 'document.post', voided: 'document.void',
};
export async function event(tx: CompanyTx, companyId: string, documentId: string, actor: string | null, ev: string, detail: unknown = {}) {
  await tx.insertInto('acct.document_event').values({ company_id: companyId, document_id: documentId, actor, event: ev, detail: JSON.stringify(detail) }).execute();
  const action = AUDITED_EVENTS[ev];
  if (action) {
    const d = await tx.selectFrom('acct.document').select(['doc_type', 'doc_no', 'status', 'grand_total', 'journal_id']).where('id', '=', documentId).executeTakeFirst();
    // ยกเลิกเอกสารที่มี journal: voidJournalTx บันทึก journal.void แล้ว — ไม่บันทึกซ้ำ
    if (ev === 'voided' && d?.journal_id) return;
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor, action, entity: 'document', entity_id: documentId, before: null,
      after: JSON.stringify({ ...(detail && typeof detail === 'object' ? detail : {}), doc_type: d?.doc_type ?? null, status: d?.status ?? null, grand_total: d?.grand_total ?? null }), prev_hash: null, hash: null }).execute();
  }
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
  if (input.priceLevel !== undefined && input.priceLevel !== null && (!Number.isInteger(input.priceLevel) || input.priceLevel < 1 || input.priceLevel > 5)) throw new LedgerError('ระดับราคาต้องเป็น 1–5');
  for (const l of input.lines) if (l.estCost && !/^\d+(\.\d{1,2})?$/u.test(l.estCost)) throw new LedgerError(`ต้นทุนประมาณของ "${l.description}" ไม่ถูกต้อง`);
  // TODO(Wei): ใบเดียวที่มีทั้งบรรทัด VAT 7% และ 0% (ส่งออก) — รายงานภาษีขายยังแยกอัตรารายบรรทัดไม่ได้ จึงยังไม่รองรับ
  const items = input.lines.filter((l) => (l.lineType ?? 'item') === 'item');
  if (items.some((l) => l.vatCode === 'zero') && items.some((l) => vatOn(l))) throw new LedgerError('ใบเดียวกันมีทั้ง VAT 7% และ 0% ยังไม่รองรับ — แยกเป็นคนละใบ');
  const fxv = await documentFx(db, companyId, input.issueDate, { currency: input.currency ?? null, fxRate: input.fxRate ?? null, branchCode: input.branchCode ?? null });
  // TODO(Wei): เอกสารสกุลต่างประเทศ — มัดจำ/ใบลดหนี้/เพิ่มหนี้ ยังไม่รองรับ (ต้องยืนยันอัตราที่ใช้ล้างลูกหนี้)
  if (fxv.currency && fxv.currency !== BASE_CURRENCY && (input.deposits?.length || ['DP', 'CN', 'DN'].includes(input.docType))) throw new LedgerError('เอกสารสกุลต่างประเทศยังไม่รองรับมัดจำ/ใบลดหนี้/ใบเพิ่มหนี้');
  const t = totalsOf(input);
  return db.withCompany(companyId, async (tx) => {
    const values = {
      doc_type: input.docType, issue_date: input.issueDate, due_date: input.dueDate ?? null, contact_id: input.contactId, price_incl_vat: input.priceInclVat ?? false,
      subtotal: t.subtotal, discount: t.discount, vat: t.vat, wht: '0.00', grand_total: t.receivable, bill_discount: input.billDiscount ?? '0.00',
      tax_mode: input.taxMode ?? (input.docType === 'IV' ? 'on_payment' : null), rule_code: input.ruleCode ?? DEFAULT_RULE[input.docType] ?? null,
      address: input.address ?? null, notes: input.notes ?? null, reference: input.reference ?? null, ref_document_id: input.refDocumentId ?? null,
      credit_days: input.creditDays ?? null, receive_account: input.receiveAccount ?? null, updated_at: new Date(),
      salesperson: input.salesperson?.trim() || null, project_code: input.projectCode?.trim() || null, payment_terms: input.paymentTerms?.trim() || null, price_level: input.priceLevel ?? null,
      ...fxv,
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
      const r = await tx.insertInto('acct.document').values({ company_id: companyId, ...values, created_by: actor.userId, external_source: null, external_ref: null, doc_no: null, branch_code: '00000', fee: '0.00', ...fxv } as never)
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
        vat_rate: item ? vatRateOf(l) : null, account_code: l.accountCode ?? null, est_cost: item ? l.estCost ?? null : null,
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
    const docNo = opts.docNo ?? d.doc_no ?? (await docNumberTx(tx, companyId, await prefixOf(tx, d.doc_type), d.issue_date, d.branch_code));
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
    const fxl = post(def, {
      docType: d.doc_type,
      amounts: { grand_total: d.grand_total, net: net.toString(), vat: d.vat, discount: d.discount, subtotal: d.subtotal, deposit: deposit.toString() },
      lines: lines.map((l) => ({ amounts: { amount: l.amount }, ...(l.account_code ? { account: l.account_code } : {}), ...(l.revenue_account ? { productAccount: l.revenue_account } : {}) })),
      contact: { arAccount: '1130100', ...(d.contact_id ? { id: d.contact_id } : {}) },
      accounts: { ...(d.receive_account ? { cash: d.receive_account } : {}) },
    }).map((l) => (l.account === '1130100' && d.contact_id ? { ...l, contactId: d.contact_id } : l));
    // P2A FXB: เอกสารสกุลต่างประเทศ → journal บาท (เอกสารบาทไม่เปลี่ยน)
    const { lines: jl, thb } = await convertDocumentJournal(tx, d, fxl);
    const j = await postJournalTx(tx, companyId, { date: d.issue_date, lines: jl, role: actor.role, book: BOOK[d.doc_type] ?? 'SJ', prefix: 'JV', description: `${docNo}`,
      sourceDocumentId: id, ...(versionId ? { ruleVersionId: versionId } : {}), ...(d.branch_code !== '00000' ? { branchCode: d.branch_code } : {}) });
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: j.id, approved_by: actor.userId, approved_at: new Date(), updated_at: new Date(), ...(thb ?? {}) }).where('id', '=', id).execute();
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
  /** P2A FXB: อัตรา ณ วันรับ (ใบแจ้งหนี้สกุลต่างประเทศ · ว่าง = อัตรา ณ วันที่รับ) — ยอดใน applications/fee เป็นสกุลของใบแจ้งหนี้ */
  fxRate?: string | null;
  /** สาขาที่รับ (ว่าง = สาขาของใบแจ้งหนี้ใบแรก) */
  branchCode?: string | null;
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
    const branch = input.branchCode ?? apps[0]!.o.doc.branch_code;
    // P2A FXB: ใบแจ้งหนี้สกุลต่างประเทศ (ทุกใบต้องสกุลเดียวกัน) — ยอดรับเป็นสกุลนั้น · ล้างลูกหนี้ตามอัตราเดิม · ผลต่าง → 4910100 / 5920100
    const currency = apps[0]!.o.doc.currency;
    if (apps.some(({ o }) => o.doc.currency !== currency)) throw new LedgerError('รับชำระใบแจ้งหนี้ต่างสกุลเงินในใบเดียวกันไม่ได้');
    const fx = currency === BASE_CURRENCY ? null : await receiptFxTx(tx, currency, input.date, input.fxRate ?? null,
      apps.map(({ o, a }, i) => ({ doc: o.doc, settledFx: Money.of(a.applied).plus(Money.of(a.wht)), outstandingFx: o.outstanding, vatDueFx: totals.perDoc[i]!.vatDue, settledBeforeFx: o.settled.plus(o.credited) })), totals);
    const docNo = input.docNo ?? (await docNumberTx(tx, companyId, await prefixOf(tx, 'RV'), input.date, branch));
    if (input.docNo) await reserveNumber(tx, companyId, input.docNo);
    const rv = await tx.insertInto('acct.document').values({
      company_id: companyId, doc_type: 'RV', doc_no: docNo, status: 'posted', issue_date: input.date, due_date: null, contact_id: input.contactId, price_incl_vat: false,
      subtotal: totals.settled, discount: '0.00', vat: totals.vatDue, wht: totals.wht, grand_total: totals.cashIn, fee: totals.fee, fee_account: input.feeAccount ?? '5401100',
      receive_account: input.receiveAccount, wht_cert_no: input.whtCertNo ?? null, wht_rate: input.whtRate ?? null, ref_document_id: input.billingId ?? null,
      rule_code: 'Receive[RV]', notes: input.notes ?? null, created_by: actor.userId, approved_by: actor.userId, approved_at: new Date(), external_source: null, external_ref: null, branch_code: branch, bill_discount: '0.00',
      ...(fx ? { currency, fx_rate: fx.rate, grand_total_thb: fx.cashIn.toString(), vat_thb: fx.vatDue.toString(), base_thb: fx.settled.minus(fx.vatDue).toString() } : {}),
    } as never).returning('id').executeTakeFirstOrThrow();
    for (const [i, { a }] of apps.entries()) {
      await tx.insertInto('acct.settlement').values({ company_id: companyId, payment_id: rv.id, document_id: a.documentId, applied: a.applied, wht: a.wht, wht_base: a.whtBase ?? null, vat_due: totals.perDoc[i]!.vatDue, voided: false,
        ...(fx ? { settled_thb: fx.perDoc[i]!.settled.toString(), vat_due_thb: fx.perDoc[i]!.vatDue.toString() } : {}) }).execute();
    }
    const { def, versionId } = await ruleFor(tx, 'Receive[RV]');
    const amounts = fx
      ? { cash_in: fx.cashIn.toString(), wht: fx.wht.toString(), fee: fx.fee.toString(), vat_due: fx.vatDue.toString(), settled: fx.cashIn.plus(fx.wht).plus(fx.fee).toString() }
      : { cash_in: totals.cashIn, wht: totals.wht, fee: totals.fee, vat_due: totals.vatDue, settled: totals.settled };
    let jl: JournalLine[] = post(def, {
      docType: 'RV', amounts,
      contact: { arAccount: '1130100', id: input.contactId }, accounts: { cash: input.receiveAccount, ...(input.feeAccount ? { fee: input.feeAccount } : {}) },
    }).map((l) => (l.account === '1130100' ? { ...l, contactId: input.contactId } : l));
    if (fx) {
      // บรรทัดลูกหนี้ = ยอดบาทตามอัตราเดิม · ผลต่าง = กำไร/ขาดทุนจากอัตราแลกเปลี่ยนที่เกิดขึ้นจริง
      const idx = jl.findIndex((l) => l.account === '1130100' && l.side === 'Cr');
      jl = settleAtOriginalRate(jl, idx, fx.settled, { gain: FX_GAIN_ACCOUNT, loss: FX_LOSS_ACCOUNT }).lines
        .map((l) => (l.account === '1130100' ? { ...l, fx: { currency, amount: Money.of(totals.settled) } }
          : l.account === input.receiveAccount && l.side === 'Dr' ? { ...l, fx: { currency, amount: Money.of(totals.cashIn) } } : l));
    }
    const j = await postJournalTx(tx, companyId, { date: input.date, lines: jl, role: actor.role, book: 'RJ', prefix: 'JV', description: docNo, sourceDocumentId: rv.id, ...(versionId ? { ruleVersionId: versionId } : {}),
      ...(branch !== '00000' ? { branchCode: branch } : {}) });
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

/**
 * P2A FXB ยอดบาทของใบรับชำระสกุลต่างประเทศ: เงินรับ/ภาษีถูกหัก/ค่าธรรมเนียม = × อัตราวันรับ · ลูกหนี้ที่ล้าง = อัตราเดิมของแต่ละใบ (ตัดครบ = ยอดบาทคงเหลือ)
 * ภาษีขายที่ถึงกำหนด (ม.78/1) = สัดส่วนของ VAT บาทตามใบแจ้งหนี้ (สะสม · รับครบ = VAT บาททั้งใบพอดี)
 * TODO(Wei): ฐาน/ภาษีขายของบริการที่จุดภาษีเกิดเมื่อรับเงิน ใช้อัตราวันออกใบแจ้งหนี้ (ให้ 2150400 ล้างหมด) — หรือควรใช้อัตราวันรับเงิน รอผู้สอบบัญชี
 * TODO(Wei): ภาษีถูกหัก ณ ที่จ่าย/ค่าธรรมเนียมของใบสกุลต่างประเทศคิดเป็นบาทที่อัตราวันรับ — รอผู้สอบบัญชี
 */
async function receiptFxTx(tx: CompanyTx, currency: string, date: string, rateIn: string | null,
  apps: { doc: { id: string; fx_rate: string | null; grand_total: string; grand_total_thb: string | null; vat: string; vat_thb: string | null }; settledFx: Money; outstandingFx: Money; vatDueFx: MoneyString; settledBeforeFx: Money }[],
  totals: { cashIn: MoneyString; wht: MoneyString; fee: MoneyString }) {
  const rate = rateIn ?? (await rateOnTx(tx, currency, date));
  const perDoc = [];
  for (const a of apps) {
    if (!a.doc.fx_rate || !a.doc.grand_total_thb) throw new LedgerError('ใบแจ้งหนี้สกุลต่างประเทศไม่มีอัตราแลกเปลี่ยน');
    const before = await settledBaseTx(tx, a.doc.id);
    const settled = carryingCleared({ settleFx: a.settledFx, openFxBefore: a.outstandingFx, openBaseBefore: Money.parse(a.doc.grand_total_thb).minus(before.settledThb), rate: a.doc.fx_rate });
    let vatDue = Money.zero();
    if (!Money.of(a.vatDueFx).isZero()) {
      const cum = a.settledBeforeFx.plus(a.settledFx);
      const vatThb = Money.parse(a.doc.vat_thb ?? a.doc.vat);
      const target = cum.equals(Money.parse(a.doc.grand_total)) ? vatThb : vatThb.ratio(cum, Money.parse(a.doc.grand_total)).round();
      vatDue = target.minus(before.vatDueThb);
    }
    perDoc.push({ settled, vatDue });
  }
  return {
    rate, perDoc, settled: Money.sum(perDoc.map((p) => p.settled)), vatDue: Money.sum(perDoc.map((p) => p.vatDue)),
    cashIn: toBase(totals.cashIn, rate), wht: toBase(totals.wht, rate), fee: toBase(totals.fee, rate),
  };
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
  return db.withCompany(companyId, (tx) => voidDocumentTx(tx, companyId, actor, id, p));
}

/** ยกเลิกเอกสารภายใน transaction ที่มีอยู่ (เช่น เช็คคืน = ยกเลิกใบรับชำระ + กลับรายการนำฝาก ใน transaction เดียว) */
export async function voidDocumentTx(tx: CompanyTx, companyId: string, actor: Actor, id: string, p: { reason: string; date?: string }) {
  if (!p.reason.trim()) throw new LedgerError('ต้องระบุเหตุผลการยกเลิก');
  {
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
  }
}

/** หลังผ่านรายการแก้ได้เฉพาะข้อมูลอ้างอิง (CLAUDE.md) — ยอด/ภาษี/บัญชีแก้ไม่ได้ */
export const REFERENCE_FIELDS = ['address', 'notes', 'reference', 'due_date'] as const;
/** งวดของเอกสาร: ปิดแข็ง → แก้ไม่ได้ทุกช่อง · ปิดอ่อน → ผู้จัดการบัญชีขึ้นไป (ScreenDocEdit) */
async function assertEditable(tx: CompanyTx, actor: Actor, issueDate: string) {
  const p = await tx.selectFrom('acct.period').select(['status', 'period_no', 'fiscal_year']).where('starts_on', '<=', issueDate).where('ends_on', '>=', issueDate)
    .where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirst();
  if (p?.status === 'hard_closed') throw new LedgerError(`งวด ${p.period_no}/${p.fiscal_year} ปิดแข็งแล้ว — ต้องเปิดงวดคืนพร้อมเหตุผลก่อนแก้ไข`);
  if (p?.status === 'soft_closed' && !['owner', 'accounting_manager'].includes(actor.role)) throw new LedgerError(`งวด ${p.period_no}/${p.fiscal_year} ปิดอ่อนแล้ว — ผู้จัดการบัญชีขึ้นไปเท่านั้นที่แก้ได้`);
}

async function auditEdit(tx: CompanyTx, companyId: string, actor: Actor, id: string, before: unknown, after: unknown) {
  await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'document.edit_posted', entity: 'document', entity_id: id,
    before: JSON.stringify(before), after: JSON.stringify(after), prev_hash: null, hash: null }).execute();
}

export async function editReference(db: Db, companyId: string, actor: Actor, id: string, input: Partial<Record<(typeof REFERENCE_FIELDS)[number], string | null>> & Record<string, unknown> & { reason?: string }) {
  const { reason, ...patch } = input;
  const bad = Object.keys(patch).filter((k) => !(REFERENCE_FIELDS as readonly string[]).includes(k));
  if (bad.length) throw new LedgerError(`แก้ไม่ได้หลังผ่านรายการ: ${bad.join(', ')} — ต้องยกเลิกแล้วออกใหม่`);
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (d.status === 'voided') throw new LedgerError('เอกสารถูกยกเลิกแล้ว');
    await assertEditable(tx, actor, d.issue_date);
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (d as Record<string, unknown>)[k] ?? null]));
    await tx.updateTable('acct.document').set({ ...(patch as Record<string, string | null>), updated_at: new Date() }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'reference_edited', { before, after: patch, ...(reason ? { reason } : {}) });
    await auditEdit(tx, companyId, actor, id, before, { ...patch, reason: reason ?? null });
  });
}

export interface PurchaseEditInput {
  partyTaxId?: string | null; vendorRef?: string | null; vendorInvoiceDate?: string | null; projectCode?: string | null;
  lines?: { lineId: string; accountCode: string }[]; reason: string; date: string; // date = วันที่ของ JV โอนย้ายบัญชี
}

/**
 * แก้บิลซื้อ/ค่าใช้จ่ายที่ผ่านรายการแล้ว (ScreenDocEdit): เลขผู้เสียภาษีผู้ขาย (อัปเดตรายงานภาษีซื้อ · ยอดไม่เปลี่ยน) · เลขที่/วันที่ใบกำกับผู้ขาย (วันที่ภายในงวดเดียวกัน)
 * · มิติ/โครงการ (ไม่กระทบ GL) · บัญชีค่าใช้จ่ายของบรรทัด → JV โอนย้ายบัญชี Dr ใหม่ / Cr เดิม (ผูกเอกสารต้นทาง)
 * จำนวนเงิน / VAT / อัตราหัก / ผู้ขาย แก้ไม่ได้ — ยกเลิกแล้วออกใหม่ หรือออกใบลดหนี้/เพิ่มหนี้
 */
export async function editPurchaseDoc(db: Db, companyId: string, actor: Actor, id: string, input: PurchaseEditInput) {
  if (!input.reason?.trim()) throw new LedgerError('ต้องระบุเหตุผลการแก้ไข');
  return db.withCompany(companyId, async (tx) => {
    const d = await docOrThrow(tx, id);
    if (!['AP', 'EXP'].includes(d.doc_type)) throw new LedgerError('แก้ได้เฉพาะบิลซื้อและค่าใช้จ่าย');
    if (d.status !== 'posted') throw new LedgerError('แก้ได้เฉพาะเอกสารที่ผ่านรายการแล้ว');
    await assertEditable(tx, actor, d.issue_date);
    const patch: Record<string, string | null> = {};
    if (input.partyTaxId !== undefined) {
      if (input.partyTaxId && !validateTaxId(input.partyTaxId)) throw new LedgerError('เลขประจำตัวผู้เสียภาษีของผู้ขายไม่ถูกต้อง (13 หลัก · checksum)');
      patch.party_tax_id = input.partyTaxId || null;
    }
    if (input.vendorRef !== undefined) patch.vendor_ref = input.vendorRef || null;
    if (input.vendorInvoiceDate !== undefined) {
      if (input.vendorInvoiceDate && input.vendorInvoiceDate.slice(0, 7) !== d.issue_date.slice(0, 7)) throw new LedgerError('วันที่ในใบกำกับของผู้ขายแก้ได้ภายในงวดเดียวกันเท่านั้น');
      patch.vendor_invoice_date = input.vendorInvoiceDate || null;
    }
    if (input.projectCode !== undefined) patch.project_code = input.projectCode || null;
    const before: Record<string, unknown> = Object.fromEntries(Object.keys(patch).map((k) => [k, (d as Record<string, unknown>)[k] ?? null]));
    let journalNo: string | null = null;
    const moves = [];
    for (const m of input.lines ?? []) {
      const l = await tx.selectFrom('acct.document_line').select(['id', 'account_code', 'amount', 'description']).where('id', '=', m.lineId).where('document_id', '=', id).executeTakeFirst();
      if (!l) throw new LedgerError('ไม่พบบรรทัดของเอกสาร');
      if (!l.account_code || l.account_code === m.accountCode) continue;
      const acct = await tx.selectFrom('acct.account').select(['code', 'is_control']).where('code', '=', m.accountCode).executeTakeFirst();
      if (!acct || acct.is_control || !(m.accountCode.startsWith('5') || /^15[1-4]/u.test(m.accountCode))) throw new LedgerError(`บัญชี ${m.accountCode} ใช้เป็นบัญชีค่าใช้จ่าย/สินทรัพย์ไม่ได้`);
      moves.push({ ...l, to: m.accountCode });
    }
    if (moves.length) {
      const lines = moves.flatMap((m) => [{ side: 'Dr' as const, account: m.to, amount: Money.parse(m.amount) }, { side: 'Cr' as const, account: m.account_code!, amount: Money.parse(m.amount) }]);
      const j = await postJournalTx(tx, companyId, { date: input.date, lines, role: actor.role, book: 'GJ', sourceDocumentId: id, description: `โอนย้ายบัญชี ${d.doc_no ?? ''}: ${input.reason.trim()}` });
      journalNo = j.journalNo;
      for (const m of moves) await tx.updateTable('acct.document_line').set({ account_code: m.to }).where('id', '=', m.id).execute();
      before.lines = moves.map((m) => ({ lineId: m.id, account: m.account_code }));
    }
    if (!Object.keys(patch).length && !moves.length) throw new LedgerError('ไม่มีช่องที่เปลี่ยน');
    if (Object.keys(patch).length) await tx.updateTable('acct.document').set({ ...patch, updated_at: new Date() }).where('id', '=', id).execute();
    const after = { ...patch, ...(moves.length ? { lines: moves.map((m) => ({ lineId: m.id, account: m.to })), journal: journalNo } : {}), reason: input.reason.trim() };
    await event(tx, companyId, id, actor.userId, 'reference_edited', { before, after });
    await auditEdit(tx, companyId, actor, id, before, after);
    return { changed: Object.keys(patch).length + moves.length, journalNo };
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
    salesperson: src.doc.salesperson, projectCode: src.doc.project_code, paymentTerms: src.doc.payment_terms, priceLevel: src.doc.price_level,
    lines: src.lines.map((l) => ({ lineType: l.line_type, productCode: l.product_code, description: l.description, qty: l.qty ?? undefined, unitPrice: l.unit_price ?? undefined, discount: l.discount, vat: l.vat_rate !== null, accountCode: l.account_code, estCost: l.est_cost })),
  } as SalesDraftInput);
  await db.withCompany(companyId, (tx) => event(tx, companyId, id, actor.userId, 'converted', { to, id: newId }));
  return newId;
}

// ---------- อ่าน ----------

/** เอกสาร + ประวัติ (events[].actor_name = ชื่อจาก Innovera ID · created_by_client_name = API client ที่สร้าง) */
export async function getDocument(db: Db, companyId: string, id: string) {
  const r = await loadDocument(db, companyId, id);
  if (!r) return null;
  const names = await userNames(db, [...r.events.map((e) => e.actor), r.doc.created_by, r.doc.approved_by]);
  const client = r.doc.created_by_client
    ? await db.withPublic((tx) => tx.selectFrom('public.api_client').select('name').where('id', '=', r.doc.created_by_client!).executeTakeFirst())
    : undefined;
  return { ...r, events: r.events.map((e) => ({ ...e, actor_name: e.actor ? names[e.actor] ?? null : null })),
    created_by_name: r.doc.created_by ? names[r.doc.created_by] ?? null : null, approved_by_name: r.doc.approved_by ? names[r.doc.approved_by] ?? null : null,
    created_by_client_name: client?.name ?? null };
}
async function loadDocument(db: Db, companyId: string, id: string) {
  return db.withCompany(companyId, async (tx) => {
    const doc = await tx.selectFrom('acct.document').selectAll().where('id', '=', id).executeTakeFirst();
    if (!doc) return null;
    const lines = await tx.selectFrom('acct.document_line as l').leftJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'l.product_code').onRef('p.company_id', '=', 'l.company_id'))
      .selectAll('l').select(['p.unit', 'p.est_cost as product_est_cost', 'p.vat_code as product_vat_code', 'p.vat_exempt_reason']).where('l.document_id', '=', id).orderBy('l.line_no').execute();
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
        'd.salesperson', 'd.project_code', 'c.id as contact_id', 'c.code as contact_code', 'c.name as contact_name', 'c.tax_id as contact_tax_id',
        // ยอดตัดชำระ = รับ/จ่าย (รวมภาษีถูกหัก) + ใบลดหนี้ — ตรงกับ outstandingTx (ไม่นับมัดจำที่หักในใบ ซึ่งหักจาก grand_total แล้ว)
        sql<string>`coalesce((select sum(case when p.doc_type in ('RV', 'PV') then s.applied + s.wht else s.applied end) from acct.settlement s
          join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
          where s.document_id = d.id and s.company_id = d.company_id and not s.voided and p.doc_type in ('RV', 'PV', 'CN', 'CNR')), 0)`.as('settled')])
      .orderBy('d.issue_date', 'desc').orderBy('d.doc_no', 'desc').limit(f.limit ?? 500);
    if (f.docType) q = q.where('d.doc_type', 'in', Array.isArray(f.docType) ? f.docType : [f.docType]);
    if (f.status) q = q.where('d.status', '=', f.status as never);
    if (f.from) q = q.where('d.issue_date', '>=', f.from);
    if (f.to) q = q.where('d.issue_date', '<=', f.to);
    if (f.contactId) q = q.where('d.contact_id', '=', f.contactId);
    if (f.q) q = q.where((eb) => eb.or([eb('d.doc_no', 'ilike', `%${f.q}%`), eb('c.name', 'ilike', `%${f.q}%`), eb('c.code', 'ilike', `%${f.q}%`), eb('c.tax_id', 'ilike', `%${f.q}%`),
      eb('d.vendor_ref', 'ilike', `%${f.q}%`)]));
    const rows = await q.execute();
    // ยอดค้าง: ขาย IV/DN · ซื้อ AP/EXP(ไม่ได้จ่ายทันที)/DNR
    const open = (r: (typeof rows)[number]) => r.status === 'posted' && (['IV', 'DN', 'AP', 'DNR'].includes(r.doc_type) || (r.doc_type === 'EXP' && !r.pay_now));
    return rows.map((r) => ({ ...r, outstanding: open(r) ? Money.parse(r.grand_total).minus(Money.parse(r.settled)).toString() : null }));
  });
}

/**
 * เลขใบกำกับของผู้ขายที่บันทึกแล้ว (ScreenPurchaseBill "ไม่ซ้ำกับบิลเดิมของผู้ขายรายนี้") · ไม่นับเอกสารที่ยกเลิก
 * ref = ตรวจเลขเดียว (เทียบแบบไม่สนช่องว่างหัวท้าย/ตัวพิมพ์) · exclude = เอกสารที่กำลังแก้
 */
export async function vendorRefs(db: Db, companyId: string, p: { contactId: string; ref?: string; excludeId?: string; types?: string[] }) {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.document').select(['id', 'doc_no', 'doc_type', 'status', 'vendor_ref', 'issue_date'])
      .where('contact_id', '=', p.contactId).where('vendor_ref', 'is not', null).where('status', '!=', 'voided')
      .where('doc_type', 'in', p.types?.length ? p.types : ['AP', 'EXP', 'CNR', 'DNR']).orderBy('issue_date', 'desc');
    if (p.ref) q = q.where(sql<string>`lower(trim(vendor_ref))`, '=', p.ref.trim().toLowerCase());
    if (p.excludeId) q = q.where('id', '!=', p.excludeId);
    const rows = await q.execute();
    return rows.map((r) => ({ ...r, vendor_ref: r.vendor_ref!.trim() }));
  });
}

/** ค่าที่เคยใช้ในเอกสาร (ตัวเลือก "พนักงานขาย" / "โครงการ (มิติ)" ใน ScreenQuote) — ยังไม่มีทะเบียนพนักงานขาย/โครงการ */
export async function documentFieldValues(db: Db, companyId: string) {
  return db.withCompany(companyId, async (tx) => {
    const sp = await tx.selectFrom('acct.document').select('salesperson').distinct().where('salesperson', 'is not', null).orderBy('salesperson').execute();
    const pj = await tx.selectFrom('acct.document').select('project_code').distinct().where('project_code', 'is not', null).orderBy('project_code').execute();
    return { salespersons: sp.map((r) => r.salesperson!), projects: pj.map((r) => r.project_code!) };
  });
}

/** บันทึกการพิมพ์ต้นฉบับ (ครั้งที่ 2 เป็นต้นไปพิมพ์เป็นสำเนา) · คืนจำนวนครั้งหลังบันทึก */
export async function markPrinted(db: Db, companyId: string, actor: Actor, id: string): Promise<{ printCount: number }> {
  return db.withCompany(companyId, async (tx) => {
    const r = await tx.updateTable('acct.document').set((eb) => ({ print_count: eb('print_count', '+', 1) })).where('id', '=', id).where('status', '!=', 'draft')
      .returning('print_count').executeTakeFirst();
    if (!r) throw new LedgerError('ไม่พบเอกสาร หรือเอกสารยังเป็นร่าง');
    // ไม่ลง document_event (ประวัติเอกสารในแบบร่างไม่มีรายการ "พิมพ์") — เก็บใน audit_log
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'document.print', entity: 'document', entity_id: id,
      before: null, after: JSON.stringify({ print_count: r.print_count }), prev_hash: null, hash: null }).execute();
    return { printCount: r.print_count };
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
