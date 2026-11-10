// M6 รายงานภาษี · อายุหนี้ · งบ · ตรวจความถูกต้อง (docs/technical-plan-M6.md) — คำนวณจากเอกสาร/GL จริงเท่านั้น
// จุดภาษีขาย: บริการ = วันที่รับเงิน (RV ที่โอน 2150400 → 2150100 · ม.78/1) · ใบกำกับทันที (IV immediate / DP / CN / DN) = วันที่ออก
// ภาษีซื้อ: เดือนที่ใช้สิทธิ์ = document.vat_claim_month (ม.82/3 ไม่เกิน 6 เดือน) · ว่าง = เดือนตามบิล
import { Money, type CompanyRole, type JournalLine, type MoneyString } from '@innovera/ledger';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, postJournalTx, trialBalance } from './ledger-service.ts';

const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const neg = (s: string) => Money.parse(s).neg().toString();
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/u;
/** '2026-11' + n เดือน */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// ---------- ค่าตั้ง (acct.company_setting) ----------
/** บัญชีค่าใช้จ่ายที่ภาษีซื้อเป็นภาษีซื้อต้องห้าม (เช่น ค่ารับรอง) — ค่าตั้งต้น [] · TODO(Wei): กำหนดบัญชีที่เป็นภาษีซื้อต้องห้าม (ระบบไม่ตัดสินเอง) */
export const DISALLOWED_INPUT_VAT_KEY = 'tax.vat.disallowed_input_accounts';
/** บัญชีภาษีชำระเกิน (ยกไป/ขอคืน) ของ ภ.พ.30 — ไม่มีค่าตั้งต้น · TODO(Wei): ผังบัญชีใน fixtures ไม่มีบัญชีนี้ ต้องกำหนดก่อนยื่นเดือนที่ภาษีซื้อ > ภาษีขาย */
export const VAT_EXCESS_ACCOUNT_KEY = 'tax.vat.excess_account';
async function setting<T>(tx: CompanyTx, key: string, fallback: T): Promise<T> {
  const r = await tx.selectFrom('acct.company_setting').select('value').where('key', '=', key).executeTakeFirst();
  return r ? (r.value as T) : fallback;
}

export interface VatRow { date: string; docId: string; docNo: string; docType: string; partner: string; taxId: string | null; branch: string | null; base: string; vat: string; vendorRef?: string | null; claimMonth?: string; priorMonth?: boolean }

async function salesRows(tx: CompanyTx, from: string, to: string): Promise<VatRow[]> {
  const docs = await tx.selectFrom('acct.document as d').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.subtotal', 'd.discount', 'd.vat', 'd.tax_mode', 'c.name', 'c.tax_id', 'c.branch_code'])
    .where('d.status', '=', 'posted').where('d.issue_date', '>=', from).where('d.issue_date', '<=', to)
    .where((eb) => eb.or([
      eb.and([eb('d.doc_type', '=', 'RV'), eb('d.vat', '>', '0')]),
      eb.and([eb('d.doc_type', '=', 'IV'), eb('d.tax_mode', '=', 'immediate')]),
      eb('d.doc_type', 'in', ['CN', 'DN', 'DP']),
    ])).orderBy('d.issue_date').orderBy('d.doc_no').execute();
  const rows: VatRow[] = docs.map((d) => {
    // RV: subtotal = ยอดที่รับ (รวมภาษีถูกหัก) · ฐาน = รับ − ภาษีขายที่โอน (fixtures RV2611-0021 = 1,458,130.84)
    const base = d.doc_type === 'RV' ? Money.parse(d.subtotal).minus(Money.parse(d.vat)).toString() : Money.parse(d.subtotal).minus(Money.parse(d.discount)).toString();
    const sign = d.doc_type === 'CN' ? -1 : 1;
    return { date: d.issue_date, docId: d.id, docNo: d.doc_no ?? '', docType: d.doc_type, partner: d.name ?? '', taxId: d.tax_id, branch: d.branch_code,
      base: sign < 0 ? neg(base) : base, vat: sign < 0 ? neg(d.vat) : d.vat };
  });
  // ขายทรัพย์สินที่มีภาษีขาย (disposeAsset · close-ops.ts) — จุดภาษี = วันที่ขาย
  const sold = await tx.selectFrom('acct.fixed_asset as a').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'a.disposal_contact_id').onRef('c.company_id', '=', 'a.company_id'))
    .leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'a.disposal_journal_id').onRef('j.company_id', '=', 'a.company_id'))
    .select(['a.id', 'a.code', 'a.disposed_on', 'a.sale_amount', 'a.sale_vat', 'a.disposal_ref', 'j.journal_no', 'c.name', 'c.tax_id', 'c.branch_code'])
    .where('a.status', '=', 'disposed').where('a.disposed_on', '>=', from).where('a.disposed_on', '<=', to).where('a.sale_vat', '>', '0').execute();
  for (const a of sold) {
    rows.push({ date: a.disposed_on!, docId: a.id, docNo: a.disposal_ref ?? a.journal_no ?? a.code, docType: 'FA', partner: a.name ?? '', taxId: a.tax_id, branch: a.branch_code,
      base: Money.parse(a.sale_amount ?? '0').toString(), vat: Money.parse(a.sale_vat ?? '0').toString() });
  }
  return rows.sort((a, b) => (a.date === b.date ? a.docNo.localeCompare(b.docNo) : a.date < b.date ? -1 : 1));
}

const CLAIM = sql<string>`coalesce(d.vat_claim_month, to_char(d.issue_date, 'YYYY-MM'))`;

