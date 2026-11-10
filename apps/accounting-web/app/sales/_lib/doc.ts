// ชนิดข้อมูลจาก accounting-api (packages/db/src/sales.ts) + ป้ายสถานะ/วันที่ที่ใช้ร่วมทุกหน้าขาย
import type { TagKind } from '@innovera/ui';
import { thaiMonth } from '@innovera/ui';
import { toCents } from './num.ts';

export type DocType = 'QO' | 'SO' | 'IV' | 'CN' | 'DN' | 'DP' | 'BN' | 'RV';
export type DocStatus = 'draft' | 'pending_approval' | 'approved' | 'posted' | 'voided';

/** แถวจาก GET /v1/documents */
export interface DocRow {
  id: string; doc_type: DocType; doc_no: string | null; status: DocStatus; issue_date: string; due_date: string | null;
  grand_total: string; subtotal: string; vat: string; wht: string; tax_mode: string | null; created_at: string; ref_document_id: string | null; sent_at: string | null;
  contact_id: string | null; contact_code: string | null; contact_name: string | null; contact_tax_id?: string | null; external_source?: string | null; settled: string; outstanding: string | null;
}
export interface DocLine {
  id: string; line_no: number; line_type: 'item' | 'heading' | 'note'; product_code: string | null; description: string;
  qty: string | null; unit_price: string | null; discount: string; amount: string; vat_rate: string | null; account_code: string | null;
  /** ต้นทุนประมาณรวมของบรรทัด · ต้นทุนต่อหน่วยของสินค้า · รหัสภาษี/เหตุยกเว้น VAT ของสินค้า (GET /v1/documents/:id) */
  est_cost?: string | null; product_est_cost?: string | null; product_vat_code?: 'vat7' | 'exempt' | 'zero' | null; vat_exempt_reason?: string | null; unit?: string | null;
}
export interface Doc {
  id: string; doc_type: DocType; doc_no: string | null; status: DocStatus; issue_date: string; due_date: string | null; contact_id: string | null;
  price_incl_vat: boolean; subtotal: string; discount: string; vat: string; wht: string; grand_total: string; bill_discount: string;
  rule_code: string | null; tax_mode: 'on_payment' | 'immediate' | null; ref_document_id: string | null; address: string | null; notes: string | null; reference: string | null;
  journal_id: string | null; created_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string;
  voided_at: string | null; void_reason: string | null; receive_account: string | null; credit_days: number | null; sent_at: string | null;
  salesperson?: string | null; project_code?: string | null; payment_terms?: string | null; price_level?: number | null; print_count?: number;
  /** P2A หลายสกุลเงิน/สาขา/สต็อก (NULL/ค่าเดิม เมื่อปิดโมดูล) */
  currency?: string; fx_rate?: string | null; branch_code?: string; warehouse_id?: string | null; grand_total_thb?: string | null; vat_thb?: string | null; base_thb?: string | null;
}
/** actor_name = ชื่อผู้ทำจาก Innovera ID (null = ระบบ/API) */
export interface DocEvent { at: string; actor: string | null; actor_name: string | null; event: string; detail: Record<string, unknown> }
export interface Settlement { id: string; doc_no: string | null; doc_type: DocType; issue_date: string; applied: string; wht: string; vat_due: string; voided: boolean; due_date?: string | null; grand_total?: string }
/** GET /v1/contacts (listContacts) · credit_remaining = วงเงิน − ลูกหนี้คงค้าง (null = ไม่กำหนดวงเงิน) */
export interface Contact {
  id: string; code: string; name: string; kind: string; tax_id?: string | null; branch_code?: string | null; credit_days?: number | null; credit_limit?: string | null;
  credit_remaining?: string | null; price_level?: number; contact_person?: string | null; external_source?: string | null;
}
/** GET /v1/documents/:id */
export interface DocDetail {
  doc: Doc; lines: DocLine[]; contact: Contact | null; events: DocEvent[]; settlementsIn: Settlement[]; settlementsOut: Settlement[];
  billing: { id: string; doc_no: string; issue_date: string; due_date: string | null; grand_total: string }[];
  journal: { journal_no: string; line_no: number; account_code: string; name: string; debit: string; credit: string }[];
  ref: { id: string; doc_no: string | null; doc_type: DocType; grand_total: string; issue_date: string } | null;
  outstanding: string | null; amountText: string;
  /** ชื่อผู้สร้าง/ผู้อนุมัติ (Innovera ID) · API client ที่สร้างเอกสาร (document.created_by_client) */
  created_by_name: string | null; approved_by_name: string | null; created_by_client_name: string | null;
}
/** POST /v1/documents/preview */
export interface Totals {
  lines: { gross: string; amount: string }[]; subtotal: string; discount: string; net: string; vatBase: string; exemptBase: string; vat: string; grandTotal: string; amountText: string;
}
export interface Account { code: string; name: string; type: string; balance: string | null; is_control: boolean; active: boolean }
export interface Rule { code: string; docType: string; name: string }

/** วันระหว่าง 2 วันที่ ISO (b − a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** '2026-12-10' → '10 ธ.ค. 2569' */
export const thaiLongDate = (iso: string): string => `${Number(iso.slice(8, 10))} ${thaiMonth(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4)) + 543}`;

