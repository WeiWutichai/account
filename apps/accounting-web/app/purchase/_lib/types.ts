// ชนิดข้อมูลฝั่งซื้อจาก accounting-api (packages/db/src/purchase.ts · getDocument/listDocuments ใน sales.ts) + ป้ายสถานะ/เส้นทาง
import type { TagKind } from '@innovera/ui';
import { thaiMonth } from '@innovera/ui';
import type { Account, DocEvent, Settlement as SalesSettlement, Totals } from '../../sales/_lib/doc.ts';
import { daysBetween } from '../../sales/_lib/doc.ts';
import { toCents } from '../../sales/_lib/num.ts';

export type { Account, DocEvent, Totals };
/** การตัดยอด (settlement) — ฝั่งซื้อมี PV / CNR */
export type Settlement = Omit<SalesSettlement, 'doc_type'> & { doc_type: string };
export type PType = 'PR' | 'PO' | 'AP' | 'CNR' | 'DNR' | 'EXP';
export type PStatus = 'draft' | 'pending_approval' | 'approved' | 'posted' | 'voided';

export interface PDoc {
  id: string; doc_type: PType; doc_no: string | null; status: PStatus; issue_date: string; due_date: string | null; contact_id: string | null;
  price_incl_vat: boolean; subtotal: string; discount: string; vat: string; wht: string; grand_total: string; bill_discount: string;
  rule_code: string | null; ref_document_id: string | null; notes: string | null; reference: string | null; journal_id: string | null;
  vendor_ref: string | null; pay_now: boolean; receive_account: string | null; external_source: string | null; external_ref: string | null;
  created_at: string; updated_at: string; approved_at: string | null; voided_at: string | null; void_reason: string | null;
}
export interface PLine {
  id: string; line_no: number; line_type: 'item' | 'heading' | 'note'; product_code: string | null; description: string;
  qty: string | null; unit_price: string | null; discount: string; amount: string; vat_rate: string | null; account_code: string | null; wht_type: string | null;
}
export interface PContact { id: string; code: string; name: string; kind: string; tax_id?: string | null; branch_code?: string | null; credit_days?: number | null; email?: string | null; contact_person?: string | null }
export interface JournalRow { journal_no: string; line_no: number; account_code: string; name: string; debit: string; credit: string }
/** GET /v1/documents/:id (เอกสารซื้อ) */
export interface PDetail {
  doc: PDoc; lines: PLine[]; contact: PContact | null; events: DocEvent[]; settlementsIn: Settlement[]; settlementsOut: Settlement[];
  journal: JournalRow[]; ref: { id: string; doc_no: string | null; doc_type: string; grand_total: string; issue_date: string } | null; amountText: string;
}
/** แถวจาก GET /v1/documents?type=… */
export interface PRow {
  id: string; doc_type: PType; doc_no: string | null; status: PStatus; issue_date: string; due_date: string | null; grand_total: string; subtotal: string; vat: string; wht: string;
  created_at: string; ref_document_id: string | null; contact_id: string | null; contact_code: string | null; contact_name: string | null; settled: string;
}
/** GET /v1/wht-types (WHT_TYPES ใน @innovera/tax-th) */
export interface WhtTypeDef { key: string; rate: string; pnd: string; label: string; section?: string; method?: string; status?: 'CONFIRMED' | 'PENDING_AUDITOR' }
/** ภาษีหัก ณ ที่จ่ายต่อประเภทเงินได้ (whtForBill / approvePurchase) */
export interface WhtCalc { type: string; label: string; section: string | null; base: string; rate: string; amount: string; pendingAuditor: boolean }
export interface Cert extends WhtCalc { certNo: string; pnd: '3' | '53' }
/** GET /v1/payables */
export interface Payable {
  id: string; doc_no: string | null; doc_type: PType; issue_date: string; due_date: string | null; grand_total: string; vendor_ref: string | null;
  contact_id: string; contact_code: string; contact_name: string; outstanding: string; wht: WhtCalc[];
}

export const TYPE_NAME: Record<PType, string> = { PR: 'ใบขอซื้อ', PO: 'ใบสั่งซื้อ', AP: 'บิลซื้อ', CNR: 'ใบลดหนี้ที่ได้รับจากผู้ขาย', DNR: 'ใบเพิ่มหนี้ที่ได้รับจากผู้ขาย', EXP: 'ค่าใช้จ่าย' };

/** หน้าในระบบของเอกสารซื้อ (packages/ui/src/routes.ts: po · purchase · purchasecn · expense) */
export function pHref(d: { id: string; doc_type: string }): string {
  switch (d.doc_type) {
    case 'PR': case 'PO': return `/purchase/orders/${d.id}`;
    case 'CNR': case 'DNR': return `/purchase/credit-notes/${d.id}`;
    case 'EXP': return `/purchase/expenses/${d.id}`;
    // TODO(M5): หน้า PV เป็นของ app/finance/payments (agent อื่น) — ใช้เส้นทางตาม routes.ts
    case 'PV': return `/finance/payments/${d.id}`;
    default: return `/purchase/bills/${d.id}`;
  }
}
export const listHref: Record<PType, string> = { PR: '/purchase/orders', PO: '/purchase/orders', AP: '/purchase/bills', CNR: '/purchase/credit-notes', DNR: '/purchase/credit-notes', EXP: '/purchase/expenses' };

/** เลขที่เอกสาร — ระบบออกเลขที่ตอนอนุมัติ (เหมือน docNo ใน sales/_lib/doc.ts) */
export const pDocNo = (d: { doc_no: string | null }): string => d.doc_no ?? '(ร่าง)';