/** ภาษีซื้อที่ใช้สิทธิ์ในเดือน fromYm..toYm · แยกภาษีซื้อต้องห้าม (ทุกบรรทัดลงบัญชีที่ตั้งไว้ใน tax.vat.disallowed_input_accounts) */
async function purchaseRows(tx: CompanyTx, fromYm: string, toYm: string): Promise<{ rows: VatRow[]; disallowed: VatRow[] }> {
  const disallowedAccounts = await setting<string[]>(tx, DISALLOWED_INPUT_VAT_KEY, []);
  const docs = await tx.selectFrom('acct.document as d').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.subtotal', 'd.discount', 'd.vat', 'd.vendor_ref', 'c.name', sql<string | null>`coalesce(d.party_tax_id, c.tax_id)`.as('tax_id'), 'c.branch_code',
      CLAIM.as('claim_month'),
      sql<string[]>`array(select l.account_code from acct.document_line l where l.document_id = d.id and l.company_id = d.company_id and l.line_type = 'item' and l.account_code is not null)`.as('accounts')])
    .where('d.status', '=', 'posted').where(CLAIM, '>=', fromYm).where(CLAIM, '<=', toYm).where('d.doc_type', 'in', ['AP', 'EXP', 'DNR', 'CNR']).where('d.vat', '>', '0')
    .orderBy('d.issue_date').orderBy('d.doc_no').execute();
  const rows: VatRow[] = [];
  const disallowed: VatRow[] = [];
  for (const d of docs) {
    const base = Money.parse(d.subtotal).minus(Money.parse(d.discount)).toString();
    const cn = d.doc_type === 'CNR';
    const row: VatRow = { date: d.issue_date, docId: d.id, docNo: d.doc_no ?? '', docType: d.doc_type, partner: d.name ?? '', taxId: d.tax_id, branch: d.branch_code, vendorRef: d.vendor_ref,
      base: cn ? neg(base) : base, vat: cn ? neg(d.vat) : d.vat, claimMonth: d.claim_month, priorMonth: d.issue_date.slice(0, 7) < d.claim_month };
    // TODO(Wei): บิลที่มีทั้งบรรทัดต้องห้ามและบรรทัดปกติ — ยังไม่แยกภาษีซื้อรายบรรทัด (นับเป็นภาษีซื้อปกติ)
    if (disallowedAccounts.length && d.accounts.length && d.accounts.every((a) => disallowedAccounts.includes(a))) disallowed.push(row);
    else rows.push(row);
  }
  // เงินสดย่อยที่มีใบกำกับเต็มรูป (vat_mode full_invoice): ภาษีซื้อลง GL 1170100 ตอนเบิกชดเชย (fixtures petty_cash.reimburse_journal)
  // → แสดงในรายงานภาษีซื้อเดือนที่เบิกชดเชย ให้ตรงกับ GL และ ภ.พ.30
  // TODO(Wei): เดือนที่ใช้สิทธิ์ของเงินสดย่อย = เดือนที่เบิกชดเชย (ไม่ใช่เดือนตามใบกำกับ) · ไม่มีชื่อ/เลขผู้ขายถ้าไม่ได้ระบุคู่ค้าในรายการ
  const pcClaim = sql<string>`coalesce(d.vat_claim_month, to_char(j.journal_date, 'YYYY-MM'))`;
  const pcs = await tx.selectFrom('acct.document as d').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'd.journal_id').onRef('j.company_id', '=', 'd.company_id'))
    .leftJoin('acct.contact as c', (jn) => jn.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.doc_no', 'd.issue_date', 'd.subtotal', 'd.discount', 'd.vat', 'c.name',
      sql<string | null>`(select l.description from acct.document_line l where l.document_id = d.id and l.company_id = d.company_id order by l.line_no limit 1)`.as('line_desc'), sql<string | null>`coalesce(d.party_tax_id, c.tax_id)`.as('tax_id'), 'c.branch_code', pcClaim.as('claim_month')])
    .where('d.doc_type', '=', 'PC').where('d.status', '=', 'approved').where('d.vat', '>', '0').where('j.status', '=', 'posted')
    .where(pcClaim, '>=', fromYm).where(pcClaim, '<=', toYm).orderBy('d.issue_date').orderBy('d.doc_no').execute();
  for (const d of pcs) {
    rows.push({ date: d.issue_date, docId: d.id, docNo: d.doc_no ?? '', docType: 'PC', partner: d.name ?? d.line_desc ?? '', taxId: d.tax_id, branch: d.branch_code, vendorRef: null,
      base: Money.parse(d.subtotal).minus(Money.parse(d.discount)).toString(), vat: d.vat, claimMonth: d.claim_month, priorMonth: d.issue_date.slice(0, 7) < d.claim_month });
  }
  rows.sort((a, b) => (a.date === b.date ? a.docNo.localeCompare(b.docNo) : a.date < b.date ? -1 : 1));
  return { rows, disallowed };
}
const vsum = (rows: VatRow[], k: 'base' | 'vat') => Money.sum(rows.map((r) => Money.parse(r[k]))).toString();

/** ใบแจ้งหนี้บริการที่ภาษีขายยังไม่ถึงกำหนด (2150400) ณ วันที่ to · issuedFrom = เฉพาะที่ออกตั้งแต่วันนั้น */
async function deferredVatDocs(tx: CompanyTx, to: string, issuedFrom?: string) {
  let q = tx.selectFrom('acct.document as d').innerJoin('acct.journal_line as l', (jn) => jn.onRef('l.journal_id', '=', 'd.journal_id').onRef('l.company_id', '=', 'd.company_id'))
    .leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.grand_total', 'c.name', sql<string>`sum(l.credit - l.debit)`.as('vat'),
      sql<string>`coalesce((select sum(s.vat_due) from acct.settlement s join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
        where s.document_id = d.id and s.company_id = d.company_id and not s.voided and p.issue_date <= ${to}), 0)`.as('due')])
    .where('d.doc_type', 'in', ['IV', 'DN', 'CN']).where('d.status', '=', 'posted').where('d.issue_date', '<=', to).where('l.account_code', '=', '2150400');
  if (issuedFrom) q = q.where('d.issue_date', '>=', issuedFrom);
  const rows = await q.groupBy(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.grand_total', 'c.name']).orderBy('d.issue_date').orderBy('d.doc_no').execute();
  return rows.map((r) => ({ docId: r.id, docNo: r.doc_no ?? '', docType: r.doc_type, date: r.issue_date, partner: r.name ?? '', vatPending: Money.parse(r.vat).minus(Money.parse(r.due)).toString() }));
}

// ---------- ภ.พ.30: รายการบัญชีเมื่อยื่น ----------
type Pp30Line = [string, string | null, MoneyString]; // [Dr/Cr, บัญชี (null = ยังไม่ได้กำหนดบัญชีภาษีชำระเกิน), ยอด]
/**
 * ล้างภาษีขาย/ภาษีซื้อเข้าบัญชีภาษีค้างจ่าย (fixtures pp30.post_on_filed: Dr 2150100 / Cr 1170100 / Cr 2150200)
 * ภาษีชำระเกินยกมา (ข้อ 10) = Cr บัญชีภาษีชำระเกิน · ภาษีซื้อ > ภาษีขาย = Dr บัญชีภาษีชำระเกิน (ยกไป/ขอคืน)
 * TODO(Wei): fixtures ไม่มีกรณีภาษีชำระเกิน/ขอคืน — บัญชีมาจาก tax.vat.excess_account (ไม่มีค่าตั้งต้น) · ยอดติดลบ = กลับด้าน (ยื่นเพิ่มเติมที่ยอดลดลง)
 */
