// รายได้ตามสัญญา (Phase 2A SWT) — pure TS · ตารางรับรู้รายได้ตามช่วงเวลา (pro-rate ตามวัน · ปัดเศษบรรทัดสุดท้าย) · รอบบิล · ตัวชี้วัด MRR/ARR
// นโยบายการรับรู้ (TFRS 15 / NPAEs · การปันส่วนราคา) = ค่าตั้งของบริษัท "รอยืนยัน" (revenue.standard · revenue.ssp_allocation) — ไฟล์นี้คำนวณตามยอดที่ส่งมาเท่านั้น
import { allocate, Money, type MoneyString } from './money.ts';

export type BillingCycle = 'monthly' | 'quarterly' | 'annual';
export const CYCLE_MONTHS: Readonly<Record<BillingCycle, number>> = { monthly: 1, quarterly: 3, annual: 12 };

const DAY = 86_400_000;
const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

/** จำนวนวันรวมหัวท้าย (from..to) */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY) + 1;
}
export function addDays(date: string, n: number): string {
  return fmt(toUtc(date) + n * DAY);
}
/** บวกเดือนแบบปฏิทิน · วันที่เกินสิ้นเดือนปัดเป็นวันสุดท้ายของเดือน (31 ม.ค. + 1 = 28/29 ก.พ.) */
export function addMonthsDate(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const d = Number(date.slice(8, 10));
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return fmt(Date.UTC(yy, mm, Math.min(d, last)));
}

/** รอบบิลที่ k (เริ่ม 0) ของสัญญา: [start + k×รอบ, start + (k+1)×รอบ − 1 วัน] */
export function billingPeriod(contractStart: string, cycle: BillingCycle, k: number): { from: string; to: string } {
  const months = CYCLE_MONTHS[cycle];
  const from = addMonthsDate(contractStart, k * months);
  const to = addDays(addMonthsDate(contractStart, (k + 1) * months), -1);
  return { from, to };
}

/** ยอดตามสัดส่วนวัน (รอบที่ถูกตัดท้ายด้วยวันสิ้นสุดสัญญา) · วันครบรอบ = ยอดเต็ม */
export function prorate(amount: MoneyString, days: number, fullDays: number): MoneyString {
  if (days >= fullDays) return Money.of(amount).toString();
  return Money.of(amount).ratio(Money.parse(String(days)), Money.parse(String(fullDays))).round().toString();
}

export interface ScheduleRow { readonly period: string; readonly days: number; readonly amount: MoneyString }
/**
 * ตารางรับรู้รายได้รายเดือนของยอด amount ตลอดช่วงบริการ from..to (รวมหัวท้าย)
 * แต่ละเดือน = amount × วันที่อยู่ในเดือน ÷ วันทั้งช่วง · ปัด 2 ตำแหน่ง · เศษไปเดือนสุดท้าย (ผลรวม = amount พอดี)
 */
export function revenueSchedule(amount: MoneyString, from: string, to: string): ScheduleRow[] {
  if (to < from) throw new Error('ช่วงบริการไม่ถูกต้อง (วันสิ้นสุดก่อนวันเริ่ม)');
  const months: { period: string; days: number }[] = [];
  let cur = from;
  while (cur <= to) {
    const y = Number(cur.slice(0, 4));
    const m = Number(cur.slice(5, 7));
    const monthEnd = fmt(Date.UTC(y, m, 0));
    const end = monthEnd < to ? monthEnd : to;
    months.push({ period: cur.slice(0, 7), days: daysBetween(cur, end) });
    cur = addDays(end, 1);
  }
  const parts = allocate(Money.of(amount), months.map((x) => Money.parse(String(x.days))));
  return months.map((x, i) => ({ period: x.period, days: x.days, amount: parts[i]!.toString() }));
}

/** ยอดต่อเดือน (MRR) ของยอดต่อรอบบิล · ปัด 2 ตำแหน่ง */
export function monthlyAmount(amountPerCycle: MoneyString, cycle: BillingCycle): MoneyString {
  return Money.of(amountPerCycle).ratio(Money.parse('1'), Money.parse(String(CYCLE_MONTHS[cycle]))).round().toString();
}
