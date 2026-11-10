// Phase 2A SWT: ตารางรับรู้รายได้ (pro-rate ตามวัน · เศษไปเดือนสุดท้าย) · รอบบิล · MRR
import { describe, expect, it } from 'vitest';
import { addMonthsDate, billingPeriod, daysBetween, Money, monthlyAmount, prorate, revenueSchedule } from '../src/index.ts';

describe('revenueSchedule', () => {
  it('รายปี 120,000 (1 ม.ค. – 31 ธ.ค. 2569): ม.ค. = 120,000 × 31 ÷ 365 · ธ.ค. รับเศษ · รวม = ยอดเต็ม', () => {
    const s = revenueSchedule('120000.00', '2026-01-01', '2026-12-31');
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ period: '2026-01', days: 31, amount: '10191.78' });
    expect(s[1]).toEqual({ period: '2026-02', days: 28, amount: '9205.48' });
    expect(s[11]).toEqual({ period: '2026-12', days: 31, amount: '10191.80' });
    expect(Money.sum(s.map((x) => Money.of(x.amount))).toString()).toBe('120000.00');
  });
  it('ช่วงข้ามปีและเริ่มกลางเดือน: รวม = ยอดเต็มเสมอ', () => {
    for (const [amt, f, t] of [['36000.00', '2026-02-01', '2027-01-31'], ['999.99', '2026-01-15', '2026-03-10'], ['0.05', '2026-01-01', '2026-03-31'], ['5000.00', '2026-02-01', '2026-02-28']] as const) {
      const s = revenueSchedule(amt, f, t);
      expect(Money.sum(s.map((x) => Money.of(x.amount))).toString()).toBe(amt);
      expect(s.reduce((n, x) => n + x.days, 0)).toBe(daysBetween(f, t));
    }
  });
  it('ช่วงไม่ถูกต้อง = error', () => expect(() => revenueSchedule('1.00', '2026-02-01', '2026-01-31')).toThrow());
});

describe('รอบบิล + MRR', () => {
  it('บวกเดือนแบบปฏิทิน · รอบที่ k', () => {
    expect(addMonthsDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(billingPeriod('2026-01-01', 'annual', 0)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(billingPeriod('2026-02-01', 'monthly', 11)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });
  it('prorate ตามวัน · MRR = ยอดต่อรอบ ÷ เดือนต่อรอบ', () => {
    expect(prorate('5000.00', 31, 31)).toBe('5000.00');
    expect(prorate('5000.00', 15, 30)).toBe('2500.00');
    expect(monthlyAmount('120000.00', 'annual')).toBe('10000.00');
    expect(monthlyAmount('36000.00', 'quarterly')).toBe('12000.00');
  });
});