export function pp30Journal(output: Money, input: Money, carriedIn: Money, excessAccount: string | null): { lines: Pp30Line[]; net: Money } {
  const net = output.minus(input).minus(carriedIn);
  const raw: Pp30Line[] = [
    ['Dr', '2150100', output.toString()], ['Cr', '1170100', input.toString()], ['Cr', excessAccount, carriedIn.toString()],
    net.isNegative() ? ['Dr', excessAccount, net.neg().toString()] : ['Cr', '2150200', net.toString()],
  ];
  const lines = raw.filter(([, , a]) => !Money.parse(a).isZero())
    .map(([side, acct, a]): Pp30Line => (Money.parse(a).isNegative() ? [side === 'Dr' ? 'Cr' : 'Dr', acct, Money.parse(a).neg().toString()] : [side, acct, a]));
  return { lines, net };
}

async function vatCore(tx: CompanyTx, fromYm: string, toYm: string) {
  const from = monthRange(fromYm).from;
  const to = monthRange(toYm).to;
  const sales = await salesRows(tx, from, to);
  const { rows: purchases, disallowed } = await purchaseRows(tx, fromYm, toYm);
  // ยอดขายที่ได้รับยกเว้น: รับชำระใบที่ไม่มี VAT (เช่น ค่าเช่า ม.81(1)(ฑ)) ในเดือน
  const exempt = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
    .innerJoin('acct.document as i', (j) => j.onRef('i.id', '=', 's.document_id').onRef('i.company_id', '=', 's.company_id'))
    .select(sql<string>`coalesce(sum(s.applied + s.wht), 0)`.as('v')).where('p.doc_type', '=', 'RV').where('p.status', '=', 'posted').where('s.voided', '=', false)
    .where('i.vat', '=', '0').where('p.issue_date', '>=', from).where('p.issue_date', '<=', to).executeTakeFirstOrThrow();
  return { from, to, sales, purchases, disallowed, exemptSales: Money.parse(exempt.v) };
}

/** การยื่นแบบล่าสุดของเดือน (ยื่นปกติ + ยื่นเพิ่มเติม) */
async function filingsOf(tx: CompanyTx, form: 'pp30' | 'pnd3' | 'pnd53', month: string) {
  return tx.selectFrom('acct.tax_filing as f').leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'f.journal_id').onRef('j.company_id', '=', 'f.company_id'))
    .select(['f.id', 'f.form', 'f.month', 'f.seq', 'f.status', 'f.filed_at', 'f.filed_by', 'f.reference_no', 'f.amount', 'f.output_vat', 'f.input_vat', 'f.carried_in', 'f.carry_forward', 'j.journal_no'])
    .where('f.form', '=', form).where('f.month', '=', month).where('f.status', '=', 'filed').orderBy('f.seq').execute();
}

async function vatMonth(tx: CompanyTx, ym: string) {
  const core = await vatCore(tx, ym, ym);
  const { sales, purchases, disallowed, exemptSales } = core;
  const outputVat = Money.parse(vsum(sales, 'vat'));
  const inputVat = Money.parse(vsum(purchases, 'vat'));
  const taxable = Money.parse(vsum(sales, 'base'));
  // ข้อ 10 ภาษีที่ชำระเกินยกมา = ยอดยกไปของ ภ.พ.30 เดือนก่อน (การยื่นครั้งล่าสุด)
  const prev = (await filingsOf(tx, 'pp30', addMonths(ym, -1))).at(-1);
  const carried = Money.parse(prev?.carry_forward ?? '0');
  const excessAccount = await setting<string | null>(tx, VAT_EXCESS_ACCOUNT_KEY, null);
  // รอผู้สอบบัญชี (CLAUDE.md): ขยายกำหนดยื่นออนไลน์ — ค่าตั้งต้นชั่วคราว true
  const onlineExtension = (await setting<unknown>(tx, 'tax.filing.online_extension', true)) !== false;
  const filed = await filingsOf(tx, 'pp30', ym);
  const prior = purchases.filter((r) => r.priorMonth);
  const { lines } = pp30Journal(outputVat, inputVat, carried, excessAccount);
  const net = outputVat.minus(inputVat);
  return {
    month: ym, onlineExtension, sales: { rows: sales, base: taxable.toString(), vat: outputVat.toString() }, purchases: { rows: purchases, base: vsum(purchases, 'base'), vat: inputVat.toString() },
    pp30: { salesTotal: taxable.plus(exemptSales).toString(), exemptSales: exemptSales.toString(), taxableSales: taxable.toString(), outputVat: outputVat.toString(),
      purchasesCreditable: vsum(purchases, 'base'), inputVat: inputVat.toString(), netPayable: net.toString(),
      /** ข้อ 10 */ carriedForward: carried.toString(),
      /** ข้อ 11 (ติดลบ = ชำระเกิน) */ netAfterCarry: net.minus(carried).toString(),
      /** ม.82/3: ใบกำกับเดือนก่อนที่ขอใช้สิทธิ์เดือนนี้ (รวมอยู่ในข้อ 7) */
      priorMonthClaims: { count: prior.length, vat: vsum(prior, 'vat'), rows: prior.map((r) => ({ docId: r.docId, docNo: r.docNo, vendorRef: r.vendorRef ?? null, issueMonth: r.date.slice(0, 7), vat: r.vat })) },
      // ยื่นแล้ว: ล้างภาษีขาย/ภาษีซื้อเข้าบัญชีภาษีค้างจ่าย (fixtures pp30.post_on_filed)
      postOnFiled: lines, excessAccount,
      status: filed.length ? 'filed' as const : 'draft' as const, filings: filed },
    /** ภาษีซื้อต้องห้าม (ไม่อยู่ในรายงานภาษีซื้อ) */
    disallowed: { items: disallowed.length, amount: vsum(disallowed, 'vat'), rows: disallowed },
    /** ใบแจ้งหนี้บริการที่ออกในเดือนแต่ยังไม่รับเงิน — จุดภาษียังไม่เกิด (ม.78/1) */
    deferredService: (await deferredVatDocs(tx, core.to, core.from)).filter((d) => Money.parse(d.vatPending).gt(Money.zero())),
  };
}

export async function vatReports(db: Db, companyId: string, ym: string) {
  return db.withCompany(companyId, (tx) => vatMonth(tx, ym));
}

async function pndRows(tx: CompanyTx, from: string, to: string, pnd: '3' | '53') {
  return tx.selectFrom('acct.wht_certificate as w').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'w.contact_id').onRef('c.company_id', '=', 'w.company_id'))
    .innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 'w.payment_id').onRef('p.company_id', '=', 'w.company_id'))
    .select(['w.cert_no', 'w.pay_date', 'w.income_type', 'w.income_section', 'w.base', 'w.rate', 'w.amount', 'w.pending_auditor', 'c.name', 'c.tax_id', 'c.branch_code', 'c.address', 'p.doc_no'])
    .where('w.pnd', '=', pnd).where('w.voided', '=', false).where('w.pay_date', '>=', from).where('w.pay_date', '<=', to).orderBy('w.pay_date').orderBy('w.cert_no').execute();
}

