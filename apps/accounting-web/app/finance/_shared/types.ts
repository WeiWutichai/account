// รูปข้อมูลจาก accounting-api /v1 (packages/db/src/sales.ts) ที่หน้าการเงิน/ตั้งค่าเอกสารใช้
import { href } from '@innovera/ui';

export interface DocRow {
  id: string; doc_type: string; doc_no: string | null; status: string; issue_date: string; due_date: string | null;
  grand_total: string; subtotal: string; vat: string; wht: string; tax_mode: string | null; sent_at: string | null; ref_document_id: string | null;
  contact_id: string | null; contact_code: string | null; contact_name: string | null; settled: string; outstanding: string | null;
}
export interface Doc {
  id: string; doc_type: string; doc_no: string | null; status: string; issue_date: string; due_date: string | null; contact_id: string | null;
  subtotal: string; discount: string; vat: string; wht: string; grand_total: string; tax_mode: string | null; ref_document_id: string | null;
  address: string | null; notes: string | null; reference: string | null; journal_id: string | null; void_reason: string | null; void_journal_id: string | null; voided_at: string | null;
  receive_account: string | null; fee: string; fee_account: string | null; wht_cert_no: string | null; wht_rate: string | null; rule_code: string | null;
  sent_at: string | null; external_source: string | null; external_ref: string | null; approved_at: string | null; branch_code: string;
  /** P2A หลายสกุลเงิน (THB/NULL เมื่อปิดโมดูล) */
  currency?: string; fx_rate?: string | null; grand_total_thb?: string | null;
}
export interface DocLine { line_no: number; description: string | null; line_type: string }
export interface Contact { id: string; code: string; name: string; kind: string; bank_account?: string | null }
/** actor_name = ชื่อผู้ทำจาก Innovera ID (null = ระบบ/API) */
export interface DocEvent { at: string; actor: string | null; actor_name: string | null; event: string; detail: Record<string, unknown> | null }
export interface SettlementIn { id: string; doc_no: string; doc_type: string; issue_date: string; applied: string; wht: string; vat_due: string; voided: boolean }
export interface SettlementOut { id: string; doc_no: string; doc_type: string; issue_date: string; due_date: string | null; grand_total: string; vat: string; applied: string; wht: string; wht_base: string | null; vat_due: string; voided: boolean }
export interface BillingItem { id: string; doc_no: string; issue_date: string; due_date: string | null; grand_total: string }
export interface JournalRow { journal_no: string; line_no: number; account_code: string; name: string; debit: string; credit: string }
export interface DocDetail {
  doc: Doc; lines: DocLine[]; contact: Contact | null; events: DocEvent[]; settlementsIn: SettlementIn[]; settlementsOut: SettlementOut[];
  billing: BillingItem[]; journal: JournalRow[]; cheques?: Cheque[]; ref: { id: string; doc_no: string | null; doc_type: string; grand_total: string; issue_date: string } | null; outstanding: string | null; amountText: string;
  /** ชื่อผู้สร้าง/ผู้อนุมัติ (Innovera ID) · API client ที่สร้างเอกสาร */
  created_by_name: string | null; approved_by_name: string | null; created_by_client_name: string | null;
}
export interface Cheque { cheque_no: string; bank: string; branch: string | null; cheque_date: string; amount: string; status: string }
export interface DocSetting { doc_type: string; prefix: string; pattern: string; reset: 'monthly' | 'yearly' | 'never'; settings: Record<string, unknown>; updated_at: string }
export interface Account { code: string; name: string }

