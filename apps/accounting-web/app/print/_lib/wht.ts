// หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) จาก GET /v1/wht-certificates — ใช้กับ D4 (PrintWht50) และ D7 (PrintPaymentVoucher) · M5
import 'server-only';
import { api } from '../../lib/api';

export interface WhtCert {
  id: string; cert_no: string; pnd: '3' | '53'; income_type: string; income_section: string | null; pay_date: string;
  base: string; rate: string; amount: string; pending_auditor: boolean; voided: boolean;
  code: string; name: string; tax_id: string | null; payment_no: string | null; payment_id: string;
}

const monthRange = (iso: string): { from: string; to: string } => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};
export const certsBetween = (from: string, to: string): Promise<WhtCert[]> => api<WhtCert[]>(`/v1/wht-certificates?from=${from}&to=${to}`);

/** 50 ทวิ ตาม id พร้อม "ลำดับที่ในแบบ" = ลำดับในแบบ ภ.ง.ด. เดียวกันของเดือนที่จ่าย (เรียงตามเลขที่ · ไม่นับฉบับที่ยกเลิก)
 * TODO(backend): ลำดับที่ใน ภ.ง.ด.3/53 ควรมาจากตัวสร้างแบบ ภ.ง.ด. (GET /v1/tax/pnd) — ตอนนี้คำนวณจากรายการ 50 ทวิ ของเดือน */
export async function certById(id: string): Promise<{ cert: WhtCert; seq: number } | null> {
  // หาเดือนจากรายการทั้งหมดก่อน (API ยังไม่มี GET wht-certificates/:id)
  const all = await api<WhtCert[]>('/v1/wht-certificates');
  const cert = all.find((c) => c.id === id || c.cert_no === id);
  if (!cert) return null;
  const { from, to } = monthRange(cert.pay_date);
  const same = all.filter((c) => c.pnd === cert.pnd && !c.voided && c.pay_date >= from && c.pay_date <= to).sort((a, b) => a.cert_no.localeCompare(b.cert_no));
  return { cert, seq: same.findIndex((c) => c.id === cert.id) + 1 };
}