/** ภ.ง.ด.3 / ภ.ง.ด.53 ของเดือนที่จ่าย (จาก 50 ทวิ ที่ออก) */
export async function pndReport(db: Db, companyId: string, ym: string, pnd: '3' | '53') {
  const { from, to } = monthRange(ym);
  return db.withCompany(companyId, async (tx) => {
    const rows = await pndRows(tx, from, to, pnd);
    const filings = await filingsOf(tx, pnd === '3' ? 'pnd3' : 'pnd53', ym);
    return { month: ym, pnd, rows, certs: rows.length, base: Money.sum(rows.map((r) => Money.parse(r.base))).toString(), tax: Money.sum(rows.map((r) => Money.parse(r.amount))).toString(),
      pendingAuditor: rows.some((r) => r.pending_auditor), status: filings.length ? 'filed' as const : 'draft' as const, filings };
  });
}

// ---------- บันทึกว่ายื่นแล้ว (ScreenTax "บันทึกว่ายื่นแล้ว + ลงบัญชีนำส่ง" · "ยื่นเพิ่มเติม") ----------

export interface FileTaxInput { form: 'pp30' | 'pnd3' | 'pnd53'; month: string; filedAt: string; referenceNo?: string | null; additional?: boolean }
/**
 * ภ.พ.30: ลงบัญชีตาม postOnFiled (ยื่นเพิ่มเติม = ส่วนต่างจากที่ยื่นไปแล้ว) · ภ.ง.ด.3/53: บันทึกการยื่นอย่างเดียว ไม่มี JV (2150300 ล้างตอนจ่ายนำส่ง)
 * TODO(Wei): ยื่นเพิ่มเติม — เบี้ยปรับ/เงินเพิ่ม (ม.89/1) ยังไม่คำนวณ/ลงบัญชี · "ตั้งงานจ่ายในคิว" ยังไม่มีระบบคิวงานจ่ายภาษี
 */
export async function fileTax(db: Db, companyId: string, actor: { userId: string | null; role: CompanyRole }, p: FileTaxInput) {
  if (!YM_RE.test(p.month)) throw new LedgerError('ระบุเดือนภาษีเป็น YYYY-MM');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(p.filedAt)) throw new LedgerError('ระบุวันที่ยื่นเป็น YYYY-MM-DD');
  if (p.filedAt < monthRange(addMonths(p.month, 1)).from) throw new LedgerError('ยื่นแบบได้ตั้งแต่เดือนถัดจากเดือนภาษี');
  return db.withCompany(companyId, async (tx) => {
    const prev = await filingsOf(tx, p.form, p.month);
    if (prev.length && !p.additional) throw new LedgerError('ยื่นแบบเดือนนี้แล้ว — ใช้ "ยื่นเพิ่มเติม"');
    if (!prev.length && p.additional) throw new LedgerError('ยังไม่ได้ยื่นปกติ — ยื่นเพิ่มเติมไม่ได้');
    const seq = prev.length ? prev.at(-1)!.seq + 1 : 0;
    const sumPrev = (k: 'output_vat' | 'input_vat' | 'amount') => Money.sum(prev.map((f) => Money.parse(f[k] ?? '0')));
    let journalId: string | null = null;
    let journalNo: string | null = null;
    let amount: Money;
    let extra = { output_vat: null as string | null, input_vat: null as string | null, carried_in: '0.00', carry_forward: '0.00' };
    if (p.form === 'pp30') {
      const v = await vatMonth(tx, p.month);
      const output = Money.parse(v.pp30.outputVat).minus(sumPrev('output_vat'));
      const input = Money.parse(v.pp30.inputVat).minus(sumPrev('input_vat'));
      const carriedIn = seq === 0 ? Money.parse(v.pp30.carriedForward) : Money.zero();
      const { lines, net } = pp30Journal(output, input, carriedIn, v.pp30.excessAccount);
      if (lines.some(([, a]) => a === null)) throw new LedgerError(`ยังไม่ได้กำหนดบัญชีภาษีชำระเกิน (${VAT_EXCESS_ACCOUNT_KEY}) — รอยืนยัน`);
      // TODO(Wei): ยื่นเพิ่มเติมที่ทำให้ยอดรวมติดลบ (ชำระเกิน) หลังยื่นปกติชำระแล้ว — ยังไม่รองรับการยกไป/ขอคืนส่วนต่าง
      if (net.isNegative() && seq > 0) throw new LedgerError('ยื่นเพิ่มเติมที่ทำให้ภาษีชำระเกิน ยังไม่รองรับ — รอยืนยัน');
      if (lines.length) {
        const r = await postJournalTx(tx, companyId, { date: p.filedAt, role: actor.role, book: 'GJ', lines: lines.map(([side, account, a]): JournalLine => ({ side: side as 'Dr' | 'Cr', account: account!, amount: Money.of(a) })),
          description: `ยื่น ภ.พ.30 เดือน ${p.month.slice(5)}/${Number(p.month.slice(0, 4)) + 543}${seq ? ` (ยื่นเพิ่มเติม ครั้งที่ ${seq})` : ''}` });
        journalId = r.id;
        journalNo = r.journalNo;
      }
      amount = net.isNegative() ? Money.zero() : net;
      extra = { output_vat: output.toString(), input_vat: input.toString(), carried_in: carriedIn.toString(), carry_forward: net.isNegative() ? net.neg().toString() : '0.00' };
    } else {
      const { from, to } = monthRange(p.month);
      const rows = await pndRows(tx, from, to, p.form === 'pnd3' ? '3' : '53');
      amount = Money.sum(rows.map((r) => Money.parse(r.amount))).minus(sumPrev('amount'));
    }
    const row = await tx.insertInto('acct.tax_filing').values({ company_id: companyId, form: p.form, month: p.month, seq, status: 'filed', filed_at: p.filedAt, filed_by: actor.userId,
      reference_no: p.referenceNo ?? null, amount: amount.toString(), journal_id: journalId, ...extra }).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'tax.filed', entity: 'tax_filing', entity_id: row.id,
      before: null, after: JSON.stringify({ form: p.form, month: p.month, seq, amount: amount.toString(), journal: journalNo }), prev_hash: null, hash: null }).execute();
    return { id: row.id, form: p.form, month: p.month, seq, amount: amount.toString(), journalNo, carryForward: extra.carry_forward };
  });
}

