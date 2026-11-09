// ข้อมูลของแบบพิมพ์ D* (M4 · docs/technical-plan-M4.md §4) — ทุกตัวเลขมาจาก accounting-api · ห้าม float (คำนวณเป็นสตางค์ด้วย BigInt)
import 'server-only';
import { money } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { api, type Context } from '../../lib/api';

export interface DocRow {
  id: string; doc_type: string; doc_no: string | null; status: string; issue_date: string; due_date: string | null;
  subtotal: string; discount: string; vat: string; wht: string; grand_total: string; fee: string;
  notes: string | null; address: string | null; reference: string | null; tax_mode: string | null;
  wht_cert_no: string | null; wht_rate: string | null; credit_days: number | null; receive_account: string | null; branch_code: string;
  salesperson?: string | null; payment_terms?: string | null; print_count?: number; ref_document_id?: string | null;
}
export interface LineRow {
  line_no: number; line_type: string; product_code: string | null; description: string; qty: string | null; unit_price: string | null; discount: string; amount: string; vat_rate: string | null; unit: string | null;
  product_vat_code?: 'vat7' | 'exempt' | 'zero' | null; vat_exempt_reason?: string | null;
}
export interface ContactRow {
  code: string; name: string; tax_id: string | null; branch_code: string | null;
  address: string | null; contact_person: string | null; phone: string | null; email: string | null; credit_days: number | null; credit_limit: string | null;
  bank_account?: string | null;
}
export interface ChequeRow { cheque_no: string; bank: string; branch: string | null; cheque_date: string; amount: string; status: string }
export interface Settlement { id: string; doc_no: string; doc_type: string; issue_date: string; due_date: string | null; grand_total: string; vat: string; applied: string; wht: string; wht_base: string | null; vat_due: string; voided: boolean }
export interface SettlementIn { id: string; doc_no: string; doc_type: string; issue_date: string; applied: string; wht: string; vat_due: string; voided: boolean }
export interface BillingRow { id: string; doc_no: string; issue_date: string; due_date: string | null; grand_total: string }
export interface JournalRow { journal_no: string; line_no: number; account_code: string; name: string; debit: string; credit: string }
export interface DocDetail {
  doc: DocRow; lines: LineRow[]; contact: ContactRow | null; settlementsIn: SettlementIn[]; settlementsOut: Settlement[]; billing: BillingRow[];
  journal: JournalRow[]; cheques: ChequeRow[]; ref: { id: string; doc_no: string | null; doc_type: string; grand_total: string; issue_date: string } | null; amountText: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** เอกสารตามประเภทที่แบบพิมพ์รับ · ไม่พบ/ประเภทไม่ตรง → 404 */
export async function loadDoc(id: string, types: readonly string[]): Promise<DocDetail> {
  if (!UUID.test(id)) notFound();
  const d = await getDoc(id);
  if (!d || !types.includes(d.doc.doc_type)) notFound();
  return d;
}
export async function getDoc(id: string): Promise<DocDetail | null> {
  try {
    return await api<DocDetail>(`/v1/documents/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof Error && /ไม่พบเอกสาร/u.test(e.message)) return null;
    throw e;
  }
}
/** บริษัทที่ออกเอกสาร — GET /v1/context (id/name/branch + profile: เลขผู้เสียภาษี ที่อยู่ โทร) */
export interface CompanyProfile { nameEn: string | null; taxId: string | null; branchCode: string | null; address: string | null; phone: string | null; email: string | null }
export type Company = Context & { profile?: CompanyProfile | null };
export const context = (): Promise<Company> => api<Company>('/v1/context');

/** จำนวนเงินเป็นตัวอักษร (bahtText ของ accounting-api) ของยอดใดๆ — ใช้กับใบเสร็จที่ตัวอักษร = ยอดชำระหนี้ (รับ + ภาษีถูกหัก) */
export async function bahtTextOf(amount: string): Promise<string> {
  const r = await api<{ amountText: string }>('/v1/receipts/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ applications: [{ invoiceTotal: amount, invoiceVat: '0.00', vatOnPayment: false, settledBefore: '0.00', vatDueBefore: '0.00', applied: amount, wht: '0.00' }], fee: '0.00' }),
  });
  return r.amountText;
}

// ---------- ตัวเลข (สตางค์ BigInt) ----------
const toSatang = (v: string): bigint => {
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  const n = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -n : n;
};
const fromSatang = (n: bigint): string => {
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};
export const add = (...vs: string[]): string => fromSatang(vs.reduce((s, v) => s + toSatang(v), 0n));
export const sub = (a: string, b: string): string => fromSatang(toSatang(a) - toSatang(b));
export const isZero = (v: string | null | undefined): boolean => !v || toSatang(v) === 0n;
export const gt = (a: string, b: string): boolean => toSatang(a) > toSatang(b);
/** อัตรา NUMERIC(7,4) เช่น '0.0300' → ทศนิยมสเกล 10^4 */
const rate4 = (r: string): bigint => {
  const [i = '0', f = ''] = r.split('.');
  return BigInt(i || '0') * 10000n + BigInt((f + '0000').slice(0, 4));
};
/** ยอด × อัตรา ปัดครึ่งขึ้น 2 ตำแหน่ง */
export function timesRate(amount: string, rate: string): string {
  const p = toSatang(amount) * rate4(rate);
  const q = p / 10000n;
  const r = p % 10000n;
  return fromSatang(r * 2n >= 10000n ? q + 1n : q);
}
export const zeroRate = (r: string | null | undefined): boolean => !r || rate4(r) === 0n;
/** '0.0700' → '7' · '0.0150' → '1.5' */
export function pct(rate: string | null | undefined): string {
  if (!rate) return '';
  const v = rate4(rate); // ×10^4 → ร้อยละ = v / 100
  const i = v / 100n;
  const f = (v % 100n).toString().padStart(2, '0').replace(/0+$/u, '');
  return f ? `${i}.${f}` : `${i}`;
}
/** qty NUMERIC(18,4) → แสดง 2 ตำแหน่งตามแบบร่าง (4.0000 → 4.00) */
export function qty(v: string | null): string {
  if (!v) return '';
  const [i = '0', f = ''] = v.split('.');
  const rest = f.slice(2).replace(/0+$/u, '');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${(f + '00').slice(0, 2)}${rest}`;
}
/** ราคาต่อหน่วย NUMERIC(18,4) → 2 ตำแหน่ง (ถ้าตำแหน่งที่ 3–4 ไม่ใช่ศูนย์ให้คงไว้) */
export const unitPrice = qty;

// ---------- วันที่ ----------
const dayNo = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
export const daysBetween = (from: string, to: string): number => dayNo(to) - dayNo(from);
const WEEKDAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const weekday = (iso: string): string => WEEKDAY[new Date(dayNo(iso) * 86_400_000).getUTCDay()] ?? '';

// ---------- ข้อความ ----------
/** สาขาตามรหัส 5 หลัก (00000 = สำนักงานใหญ่) · ไม่มีข้อมูล → ไม่แสดง */
export function branchLabel(code: string | null | undefined): string {
  if (!code) return '';
  return code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;
}
/** ชื่อธนาคารจากชื่อบัญชีเงินฝาก ("เงินฝากธนาคาร ออมทรัพย์ [ธนาคาร A]" → "[ธนาคาร A]") — ใช้เมื่อบัญชีนั้นไม่มีในทะเบียนบัญชีธนาคาร */
export const bankName = (accountName: string): string => accountName.replace(/^เงินฝากธนาคาร\s*(ออมทรัพย์|กระแสรายวัน|ประจำ)?\s*/u, '');

/** ทะเบียนบัญชีธนาคารของบริษัท (GET /v1/bank-accounts) */
export interface BankAccount { gl_account: string; gl_name: string; bank_name: string; branch: string | null; account_no: string; account_name: string | null; is_default_receive: boolean }
export const bankAccounts = (): Promise<BankAccount[]> => api<BankAccount[]>('/v1/bank-accounts').catch(() => []);
/** บัญชีรับโอนของบริษัท: ตามบัญชี GL ที่ระบุ (ถ้ามีในทะเบียน) ไม่งั้นบัญชีรับโอนตั้งต้น */
export function receiveBank(list: BankAccount[], glAccount?: string | null): BankAccount | null {
  return (glAccount ? list.find((b) => b.gl_account === glAccount) : undefined) ?? list.find((b) => b.is_default_receive) ?? null;
}
/** "โอนเข้าบัญชี [ธนาคาร A] เลขที่ xxx-x-xxxxx-x ชื่อบัญชี [ชื่อบริษัท] จำกัด" (PrintInvoice / PrintBilling) · ชื่อบัญชีว่าง = ชื่อบริษัท */
export const transferText = (b: BankAccount, company: string): string => `โอนเข้าบัญชี ${b.bank_name} เลขที่ ${b.account_no} ชื่อบัญชี ${b.account_name ?? company}`;
/** ชื่อบัญชีที่รับเงิน (จาก journal ของเอกสาร) */
export const receiveAccountName = (d: DocDetail): string => d.journal.find((j) => j.account_code === d.doc.receive_account)?.name ?? '';
export const isBankAccount = (name: string): boolean => name.startsWith('เงินฝาก');
export const isCashAccount = (name: string): boolean => name.startsWith('เงินสด');
/** เช็ครับของเอกสาร (ไม่รวมที่ยกเลิก) */
export const liveCheques = (d: DocDetail): ChequeRow[] => (d.cheques ?? []).filter((c) => c.status !== 'cancelled');
/** วิธีรับเงิน: เช็ค / โอน <ธนาคาร> / เงินสด */
export function howReceived(d: DocDetail): string {
  const ch = liveCheques(d)[0];
  if (ch) return `เช็ค ${ch.bank} เลขที่ ${ch.cheque_no}`;
  const acct = receiveAccountName(d);
  return isBankAccount(acct) ? `โอน ${bankName(acct)}` : isCashAccount(acct) ? 'เงินสด' : acct;
}
/** ที่อยู่ลูกค้า: ที่บันทึกในเอกสาร → ทะเบียนผู้ติดต่อ → ช่องกรอกตามแบบร่าง */
export const customerAddress = (d: DocDetail): string => d.doc.address ?? d.contact?.address ?? '[ที่อยู่ลูกค้า]';
/** เครดิต (วัน): ของเอกสาร → ของลูกค้า → ครบกำหนด − วันที่ */
export function creditDays(doc: DocRow, contact: ContactRow | null, fallback?: { issue_date: string; due_date: string | null } | null): number | null {
  const f = fallback ?? doc;
  return doc.credit_days ?? contact?.credit_days ?? (f.due_date ? daysBetween(f.issue_date, f.due_date) : null);
}

/** ใบกำกับภาษีเดิมของ CN/DN: IV แบบ immediate = ตัว IV เอง · IV แบบ on_payment (ม.78/1) = ใบเสร็จรับเงิน/ใบกำกับภาษี (RV) ที่รับชำระใบนั้น */
export async function originalTaxInvoice(d: DocDetail): Promise<{ no: string; date: string; base: string } | null> {
  if (!d.ref) return null;
  const ref = await getDoc(d.ref.id);
  if (!ref) return null;
  const base = sub(ref.doc.subtotal, ref.doc.discount);
  if (ref.doc.tax_mode === 'on_payment') {
    const rv = ref.settlementsIn.filter((s) => !s.voided && s.doc_type === 'RV').sort((a, b) => a.issue_date.localeCompare(b.issue_date)).at(-1);
    // TODO(Wei) PrintDebitNote.dc.html / PrintCreditNote.dc.html: IV ที่ออกใบกำกับเมื่อรับเงินแต่ยังไม่ได้รับชำระ → ยังไม่มีใบกำกับภาษีเดิม (แสดงเลขที่ IV แทน)
    if (rv) return { no: rv.doc_no, date: rv.issue_date, base };
  }
  return { no: ref.doc.doc_no ?? '', date: ref.doc.issue_date, base };
}

/** แถวรายการของเอกสาร — ลำดับนับเฉพาะบรรทัดสินค้า/บริการ
 * หน่วย = acct.product.unit (join ตาม product_code) */
export function itemRows(lines: LineRow[], descOf: (l: LineRow, i: number) => string = (l) => l.description) {
  let n = 0;
  return lines.map((l, i) => {
    const item = l.line_type === 'item';
    return { key: `${l.line_no}`, no: item ? ++n : null, desc: descOf(l, i), qty: item ? qty(l.qty) : '', unit: item ? l.unit ?? '' : '', price: item ? unitPrice(l.unit_price) : '', amount: item ? money(l.amount) : '' };
  });
}
/** มูลค่าที่คำนวณภาษี = (รวม − ส่วนลด) − มูลค่าบรรทัดที่ไม่มี VAT
 * TODO(backend): ฐานภาษี (vatBase) ควรส่งมาจาก engine — ส่วนลดท้ายบิลที่กระจายลงบรรทัดยกเว้น VAT ยังไม่ถูกหักในสูตรนี้ */
export function vatBase(d: DocDetail): string {
  const exempt = d.lines.filter((l) => l.line_type === 'item' && zeroRate(l.vat_rate)).map((l) => l.amount);
  return sub(sub(d.doc.subtotal, d.doc.discount), add('0.00', ...exempt));
}
/** อัตรา VAT ของเอกสาร (บรรทัดแรกที่มี VAT) เช่น '7' */
export const vatPct = (lines: LineRow[]): string => pct(lines.find((l) => !zeroRate(l.vat_rate))?.vat_rate ?? null);

/** ใบแจ้งหนี้/ใบเพิ่มหนี้ที่ใบรับชำระ (RV) ตัด (ไม่รวมที่ยกเลิก) พร้อมรายละเอียดเอกสาร */
export async function settledDocs(d: DocDetail): Promise<{ s: Settlement; inv: DocDetail | null }[]> {
  const live = d.settlementsOut.filter((s) => !s.voided).sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.doc_no.localeCompare(b.doc_no));
  const invs = await Promise.all(live.map((s) => getDoc(s.id)));
  return live.map((s, i) => ({ s, inv: invs[i] ?? null }));
}
/** ยอดค้างของใบแจ้งหนี้ก่อนใบรับชำระนี้ = ยอดรวม − Σ(ตัด + ภาษีถูกหัก) ของใบรับชำระอื่นที่ออกก่อน
 * TODO(backend): ไม่รวมใบลดหนี้/เพิ่มหนี้ — ควรส่ง "ค้างชำระ ณ วันรับ" มากับ settlementsOut */
export function outstandingBefore(rv: DocRow, s: Settlement, inv: DocDetail | null): string {
  const before = (inv?.settlementsIn ?? []).filter((x) => !x.voided && x.id !== rv.id && (x.issue_date < rv.issue_date || (x.issue_date === rv.issue_date && x.doc_no < (rv.doc_no ?? ''))));
  return sub(s.grand_total, add('0.00', ...before.flatMap((x) => [x.applied, x.wht])));
}
