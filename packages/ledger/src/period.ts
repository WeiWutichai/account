// สิทธิ์ลงรายการตามสถานะงวด (golden 9) · ชั้นที่ 2: DB ปฏิเสธงวด hard_closed เอง (M1)
export type PeriodStatus = 'open' | 'soft_closed' | 'hard_closed';
export type CompanyRole = 'owner' | 'accounting_manager' | 'accountant' | 'ar_clerk' | 'ap_clerk' | 'viewer' | 'auditor';

const MANAGERS: readonly CompanyRole[] = ['owner', 'accounting_manager'];
const POSTERS: readonly CompanyRole[] = ['owner', 'accounting_manager', 'accountant', 'ar_clerk', 'ap_clerk'];

export function canPost(status: PeriodStatus, role: CompanyRole): { ok: true } | { ok: false; reason: string } {
  if (!POSTERS.includes(role)) return { ok: false, reason: `บทบาท ${role} ลงรายการไม่ได้` };
  if (status === 'hard_closed') return { ok: false, reason: 'งวดปิดแข็งแล้ว ต้องเปิดงวดคืนพร้อมเหตุผลก่อน' };
  if (status === 'soft_closed' && !MANAGERS.includes(role)) return { ok: false, reason: 'งวดปิดอ่อน ลงได้เฉพาะผู้จัดการบัญชีขึ้นไป' };
  return { ok: true };
}