/** การยื่นแบบในช่วงเดือน (รวมทุกแบบ) */
export async function taxFilings(db: Db, companyId: string, p: { from: string; to: string }) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.tax_filing as f').leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'f.journal_id').onRef('j.company_id', '=', 'f.company_id'))
    .select(['f.form', 'f.month', 'f.seq', 'f.status', 'f.filed_at', 'f.reference_no', 'f.amount', 'f.carry_forward', 'j.journal_no'])
    .where('f.month', '>=', p.from).where('f.month', '<=', p.to).orderBy('f.month').orderBy('f.form').orderBy('f.seq').execute());
}

/**
 * สถานะการยื่นรายเดือน: pp30 = ยื่นแล้ว/ร่าง (null = ไม่ได้จด VAT) · pnd = ยื่นแล้วเมื่อทุกแบบที่มี 50 ทวิ ในเดือนบันทึกว่ายื่นแล้ว (เดือนที่ไม่มี 50 ทวิ ไม่ต้องยื่น)
 */
export async function filingStatus(tx: CompanyTx, months: string[], vatRegistered: boolean): Promise<Map<string, { pp30: 'filed' | 'draft' | null; pnd: 'filed' | 'draft' | null }>> {
  const out = new Map<string, { pp30: 'filed' | 'draft' | null; pnd: 'filed' | 'draft' | null }>();
  if (!months.length) return out;
  const filed = await tx.selectFrom('acct.tax_filing').select(['form', 'month']).where('status', '=', 'filed').where('month', 'in', months).execute();
  const certs = await tx.selectFrom('acct.wht_certificate').select([sql<string>`to_char(pay_date, 'YYYY-MM')`.as('m'), 'pnd']).where('voided', '=', false)
    .where('pay_date', '>=', `${[...months].sort()[0]}-01`).where('pay_date', '<=', monthRange([...months].sort().at(-1)!).to).groupBy([sql`to_char(pay_date, 'YYYY-MM')`, 'pnd']).execute();
  const has = (form: string, m: string) => filed.some((f) => f.form === form && f.month === m);
  for (const m of months) {
    const need = certs.filter((c) => c.m === m).map((c) => (c.pnd === '3' ? 'pnd3' : 'pnd53'));
    out.set(m, { pp30: vatRegistered ? (has('pp30', m) ? 'filed' : 'draft') : null, pnd: need.length ? (need.every((f) => has(f, m)) ? 'filed' : 'draft') : null });
  }
  return out;
}

/**
 * ไฟล์ข้อความสำหรับโปรแกรม RD Prep (ภ.ง.ด.3/53) — คั่นด้วย | หนึ่งบรรทัดต่อผู้รับเงิน
 * TODO(Wei): ยังไม่มีสำเนา spec ไฟล์นำเข้า RD Prep ในเครื่อง — ลำดับคอลัมน์ด้านล่างต้องตรวจกับ spec จริง + validator ก่อนใช้ยื่น (Gate M6)
 */
export function rdPrepTxt(report: Awaited<ReturnType<typeof pndReport>>): string {
  return report.rows.map((r, i) => [
    String(i + 1), r.tax_id ?? '', r.branch_code ?? '00000', r.name, r.address ?? '', r.pay_date.split('-').reverse().map((x, k) => (k === 2 ? String(Number(x) + 543) : x)).join('/'),
    r.income_section ?? r.income_type, Money.parse(r.rate).times('100').toString().replace(/\.00$/u, ''), r.base, r.amount, '1',
  ].join('|')).join('\r\n') + '\r\n';
}

// ---------- อายุหนี้ (ScreenAging) ----------

export async function aging(db: Db, companyId: string, asOf: string, side: 'AR' | 'AP') {
  const types = side === 'AR' ? ['IV', 'DN'] : ['AP', 'EXP', 'DNR'];
  return db.withCompany(companyId, async (tx) => {
    const docs = await tx.selectFrom('acct.document as d').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_no', 'd.issue_date', 'd.due_date', 'd.grand_total', 'c.id as contact_id', 'c.code', 'c.name',
        // ตัดยอด/ลดหนี้ที่เกิดถึงวันที่ asOf เท่านั้น
        sql<string>`coalesce((select sum(s.applied + s.wht) from acct.settlement s join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
          where s.document_id = d.id and s.company_id = d.company_id and not s.voided and p.issue_date <= ${asOf}), 0)`.as('settled')])
      .where('d.doc_type', 'in', types).where('d.pay_now', '=', false).where('d.issue_date', '<=', asOf) /* EXP จ่ายทันทีไม่มีหนี้ค้าง */
      .where((eb) => eb.or([eb('d.status', '=', 'posted'), eb.and([eb('d.status', '=', 'voided'), eb('d.voided_at', '>', new Date(`${asOf}T23:59:59+07:00`))])]))
      .execute();
    const buckets = ['current', 'b1_30', 'b31_60', 'b61_90', 'b91_120', 'over_120'] as const;
    type B = (typeof buckets)[number];
    const byContact = new Map<string, { contactId: string; code: string; name: string; docs: { docNo: string; due: string | null; days: number; amount: string; bucket: B }[] } & Record<B | 'total', Money>>();
    for (const d of docs) {
      const open = Money.parse(d.grand_total).minus(Money.parse(d.settled));
      if (!open.gt(Money.zero())) continue;
      const due = d.due_date ?? d.issue_date;
      const days = Math.floor((Date.parse(asOf) - Date.parse(due)) / 86_400_000);
      const bucket: B = days <= 0 ? 'current' : days <= 30 ? 'b1_30' : days <= 60 ? 'b31_60' : days <= 90 ? 'b61_90' : days <= 120 ? 'b91_120' : 'over_120';
      const row = byContact.get(d.contact_id) ?? { contactId: d.contact_id, code: d.code, name: d.name, docs: [], ...Object.fromEntries([...buckets, 'total'].map((b) => [b, Money.zero()])) } as never;
      row[bucket] = row[bucket].plus(open);
      row.total = row.total.plus(open);
      row.docs.push({ docNo: d.doc_no ?? '', due: d.due_date, days, amount: open.toString(), bucket });
      byContact.set(d.contact_id, row);
    }
    const rows = [...byContact.values()].sort((a, b) => (b.total.gt(a.total) ? 1 : -1)).map((r) => ({
      contactId: r.contactId, code: r.code, name: r.name, docs: r.docs, ...Object.fromEntries([...buckets, 'total'].map((b) => [b, r[b as B | 'total'].toString()])),
    }));
    const totals = Object.fromEntries([...buckets, 'total'].map((b) => [b, Money.sum([...byContact.values()].map((r) => r[b as B | 'total'])).toString()]));
    // ยอด GL ของบัญชีคุม ณ วันที่ เทียบกับรายใบ
    const control = side === 'AR' ? '1130100' : '2110100';
    const gl = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select([sql<string>`coalesce(sum(l.debit) - sum(l.credit), 0)`.as('b')]).where('l.account_code', '=', control).where('j.status', '<>', 'draft').where('j.journal_date', '<=', asOf).executeTakeFirstOrThrow();
    const glBal = side === 'AR' ? Money.parse(gl.b) : Money.parse(gl.b).neg();
    return { asOf, side, rows, totals, gl: { account: control, balance: glBal.toString(), diff: glBal.minus(Money.parse(totals.total as string)).toString() } };
  });
}

