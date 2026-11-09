// ข้อมูลหน้าภาษี (ScreenTax · ScreenReconReport) และแบบพิมพ์รายเดือน D12–D15 — ตัวเลขทุกตัวมาจาก accounting-api (packages/db/src/reports.ts)
// ห้าม float: บวก/ลบด้วย BigInt สตางค์ (print/_lib/data.ts)
import 'server-only';
import { notFound } from 'next/navigation';
import { api } from '../../lib/api';
import { YM } from './fmt';

export * from './fmt';

export interface VatRow { date: string; docId: string; docNo: string; docType: string; partner: string; taxId: string | null; branch: string | null; base: string; vat: string; vendorRef?: string | null }
export interface Pp30 {
  salesTotal: string; exemptSales: string; taxableSales: string; outputVat: string; purchasesCreditable: string; inputVat: string; netPayable: string;
  postOnFiled: [string, string, string][];
}
export interface VatReport { month: string; sales: { rows: VatRow[]; base: string; vat: string }; purchases: { rows: VatRow[]; base: string; vat: string }; pp30: Pp30 }
export interface PndRow {
  cert_no: string; pay_date: string; income_type: string; income_section: string | null; base: string; rate: string; amount: string; pending_auditor: boolean;
  name: string; tax_id: string | null; branch_code: string | null; address: string | null; doc_no: string | null;
}
export interface PndReport { month: string; pnd: '3' | '53'; rows: PndRow[]; certs: number; base: string; tax: string; pendingAuditor: boolean }
export interface ReconCheck { key: string; label: string; byDocs: string; byGl: string; diff: string; ok: boolean }
export interface ReconReport { month: string; checks: ReconCheck[]; passed: number; toReview: number }
export interface WhtType { key: string; label: string; section?: string; status?: string }

export const vatReport = (ym: string): Promise<VatReport> => api<VatReport>(`/v1/tax/vat?month=${ym}`);
export const pndReport = (ym: string, form: '3' | '53'): Promise<PndReport> => api<PndReport>(`/v1/tax/pnd?month=${ym}&form=${form}`);
export const reconReport = (ym: string): Promise<ReconReport> => api<ReconReport>(`/v1/reports/recon?month=${ym}`);
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