/** ชื่อเอกสาร (สรุปบนหน้ายกเลิก/แก้ไข) */
export function docTypeName(d: Pick<Doc, 'doc_type' | 'tax_mode'>): string {
  switch (d.doc_type) {
    case 'IV': return d.tax_mode === 'immediate' ? 'ใบแจ้งหนี้/ใบกำกับภาษี' : 'ใบแจ้งหนี้';
    case 'RV': return 'ใบเสร็จรับเงิน';
    case 'CN': return 'ใบลดหนี้';
    case 'DN': return 'ใบเพิ่มหนี้';
    case 'DP': return 'ใบแจ้งหนี้มัดจำ';
    case 'BN': return 'ใบวางบิล';
    case 'QO': return 'ใบเสนอราคา';
    case 'SO': return 'ใบสั่งขาย';
    case 'AP': return 'บิลซื้อ';
    case 'EXP': return 'ค่าใช้จ่าย';
    case 'CNR': return 'ใบลดหนี้ (ซื้อ)';
    case 'DNR': return 'ใบเพิ่มหนี้ (ซื้อ)';
    case 'PV': return 'ใบสำคัญจ่าย';
    case 'PO': return 'ใบสั่งซื้อ';
    case 'PR': return 'ใบขอซื้อ';
    default: return d.doc_type;
  }
}
/** รายการ (breadcrumb) · หน้าเอกสาร · Sidebar active ตามประเภทเอกสาร */
export function docNav(d: Pick<Doc, 'doc_type' | 'id'>): { list: string; listLabel: string; view: string; active: string } {
  switch (d.doc_type) {
    case 'RV': return { list: href('receipt'), listLabel: 'รับชำระ', view: `${href('receipt')}/${d.id}`, active: 'receipt' };
    case 'BN': return { list: href('bn'), listLabel: 'ใบวางบิล', view: `${href('bn')}/${d.id}`, active: 'bn' };
    case 'CN': case 'DN': return { list: href('creditnote'), listLabel: 'ใบลดหนี้/เพิ่มหนี้', view: `${href('creditnote')}/${d.id}`, active: 'creditnote' };
    case 'DP': return { list: href('deposit'), listLabel: 'มัดจำ', view: `${href('deposit')}/${d.id}`, active: 'deposit' };
    case 'QO': case 'SO': return { list: href('quote'), listLabel: 'ใบเสนอราคา', view: `${href('quote')}/${d.id}`, active: 'quote' };
    case 'AP': return { list: href('purchase'), listLabel: 'บิลซื้อ', view: `${href('purchase')}/${d.id}`, active: 'purchase' };
    case 'EXP': return { list: href('expense'), listLabel: 'ค่าใช้จ่าย', view: `${href('expense')}/${d.id}`, active: 'expense' };
    case 'CNR': case 'DNR': return { list: href('purchasecn'), listLabel: 'ใบลดหนี้/เพิ่มหนี้ (ซื้อ)', view: `${href('purchasecn')}/${d.id}`, active: 'purchasecn' };
    case 'PV': return { list: href('payment'), listLabel: 'จ่ายชำระ', view: `${href('payment')}/${d.id}`, active: 'payment' };
    case 'PO': case 'PR': return { list: href('po'), listLabel: 'ใบสั่งซื้อ', view: `${href('po')}/${d.id}`, active: 'po' };
    default: return { list: href('invoice'), listLabel: 'ใบกำกับภาษี', view: `${href('invoice')}/${d.id}`, active: 'invoice' };
  }
}
/** ลิงก์แบบพิมพ์ (หน้า /print/* ทำโดยงานแบบพิมพ์ D*) — ชื่อ kind ตามไฟล์ Print*.dc.html */
export const PRINT = {
  receiptTax: (id: string) => `/print/receipt-tax/${id}`,     // PrintReceiptTax.dc.html (D2)
  receiptNoVat: (id: string) => `/print/receipt/${id}`, // PrintReceiptNoVat.dc.html (D10)
  receiptVoucher: (id: string) => `/print/receipt-voucher/${id}`, // PrintReceiptVoucher.dc.html (D11)
  billing: (id: string) => `/print/billing/${id}`,            // PrintBilling.dc.html (D6)
};
export const docVoidHref = (id: string) => `/finance/docs/${id}/void`;
export const docEditHref = (id: string) => `/finance/docs/${id}/edit`;
export const PERIOD_STATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };
export const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
const WEEKDAY = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
/** 'YYYY-MM-DD' → 'พฤ' */
export const weekday = (iso: string): string => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? '';
/** timestamp → 'DD/MM HH:MM' (เวลาไทย) */
export function shortStamp(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