/** เวลาไทย (UTC+7) ของ timestamp → { date: 'YYYY-MM-DD', time: 'HH:MM' } */
export function bangkok(ts: string): { date: string; time: string } {
  const d = new Date(Date.parse(ts) + 7 * 3_600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
/** "วันนี้ 09:12" · "เมื่อวาน 10:14" · "27 พ.ย." (Main.dc.html / ScreenInvoice.dc.html) */
export function whenText(ts: string, today: string): string {
  const { date, time } = bangkok(ts);
  const d = daysBetween(date, today);
  if (d === 0) return `วันนี้ ${time}`;
  if (d === 1) return `เมื่อวาน ${time}`;
  return `${Number(date.slice(8, 10))} ${thaiMonth(Number(date.slice(5, 7)))}`;
}

/** เลขที่เอกสาร — ระบบออกเลขที่ตอนอนุมัติ (technical-plan-M4 §3) */
// TODO(Wei): แบบร่าง (ScreenDocList/ScreenInvoice/ScreenCreditNote.dc.html) แสดงเลขที่บนเอกสารร่าง/รออนุมัติ แต่ technical-plan-M4 §3 ออกเลขที่ตอนอนุมัติ → ร่างแสดง "(ร่าง)"
export const docNo = (d: { doc_no: string | null }): string => d.doc_no ?? '(ร่าง)';

export const TYPE_NAME: Record<DocType, string> = {
  QO: 'ใบเสนอราคา', SO: 'ใบสั่งขาย', IV: 'ใบแจ้งหนี้', CN: 'ใบลดหนี้', DN: 'ใบเพิ่มหนี้', DP: 'ใบแจ้งหนี้มัดจำ', BN: 'ใบวางบิล', RV: 'ใบเสร็จรับเงิน',
};
/** หน้าในระบบของเอกสารแต่ละประเภท */
export function docHref(d: { id: string; doc_type: DocType }): string {
  switch (d.doc_type) {
    case 'QO': case 'SO': return `/sales/quotes/${d.id}`;
    case 'CN': case 'DN': return `/sales/credit-notes/${d.id}`;
    case 'DP': return `/sales/deposits/${d.id}`;
    // TODO(M4): หน้า BN/RV เป็นของ app/finance (agent อื่น) — ใช้เส้นทางตาม routes.ts
    case 'BN': return `/finance/billing/${d.id}`;
    case 'RV': return `/finance/receipts/${d.id}`;
    default: return `/sales/invoices/${d.id}`;
  }
}
/** แบบพิมพ์ (app/print · agent อื่น) */
export const PRINT_KIND: Record<DocType, string> = { QO: 'quote', SO: 'quote', IV: 'invoice', CN: 'credit-note', DN: 'debit-note', DP: 'invoice', BN: 'billing', RV: 'receipt' };
export const printHref = (d: { id: string; doc_type: DocType }): string => `/print/${PRINT_KIND[d.doc_type]}/${d.id}`;

/**
 * ป้ายสถานะ (ScreenDocList.dc.html: ร่าง · รออนุมัติ · รับบางส่วน dd/mm · ชำระแล้ว · เกินกำหนด N วัน)
 * TODO(Wei): แบบร่างไม่มีป้ายของ "ลงบัญชีแล้ว ยังไม่ถึงกำหนด" และ "ยกเลิก" → ใช้ "ค้างชำระ" (ชื่อแท็บ) และ "ยกเลิก"
 */
export function statusTag(d: { doc_type: DocType; status: DocStatus; due_date: string | null; grand_total: string; outstanding: string | null }, today: string, lastReceipt?: string | null): { kind: TagKind; text: string } {
  switch (d.status) {
    case 'draft': return { kind: 'info', text: 'ร่าง' };
    case 'pending_approval': return { kind: 'warning', text: 'รออนุมัติ' };
    case 'approved': return { kind: 'success', text: 'อนุมัติแล้ว' };
    case 'voided': return { kind: 'error', text: 'ยกเลิก' };
    default: break;
  }
  if (d.doc_type !== 'IV' && d.doc_type !== 'DN') return { kind: 'success', text: 'ผ่านรายการแล้ว' };
  const out = toCents(d.outstanding);
  if (out <= 0n) return { kind: 'success', text: 'ชำระแล้ว' };
  if (d.due_date && d.due_date < today) return { kind: 'warning', text: `เกินกำหนด ${daysBetween(d.due_date, today)} วัน` };
  if (out < toCents(d.grand_total)) return { kind: 'success', text: `รับบางส่วน${lastReceipt ? ` ${lastReceipt.slice(8, 10)}/${lastReceipt.slice(5, 7)}` : ''}` };
  return { kind: 'neutral', text: 'ค้างชำระ' };
}

/** ยอดค้างที่แสดงในตาราง: รออนุมัติ = ยอดรวม (ScreenDocList IV2611-0052) · ร่าง/ชำระครบ = ว่าง */
export function outstandingShown(d: { status: DocStatus; grand_total: string; outstanding: string | null }): string {
  if (d.status === 'pending_approval') return d.grand_total;
  if (d.status !== 'posted' || !d.outstanding || toCents(d.outstanding) === 0n) return '';
  return d.outstanding;
}

export const EVENT_TEXT: Record<string, string> = {
  created: 'สร้าง', edited: 'แก้ไข', submitted: 'ส่งขออนุมัติ', approved: 'อนุมัติ', posted: 'อนุมัติและลงบัญชี', rejected: 'ปฏิเสธ',
  voided: 'ยกเลิก', reference_edited: 'แก้ข้อมูลอ้างอิง', converted: 'แปลงเอกสาร', sent: 'ส่งลิงก์ให้ลูกค้า',
};

/** สาขาของคู่ค้า (null/00000 = สำนักงานใหญ่) */
export const branchText = (b: string | null | undefined): string => (!b || b === '00000' ? 'สำนักงานใหญ่' : `สาขา ${b}`);
