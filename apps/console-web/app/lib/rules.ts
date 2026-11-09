// กติกาที่ Console คำนวณจากข้อมูลจริง (ไม่ใช่ตัวเลขจากแบบร่าง)
// TODO(Wei): เกณฑ์ "ต้องดู" / "ใกล้ลิมิต ≥ 90%" / trial ใกล้หมด 7 วัน มาจากข้อความใน ConsoleTenants.dc.html + ConsoleOverview.dc.html — ยืนยันเกณฑ์และลำดับของป้าย "สัญญาณ"
import type { Tenant } from './data';

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
export const NEAR_LIMIT = 0.9;
const DAY = 86_400_000;

const ratio = (used: number, limit: number | null) => (limit && limit > 0 ? used / limit : 0);
export const seatRatio = (t: Tenant) => ratio(t.seats, t.seat_limit);
export const companyRatio = (t: Tenant) => ratio(t.companies, t.company_limit);
export const nearLimit = (t: Tenant) => seatRatio(t) >= NEAR_LIMIT || companyRatio(t) >= NEAR_LIMIT;
export function trialEndingSoon(t: Tenant, now = new Date()): boolean {
  if (t.status !== 'trialing' || !t.trial_ends_at) return false;
  const left = new Date(t.trial_ends_at).getTime() - now.getTime();
  return left >= 0 && left <= 7 * DAY;
}
/** องค์กรที่ "ต้องดู" (ป้ายเหลืองของเมนู องค์กร (tenants) และหัวหน้า ConsoleTenants) */
export const needsAttention = (t: Tenant, now = new Date()) => t.status === 'past_due' || t.status === 'suspended' || nearLimit(t) || trialEndingSoon(t, now);

const pct = (r: number) => `${Math.round(r * 100)}%`;
/** ป้ายคอลัมน์ "สัญญาณ" (ConsoleTenants.dc.html): อ่านอย่างเดียว · ที่นั่ง N% · ใกล้ลิมิตบริษัท N% · trial · ปกติ */
export function signal(t: Tenant, now = new Date()): { tone: Tone; label: string } {
  if (t.status === 'past_due' || t.status === 'suspended') return { tone: 'error', label: 'อ่านอย่างเดียว' };
  if (seatRatio(t) >= NEAR_LIMIT) return { tone: 'warning', label: `ที่นั่ง ${pct(seatRatio(t))}` };
  if (companyRatio(t) >= NEAR_LIMIT) return { tone: 'warning', label: `ใกล้ลิมิตบริษัท ${pct(companyRatio(t))}` };
  if (trialEndingSoon(t, now)) return { tone: 'warning', label: 'trial' };
  return { tone: 'success', label: 'ปกติ' };
}

const PLAN: Record<string, string> = { starter: 'Starter', business: 'Business', enterprise: 'Enterprise' };
export const planLabel = (code: string | null): string => (code ? (PLAN[code] ?? code) : '—');
