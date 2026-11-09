// ปิดปี (งวด 13) และสำรองตามกฎหมาย (golden 7 · ADR-002)
import type { JournalLine } from './journal.ts';
import { assertBalanced } from './journal.ts';
import { Money, type MoneyString } from './money.ts';

export interface AccountBalance {
  readonly account: string;
  readonly type: 'revenue' | 'contra_revenue' | 'expense' | string;
  /** ยอดคงเหลือแบบ Dr − Cr (เดบิตเป็นบวก) */
  readonly balance: MoneyString;
}

export const INCOME_SUMMARY = '3900100';
export const RETAINED_EARNINGS = '3200100';
export const LEGAL_RESERVE = '3300100';

/** ปิดบัญชีรายได้/ค่าใช้จ่ายเข้า 3900100 แล้วโอนเข้ากำไรสะสม 3200100 เต็มจำนวน — ไม่มีสำรองตามกฎหมายในรายการนี้ */
export function yearEndClose(balances: readonly AccountBalance[]): { closePl: JournalLine[]; transfer: JournalLine[]; netProfit: MoneyString } {
  const pl = balances.filter((b) => ['revenue', 'contra_revenue', 'expense'].includes(b.type) && !Money.of(b.balance).isZero());
  const closePl: JournalLine[] = pl.map((b) => {
    const v = Money.of(b.balance);
    // ยอดเดบิต (ค่าใช้จ่าย) → เครดิตปิด · ยอดเครดิต (รายได้) → เดบิตปิด
    return v.isNegative() ? { side: 'Dr', account: b.account, amount: v.abs() } : { side: 'Cr', account: b.account, amount: v };
  });
  const dr = Money.sum(closePl.filter((l) => l.side === 'Dr').map((l) => l.amount));
  const cr = Money.sum(closePl.filter((l) => l.side === 'Cr').map((l) => l.amount));
  const net = dr.minus(cr); // บวก = กำไร
  if (net.isZero()) return { closePl, transfer: [], netProfit: '0.00' };
  closePl.push(net.isNegative() ? { side: 'Dr', account: INCOME_SUMMARY, amount: net.abs() } : { side: 'Cr', account: INCOME_SUMMARY, amount: net });
  assertBalanced(closePl);
  const transfer: JournalLine[] = net.isNegative()
    ? [{ side: 'Dr', account: RETAINED_EARNINGS, amount: net.abs() }, { side: 'Cr', account: INCOME_SUMMARY, amount: net.abs() }]
    : [{ side: 'Dr', account: INCOME_SUMMARY, amount: net }, { side: 'Cr', account: RETAINED_EARNINGS, amount: net }];
  return { closePl, transfer, netProfit: net.toString() };
}

/**
 * สำรองตามกฎหมาย (ป.พ.พ. ม.1202): บันทึกเมื่อมีมติจ่ายปันผล · อย่างน้อย 5% ของกำไร จนกว่าสำรองครบ 10% ของทุน
 * rate ต้อง ≥ 0.05 · คืน 0 เมื่อสำรองครบแล้ว
 */
export function legalReserveAllocation(p: { netProfit: MoneyString; registeredCapital: MoneyString; existingReserve: MoneyString; rate?: string }): {
  amount: MoneyString; lines: JournalLine[]; capReached: boolean;
} {
  const rate = p.rate ?? '0.05';
  if (Number(rate) < 0.05) throw new Error('อัตราจัดสรรสำรองตามกฎหมายต้องไม่น้อยกว่า 5% (ม.1202)');
  const profit = Money.of(p.netProfit);
  if (!profit.gt(Money.zero())) return { amount: '0.00', lines: [], capReached: false };
  const cap = Money.of(p.registeredCapital).times('0.10').round().minus(Money.of(p.existingReserve));
  if (!cap.gt(Money.zero())) return { amount: '0.00', lines: [], capReached: true };
  const want = profit.times(rate).round();
  const amount = want.gt(cap) ? cap : want;
  return {
    amount: amount.toString(),
    capReached: !want.lt(cap),
    lines: [{ side: 'Dr', account: RETAINED_EARNINGS, amount }, { side: 'Cr', account: LEGAL_RESERVE, amount }],
  };
}