/** ภ.ง.ด.3 (บุคคลธรรมดา) / 53 (นิติบุคคล) ตามเลขผู้เสียภาษี — ตรงกับ pndOf ใน @innovera/tax-th */
export const pndOf = (taxId: string | null | undefined): '3' | '53' => (taxId && taxId.startsWith('0') ? '53' : '3');
export const personText = (taxId: string | null | undefined): string => (pndOf(taxId) === '53' ? 'นิติบุคคล' : 'บุคคลธรรมดา');

/** "0.03" → "3" · "0.015" → "1.5" */
export function pct(rate: string): string {
  const [i = '0', f = ''] = rate.split('.');
  const s = `${i}${f.padEnd(2, '0').slice(0, 2)}.${f.slice(2)}`.replace(/^0+(?=\d)/u, '').replace(/\.?0*$/u, '');
  return s || '0';
}
/** ข้อความประเภทเงินได้ในตัวเลือก: "3% ม.40(2) ค่าจ้างพัฒนาซอฟต์แวร์ (ฟรีแลนซ์)" */
export const whtOptionText = (t: WhtTypeDef): string => `${pct(t.rate)}% ${t.section ? `ม.${t.section} ` : ''}${t.label}`;
export const isPending = (t: WhtTypeDef | undefined): boolean => t?.status === 'PENDING_AUDITOR';

/** ยอดค้างจ่ายของบิล: ยอดรวม − (จ่ายแล้ว + ภาษีหัก) − ใบลดหนี้ซื้อ — ตรงกับ outstandingTx (ไม่นับใบสำคัญจ่ายที่ยังรออนุมัติ) */
export function outstandingOf(detail: { doc: PDoc; settlementsIn: Settlement[] }): string | null {
  const d = detail.doc;
  if (d.status !== 'posted' || !['AP', 'EXP', 'DNR'].includes(d.doc_type)) return null;
  if (d.doc_type === 'EXP' && d.pay_now) return '0.00';
  const used = detail.settlementsIn.filter((s) => !s.voided).reduce((s, x) => s + toCents(x.applied) + toCents(x.wht), 0n);
  const c = toCents(d.grand_total) - used;
  const a = (c < 0n ? -c : c).toString().padStart(3, '0');
  return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`;
}

/** "11/2569" ของวันที่ ISO */
export const monthBE = (iso: string): string => `${iso.slice(5, 7)}/${Number(iso.slice(0, 4)) + 543}`;
export const monthNameBE = (iso: string): string => `${thaiMonth(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4)) + 543}`;

/**
 * ป้ายสถานะบิลซื้อ (ScreenPurchaseList.dc.html: รอตรวจ · ลงบัญชีแล้ว · ตั้งหนี้แล้ว · เกินกำหนด N วัน · PO ค้างรับ x/y · เลขใบกำกับซ้ำ)
 * TODO(Wei): แบบร่างใช้ทั้ง "ลงบัญชีแล้ว" (AP2611-0043) และ "ตั้งหนี้แล้ว" (AP2611-0041) กับบิลที่ลงบัญชีแล้วยังไม่จ่าย โดยไม่บอกความต่าง → ใช้ "ตั้งหนี้แล้ว"
 * TODO(Wei): แบบร่างไม่มีป้าย "ร่าง"/"จ่ายแล้ว"/"ยกเลิก" ในรายการบิล → ร่าง (ScreenExpense) · จ่ายแล้ว (ชื่อแท็บ) · ยกเลิก (ScreenDocList)
 */
export function pStatusTag(d: { doc_type: PType; status: PStatus; due_date: string | null; pay_now?: boolean }, today: string, outstanding: string | null, dupRef = false): { kind: TagKind; text: string } {
  if (dupRef && d.status !== 'posted' && d.status !== 'voided') return { kind: 'error', text: 'เลขใบกำกับซ้ำ' };
  switch (d.status) {
    case 'draft': return { kind: 'info', text: 'ร่าง' };
    case 'pending_approval': return d.doc_type === 'AP' ? { kind: 'warning', text: 'รอตรวจ' } : { kind: 'warning', text: 'รออนุมัติ' };
    case 'approved': return { kind: 'success', text: 'อนุมัติแล้ว' };
    case 'voided': return { kind: 'error', text: 'ยกเลิก' };
    default: break;
  }
  if (d.doc_type === 'CNR' || d.doc_type === 'DNR') return { kind: 'success', text: 'ผ่านรายการแล้ว' };
  const out = toCents(outstanding);
  if (out <= 0n) return { kind: 'success', text: 'จ่ายแล้ว' };
  if (d.due_date && d.due_date < today) return { kind: 'error', text: `เกินกำหนด ${daysBetween(d.due_date, today)} วัน` };
  return { kind: 'success', text: 'ตั้งหนี้แล้ว' };
}

export const EVENT_TEXT: Record<string, string> = {
  created: 'สร้าง', edited: 'แก้ไข', submitted: 'ส่งขออนุมัติ', approved: 'อนุมัติ', posted: 'อนุมัติและลงบัญชี', rejected: 'ปฏิเสธ',
  voided: 'ยกเลิก', reference_edited: 'แก้ข้อมูลอ้างอิง', converted: 'แปลงเอกสาร',
};

/** 50 ทวิ ที่ออกตอนอนุมัติ (event "posted" · approvePurchase) */
export function certsOf(detail: PDetail): Cert[] {
  const e = [...detail.events].reverse().find((x) => x.event === 'posted');
  const c = (e?.detail as { certificates?: Cert[] } | undefined)?.certificates;
  return Array.isArray(c) ? c : [];
}
