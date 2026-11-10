// ข้อมูลหน้าภาษี (ScreenTax · ScreenReconReport) และแบบพิมพ์รายเดือน D12–D15 — ตัวเลขทุกตัวมาจาก accounting-api (packages/db/src/reports.ts)
// ห้าม float: บวก/ลบด้วย BigInt สตางค์ (print/_lib/data.ts)
import 'server-only';
import { notFound } from 'next/navigation';
import { api } from '../../lib/api';
import { YM } from './fmt';

export * from './fmt';

export interface VatRow { date: string; docId: string; docNo: string; docType: string; partner: string; taxId: string | null; branch: string | null; base: string; vat: string; vendorRef?: string | null; claimMonth?: string; priorMonth?: boolean;
  /** P2A: '0' = ขายส่งออกอัตรา 0% · สาขาของเอกสาร */
  rate?: string; docBranch?: string | null }
/** การยื่นแบบ (acct.tax_filing) · seq 0 = ยื่นปกติ · 1.. = ยื่นเพิ่มเติม ครั้งที่ */
export interface Filing { seq: number; filed_at: string | null; reference_no: string | null; amount: string; journal_no: string | null }
export interface Pp30 {
  salesTotal: string; exemptSales: string; taxableSales: string; outputVat: string; purchasesCreditable: string; inputVat: string; netPayable: string;
  /** ข้อ 10 ภาษีที่ชำระเกินยกมา · ข้อ 11 ภาษีสุทธิ (ติดลบ = ชำระเกิน) */
  carriedForward: string; netAfterCarry: string;
  /** P2A: ยอดขายที่เสียภาษีอัตราร้อยละ 0 (ขายส่งออก) */
  zeroRatedSales?: string;
  priorMonthClaims: { count: number; vat: string; rows: { docId: string; docNo: string; vendorRef: string | null; issueMonth: string; vat: string }[] };
  /** [Dr/Cr, บัญชี (null = ยังไม่ได้กำหนดบัญชีภาษีชำระเกิน), ยอด] */
  postOnFiled: [string, string | null, string][]; excessAccount: string | null;
  status: 'draft' | 'filed'; filings: Filing[];
}
export interface VatReport {
  month: string; onlineExtension: boolean; sales: { rows: VatRow[]; base: string; vat: string }; purchases: { rows: VatRow[]; base: string; vat: string }; pp30: Pp30;
  disallowed: { items: number; amount: string; rows: VatRow[] };
  deferredService: { docId: string; docNo: string; docType: string; date: string; partner: string; vatPending: string }[];
  /** P2A สาขา: สาขาที่กรอง (null = ทุกสาขา) · ยอดแยกสาขา · ยื่นแยก/รวม (รอยืนยัน) */
  branch?: string | null; byBranch?: { branch: string; outputVat: string; inputVat: string; netPayable: string }[]; vatFiling?: 'separate' | 'combined';
}
export interface PndRow {
  cert_no: string; pay_date: string; income_type: string; income_section: string | null; base: string; rate: string; amount: string; pending_auditor: boolean;
  name: string; tax_id: string | null; branch_code: string | null; address: string | null; doc_no: string | null;
}
export interface PndReport { month: string; pnd: '3' | '53'; rows: PndRow[]; certs: number; base: string; tax: string; pendingAuditor: boolean; status: 'draft' | 'filed'; filings: Filing[] }
export interface ReconCheck { key: string; section?: 1 | 2 | 3; label: string; byDocs: string; byGl: string; diff: string; ok: boolean; count?: string; note?: string; crossMonth?: number }
export interface ReconReport { month: string; from: string; to: string; checks: ReconCheck[]; passed: number; toReview: number }
export interface FilingRow extends Filing { form: 'pp30' | 'pnd3' | 'pnd53'; month: string; status: 'draft' | 'filed'; carry_forward: string }
export interface WhtType { key: string; label: string; section?: string; status?: string }

/** branch = รหัสสาขา 5 หลัก (P2A · ว่าง = ทุกสาขาเหมือนเดิม) */
export const vatReport = (ym: string, branch?: string | null): Promise<VatReport> => api<VatReport>(`/v1/tax/vat?month=${ym}${branch ? `&branch=${branch}` : ''}`);
export const pndReport = (ym: string, form: '3' | '53'): Promise<PndReport> => api<PndReport>(`/v1/tax/pnd?month=${ym}&form=${form}`);
/** period = 'YYYY-MM' หรือปีบัญชี พ.ศ. 'YYYY' ("ปีบัญชี 2569 สะสม") */
export const reconReport = (period: string): Promise<ReconReport> => api<ReconReport>(`/v1/reports/recon?${/^\d{4}$/u.test(period) ? 'year' : 'month'}=${period}`);
export const taxFilings = (from: string, to: string): Promise<FilingRow[]> => api<FilingRow[]>(`/v1/tax/filings?from=${from}&to=${to}`);
export const whtTypes = (): Promise<Record<string, WhtType>> => api<Record<string, WhtType>>('/v1/wht-types');

// ---------- เดือนภาษี (ตัวช่วยแสดงผลอยู่ใน fmt.ts) ----------
export const appToday = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
/** ?month= ของหน้าจอ · ไม่ระบุ → เดือนของวันนี้ · รูปแบบผิด → เดือนของวันนี้ */
export const monthParam = (v: string | string[] | undefined): string => (typeof v === 'string' && YM.test(v) ? v : appToday().slice(0, 7));
/** [month] ของแบบพิมพ์ — รูปแบบผิด → 404 */
export function monthOr404(v: string): string {
  if (!YM.test(v)) notFound();
  return v;
}
/** ประเภทเงินได้ในใบแนบ ภ.ง.ด. — ชื่อจาก GET /v1/wht-types + ม.(มาตรา) · * = รอผู้สอบบัญชียืนยัน
 * TODO(Wei) PrintPnd3Attach.dc.html: แบบร่างใช้คำ "ค่ารับทำงานให้ (พัฒนาซอฟต์แวร์) ม.40(2)*" — ระบบใช้ชื่อประเภทจาก tax-th ("ค่าจ้างพัฒนาซอฟต์แวร์ (ฟรีแลนซ์)") */
export function incomeLabel(r: Pick<PndRow, 'income_type' | 'income_section' | 'pending_auditor'>, types: Record<string, WhtType>): string {
  const t = types[r.income_type];
  const name = t?.label ?? r.income_type;
  return `${name}${r.income_section ? ` ม.${r.income_section}` : ''}${r.pending_auditor ? '*' : ''}`;
}