// ---------- งบการเงินจาก GL (ScreenReports) ----------

export async function financialStatements(db: Db, companyId: string, p: { fiscalYear: number; upToPeriod: number }) {
  const tb = await trialBalance(db, companyId, p);
  const accounts = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.account').select(['code', 'name', 'type']).execute());
  const typeOf = new Map(accounts.map((a) => [a.code, a]));
  const lines = tb.map((r) => ({ ...r, name: typeOf.get(r.account)?.name ?? '', type: typeOf.get(r.account)?.type ?? '' }));
  const pick = (types: string[]) => lines.filter((l) => types.includes(l.type));
  const bal = (xs: typeof lines, creditNormal: boolean) => Money.sum(xs.map((x) => (creditNormal ? Money.parse(x.balance).neg() : Money.parse(x.balance))));
  const revenue = bal(pick(['revenue', 'contra_revenue']), true);
  const expense = bal(pick(['expense']), false);
  const assets = bal(pick(['asset', 'contra_asset']), false);
  const liabilities = bal(pick(['liability']), true);
  const equity = bal(pick(['equity']), true);
  const profit = revenue.minus(expense);
  return {
    pl: { revenue: pick(['revenue', 'contra_revenue']), expense: pick(['expense']), totalRevenue: revenue.toString(), totalExpense: expense.toString(), profit: profit.toString() },
    bs: { assets: pick(['asset', 'contra_asset']), liabilities: pick(['liability']), equity: pick(['equity']), totalAssets: assets.toString(), totalLiabilities: liabilities.toString(),
      totalEquity: equity.plus(profit).toString(), balanced: assets.equals(liabilities.plus(equity).plus(profit)) },
  };
}

// ---------- ตรวจความถูกต้อง (ScreenReconReport · R3) ----------

export interface ReconCheckRow { key: string; section: 1 | 2 | 3; label: string; byDocs: string; byGl: string; diff: string; ok: boolean; count?: string; note?: string; crossMonth?: number }

/** ช่วงของรายงานตรวจ: 'YYYY-MM' = เดือน · 'YYYY' = ปีบัญชี (พ.ศ.) สะสมงวด 1–12 ตาม acct.period */
async function reconRange(tx: CompanyTx, period: string) {
  if (YM_RE.test(period)) return { ...monthRange(period), fromYm: period, toYm: period };
  if (!/^\d{4}$/u.test(period)) throw new LedgerError('ระบุงวดเป็น YYYY-MM หรือปีบัญชี (พ.ศ.)');
  const r = await tx.selectFrom('acct.period').select([sql<string | null>`min(starts_on)`.as('from'), sql<string | null>`max(ends_on)`.as('to')])
    .where('fiscal_year', '=', Number(period)).where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirstOrThrow();
  if (!r.from || !r.to) throw new LedgerError(`ไม่พบงวดของปีบัญชี ${period}`);
  return { from: r.from, to: r.to, fromYm: r.from.slice(0, 7), toYm: r.to.slice(0, 7) };
}

/**
 * ScreenReconReport: 3 ด้าน (16 จุดตรวจ · แบบร่างแสดงตัวอย่าง "14") · period = 'YYYY-MM' หรือปีบัญชี 'YYYY' (พ.ศ. "ปีบัญชี 2569 สะสม")
 * 1 เอกสาร ↔ GL: ยอดเอกสารที่ผ่านรายการในงวด ↔ ยอดเคลื่อนไหวของบัญชีที่ตรวจ (journal ของเอกสารประเภทนั้น + JV คีย์มือที่ไม่มีเอกสาร)
 * 2 รายงานภาษี ↔ GL · 3 sub-ledger ↔ บัญชีคุม ณ สิ้นงวด
 * JV ระบบที่ไม่มีเอกสารแต่ไม่ใช่คีย์มือ (ค่าเสื่อม · นำฝาก/ผ่าน/คืนเช็ค · ยื่น ภ.พ.30 · ขายทรัพย์สิน) ไม่นับเป็น "JV ไม่มีเอกสาร"
 */
