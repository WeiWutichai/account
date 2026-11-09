// ค่าเสื่อมราคาเส้นตรงรายเดือน · เดือนแรกคิดตามวัน (รายปี × วัน ÷ 365) · เดือนเต็ม = รายปี ÷ 12 · เดือนสุดท้ายปรับให้สะสม = ทุน − ซาก (golden 6)
import { Money, type MoneyString } from './money.ts';

export interface AssetInput {
  readonly cost: MoneyString;
  readonly salvage: MoneyString;
  readonly lifeYears: number;
  /** วันเริ่มใช้ YYYY-MM-DD (ค.ศ.) */
  readonly startDate: string;
}
export interface DepreciationLine {
  readonly month: string; // YYYY-MM
  readonly amount: MoneyString;
  readonly accumulated: MoneyString;
  readonly nbv: MoneyString;
}

export function annualDepreciation(a: AssetInput): Money {
  return Money.of(a.cost).minus(Money.of(a.salvage)).ratio(Money.of('1.00'), Money.of(`${a.lifeYears}.00`)).round();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function schedule(a: AssetInput): DepreciationLine[] {
  const cost = Money.of(a.cost);
  const depreciable = cost.minus(Money.of(a.salvage));
  const annualRaw = depreciable.ratio(Money.of('1.00'), Money.of(`${a.lifeYears}.00`)); // ไม่ปัด
  const [y0, m0, d0] = a.startDate.split('-').map(Number) as [number, number, number];
  const out: DepreciationLine[] = [];
  let acc = Money.zero();
  let y = y0, m = m0;
  for (let i = 0; i < a.lifeYears * 12 + 2 && acc.lt(depreciable); i++) {
    let amt: Money;
    if (i === 0) {
      const days = daysInMonth(y, m) - d0 + 1;
      amt = annualRaw.times(String(days)).ratio(Money.of('1.00'), Money.of('365.00')).round();
    } else {
      amt = annualRaw.ratio(Money.of('1.00'), Money.of('12.00')).round();
    }
    if (acc.plus(amt).gt(depreciable)) amt = depreciable.minus(acc); // เดือนสุดท้ายปรับ
    acc = acc.plus(amt);
    out.push({ month: `${y}-${String(m).padStart(2, '0')}`, amount: amt.toString(), accumulated: acc.toString(), nbv: cost.minus(acc).toString() });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