export async function reconChecks(db: Db, companyId: string, period: string) {
  const { from, to, fromYm, toYm } = await db.withCompany(companyId, (tx) => reconRange(tx, period));
  const ar = await aging(db, companyId, to, 'AR');
  const ap = await aging(db, companyId, to, 'AP');
  const P = (v: string | null | undefined) => Money.parse(v ?? '0');
  const check = (section: 1 | 2 | 3, key: string, label: string, byDocs: Money | string, byGl: Money | string, extra: { count?: string; note?: string; crossMonth?: number } = {}): ReconCheckRow => {
    const d = typeof byDocs === 'string' ? Money.parse(byDocs) : byDocs;
    const g = typeof byGl === 'string' ? Money.parse(byGl) : byGl;
    return { key, section, label, byDocs: d.toString(), byGl: g.toString(), diff: g.minus(d).toString(), ok: g.equals(d), ...extra };
  };
  return db.withCompany(companyId, async (tx) => {
    const vat = await vatCore(tx, fromYm, toYm);
    const pnd3 = await pndRows(tx, from, to, '3');
    const pnd53 = await pndRows(tx, from, to, '53');
    // journal ที่ยังมีผล (ไม่ใช่ร่าง · ไม่ใช่ reversal · ไม่ถูกกลับรายการ) ในงวด
    const live = () => tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .leftJoin('acct.document as d', (jn) => jn.onRef('d.id', '=', 'j.source_document_id').onRef('d.company_id', '=', 'j.company_id'))
      .where('j.status', '<>', 'draft').where('j.reversal_of', 'is', null)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('acct.journal as r').select('r.id').whereRef('r.reversal_of', '=', 'j.id'))));
    const lines = await live().where('j.journal_date', '>=', from).where('j.journal_date', '<=', to)
      .select(['j.id as journal_id', 'j.journal_no', 'j.source_document_id', 'd.doc_type', 'l.account_code', 'l.debit', 'l.credit']).execute();
    // JV ยื่น ภ.พ.30 ล้าง 2150100/1170100 ของเดือนก่อน — ไม่นับในยอดเคลื่อนไหวที่เทียบรายงานภาษี
    const filingIds = new Set((await tx.selectFrom('acct.tax_filing').select('journal_id').where('journal_id', 'is not', null).execute()).map((r) => r.journal_id!));
    // JV ระบบ (ไม่ใช่คีย์มือ): ค่าเสื่อม · เช็ค · ยื่น ภ.พ.30 · ขายทรัพย์สิน · เบิกชดเชยเงินสดย่อย
    const sysIds = new Set<string>([
      ...(await tx.selectFrom('acct.depreciation_run').select('journal_id').execute()).map((r) => r.journal_id),
      ...(await tx.selectFrom('acct.cheque').select('journal_ids').execute()).flatMap((r) => r.journal_ids),
      ...filingIds,
      ...(await tx.selectFrom('acct.fixed_asset').select('disposal_journal_id').where('disposal_journal_id', 'is not', null).execute()).map((r) => r.disposal_journal_id!),
      // เบิกชดเชยเงินสดย่อย (1 JV ต่อชุด อ้างใบ PC หลายใบ ไม่มี source_document_id)
      ...(await tx.selectFrom('acct.document').select('journal_id').where('doc_type', '=', 'PC').where('journal_id', 'is not', null).execute()).map((r) => r.journal_id!),
    ]);
    const manual = lines.filter((l) => !l.source_document_id && !sysIds.has(l.journal_id));
    const sum = (rows: typeof lines, acct: (a: string) => boolean, side: 'Dr' | 'Cr') =>
      Money.sum(rows.filter((l) => acct(l.account_code)).map((l) => (side === 'Dr' ? P(l.debit).minus(P(l.credit)) : P(l.credit).minus(P(l.debit)))));
    const ofTypes = (types: string[]) => lines.filter((l) => l.doc_type && types.includes(l.doc_type));
    const docs = await tx.selectFrom('acct.document').select(['id', 'doc_type', 'subtotal', 'grand_total', 'vat', 'journal_id', 'issue_date', 'status'])
      .where('status', '=', 'posted').where('issue_date', '>=', from).where('issue_date', '<=', to).execute();
    const dsum = (types: string[], f: (d: (typeof docs)[number]) => Money) => Money.sum(docs.filter((d) => types.includes(d.doc_type)).map(f));
    const n = (types: string[]) => String(docs.filter((d) => types.includes(d.doc_type)).length);
    const rev = (a: string) => a.startsWith('41');
    const cost = (a: string) => a.startsWith('5') || /^15[1-4]/u.test(a);
    const cash = (a: string) => a.startsWith('1100') || a.startsWith('1150');
    const manualNos = (acct: (a: string) => boolean) => [...new Set(manual.filter((l) => acct(l.account_code)).map((l) => l.journal_no))];
    const noteOf = (nos: string[], ok: boolean) => (ok || !nos.length ? {} : { note: `${nos.join(', ')} คีย์มือ ไม่มีเอกสารอ้างอิง` });

    const sec1: ReconCheckRow[] = [];
    {
      const d = dsum(['IV'], (x) => P(x.subtotal));
      const g = sum(ofTypes(['IV']), rev, 'Cr').plus(sum(manual, rev, 'Cr'));
      const c = check(1, 'doc_iv', 'ใบกำกับภาษี IV (ขาย)', d, g, { count: n(['IV']) });
      sec1.push({ ...c, ...noteOf(manualNos(rev), c.ok) });
    }
    sec1.push(check(1, 'doc_cn_dn', 'ใบลดหนี้ CN / เพิ่มหนี้ DN', dsum(['DN'], (x) => P(x.subtotal)).minus(dsum(['CN'], (x) => P(x.subtotal))),
      sum(ofTypes(['CN', 'DN']), (a) => rev(a) || a === '4150100', 'Cr'), { count: n(['CN', 'DN']) }));
    {
      const c = check(1, 'doc_ap_exp', 'บิลซื้อ AP + ค่าใช้จ่าย EXP', dsum(['AP', 'EXP'], (x) => P(x.subtotal)),
        sum(ofTypes(['AP', 'EXP']), cost, 'Dr').plus(sum(manual, (a) => a.startsWith('53') || /^15[1-4]/u.test(a), 'Dr')), { count: n(['AP', 'EXP']) });
      sec1.push({ ...c, ...noteOf(manualNos((a) => a.startsWith('53') || /^15[1-4]/u.test(a)), c.ok) });
    }
    sec1.push(check(1, 'doc_rv', 'รับชำระ RV', dsum(['RV'], (x) => P(x.grand_total)), sum(ofTypes(['RV']), cash, 'Dr'), { count: n(['RV']) }));
    sec1.push(check(1, 'doc_pv', 'จ่ายชำระ PV', dsum(['PV'], (x) => P(x.grand_total).neg()), sum(ofTypes(['PV']), cash, 'Dr'), { count: n(['PV']) }));
    {
      const noJv = docs.filter((d) => !d.journal_id && !['QO', 'SO', 'PR', 'PO', 'BN', 'BNR', 'PC'].includes(d.doc_type));
      const manualJvs = [...new Set(manual.map((l) => l.journal_no))];
      const amt = Money.sum(manual.map((l) => P(l.debit)));
      sec1.push({ key: 'doc_orphans', section: 1, label: 'เอกสารผ่านรายการแต่ไม่มี JV / JV ไม่มีเอกสาร', byDocs: '0.00', byGl: '0.00', diff: '0.00', ok: !noJv.length && !manualJvs.length,
        count: `${noJv.length} / ${manualJvs.length}`, ...(manualJvs.length ? { note: `${manualJvs.join(', ')} (คีย์มือ ${amt.toString()})` } : {}) });
    }

    // ---------- 2 รายงานภาษี ↔ GL ----------
    const taxLines = lines.filter((l) => !filingIds.has(l.journal_id));
    const move = (a: string, side: 'Dr' | 'Cr') => sum(taxLines, (x) => x === a, side);
    const balance = async (accounts: string[]) => {
      const r = await live().where('j.journal_date', '<=', to).where('l.account_code', 'in', accounts).select(sql<string>`coalesce(sum(l.debit - l.credit), 0)`.as('b')).executeTakeFirstOrThrow();
      return Money.parse(r.b);
    };
    // ภาษีขายยังไม่ถึงกำหนด ตามเอกสาร = ส่วน VAT ของยอดค้างรับของใบที่ลง 2150400 (ตัดชำระถึงสิ้นงวด)
    const deferred = Money.sum((await deferredVatDocs(tx, to)).map((x) => P(x.vatPending)));
    const whtIn = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (jn) => jn.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
      .select(sql<string>`coalesce(sum(s.wht), 0)`.as('w')).where('p.doc_type', '=', 'RV').where('p.status', '=', 'posted').where('s.voided', '=', false).where('p.issue_date', '<=', to).executeTakeFirstOrThrow();
    // ภาษีซื้อข้ามเดือน (ม.82/3): GL ลง 1170100 ตามวันที่บิล — ปรับ GL ของงวดเป็นเดือนที่ใช้สิทธิ์ (+ ใบเดือนก่อนที่ใช้สิทธิ์ในงวด · − ใบในงวดที่เลื่อนไปงวดหลัง)
    const shifted = await tx.selectFrom('acct.document as d').select(['d.id', 'd.issue_date', 'd.doc_type', 'd.vat', CLAIM.as('claim_month')])
      .where('d.status', '=', 'posted').where('d.doc_type', 'in', ['AP', 'EXP', 'DNR', 'CNR']).where('d.vat', '>', '0').where('d.vat_claim_month', 'is not', null)
      .where((eb) => eb.or([eb.and([eb('d.issue_date', '<', from), eb(CLAIM, '>=', fromYm), eb(CLAIM, '<=', toYm)]), eb.and([eb('d.issue_date', '>=', from), eb('d.issue_date', '<=', to), eb(CLAIM, '>', toYm)])]))
      .execute();
    const vatOf = (d: (typeof shifted)[number]) => (d.doc_type === 'CNR' ? P(d.vat).neg() : P(d.vat));
    const claimedIn = shifted.filter((d) => d.issue_date < from);
    const deferredOut = shifted.filter((d) => d.issue_date >= from);
    const inputGl = move('1170100', 'Dr').plus(Money.sum(claimedIn.map(vatOf))).minus(Money.sum(deferredOut.map(vatOf)));
    const sec2 = [
      check(2, 'vat_output', 'ภาษีขาย: รายงานภาษีขาย ↔ GL 2150100 (เครดิตสุทธิในเดือน)', vsum(vat.sales, 'vat'), move('2150100', 'Cr')),
      check(2, 'vat_input', 'ภาษีซื้อ: รายงานภาษีซื้อ ↔ GL 1170100 (เดบิตสุทธิในเดือน · ปรับตามเดือนที่ใช้สิทธิ์)', vsum(vat.purchases, 'vat'), inputGl, { crossMonth: claimedIn.length }),
      check(2, 'vat_deferred', 'ภาษีขายยังไม่ถึงกำหนด: ใบที่ยังไม่รับเงิน ↔ GL 2150400 (ยอดคงเหลือ)', deferred, (await balance(['2150400'])).neg()),
      check(2, 'wht_payable', 'ภาษีหัก ณ ที่จ่าย: ภ.ง.ด.3 + 53 ↔ GL 2150300 (เครดิตในเดือน)', Money.sum([...pnd3, ...pnd53].map((r) => P(r.amount))), Money.sum(lines.filter((x) => x.account_code === '2150300').map((x) => P(x.credit)))),
      check(2, 'wht_received', 'ภาษีถูกหัก ณ ที่จ่าย: 50 ทวิ ที่ได้รับ ↔ GL 1160100 (ยอดคงเหลือ)', P(whtIn.w), await balance(['1160100'])),
    ];

    // ---------- 3 sub-ledger ↔ บัญชีคุม ----------
    const docCount = (a: typeof ar) => `${a.rows.length} / ${a.rows.reduce((s, r) => s + r.docs.length, 0)}`;
    const deps = await tx.selectFrom('acct.document as d').select(['d.id', 'd.contact_id', 'd.subtotal',
      sql<string>`coalesce((select sum(s.applied) from acct.settlement s join acct.document i on i.id = s.document_id and i.company_id = s.company_id
        where s.payment_id = d.id and s.company_id = d.company_id and not s.voided and i.status = 'posted' and i.issue_date <= ${to}), 0)`.as('used')])
      .where('d.doc_type', '=', 'DP').where('d.status', '=', 'posted').where('d.issue_date', '<=', to).execute();
    const depOpen = deps.map((x) => ({ ...x, open: P(x.subtotal).minus(P(x.used)) })).filter((x) => x.open.gt(Money.zero()));
    const paidDeposit = await live().where('j.journal_date', '<=', to).where('l.account_code', '=', '1140100').where('l.contact_id', 'is not', null)
      .select(['l.contact_id', sql<string>`sum(l.debit - l.credit)`.as('b')]).groupBy('l.contact_id').execute();
    const paidOpen = paidDeposit.filter((x) => P(x.b).gt(Money.zero()));
    const cheques = await tx.selectFrom('acct.cheque').select(['amount']).where('direction', '=', 'received').where('status', 'in', ['on_hand', 'deposited']).execute();
    const sec3 = [
      check(3, 'ar_control', 'ลูกหนี้รายใบ ↔ GL 1130100', ar.totals.total as string, ar.gl.balance, { count: docCount(ar) }),
      check(3, 'ap_control', 'เจ้าหนี้รายใบ ↔ GL 2110100', ap.totals.total as string, ap.gl.balance, { count: docCount(ap) }),
      check(3, 'deposit_received', 'เงินมัดจำรับรายใบ ↔ GL 2140100', Money.sum(depOpen.map((x) => x.open)), (await balance(['2140100'])).neg(),
        { count: `${new Set(depOpen.map((x) => x.contact_id)).size} / ${depOpen.length}` }),
      // TODO(backend): ยังไม่มีเอกสารมัดจำจ่าย — sub-ledger = ยอดรายผู้ขายที่ผูกคู่ค้าใน GL
      check(3, 'deposit_paid', 'เงินมัดจำจ่ายรายผู้ขาย ↔ GL 1140100', Money.sum(paidOpen.map((x) => P(x.b))), await balance(['1140100']),
        { count: `${paidOpen.length} / ${paidOpen.length}` }),
      check(3, 'cheques', 'ทะเบียนเช็ครับในมือ + นำฝาก ↔ GL 1150100 + 1150200', Money.sum(cheques.map((c) => P(c.amount))), await balance(['1150100', '1150200']),
        { count: `${cheques.length} ฉบับ` }),
    ];
    const checks = [...sec1, ...sec2, ...sec3];
    return { month: period, from, to, checks, passed: checks.filter((c) => c.ok).length, toReview: checks.filter((c) => !c.ok).length };
  });
}
