// Money: ยอดเงินทุกที่ใช้ decimal.js · เก็บ/รับส่งเป็น string 2 ตำแหน่ง · ห้าม number (CLAUDE.md)
// การคูณ/หารคืนค่าความละเอียดเต็ม — ต้องเรียก round() ก่อนรวมยอด/บันทึก (last-line rounding: ADR-002)
import { Decimal } from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyString = string; // "1234.50" — รูปแบบใน fixtures/API/DB(NUMERIC 18,2)
const MONEY_RE = /^-?\d+\.\d{2}$/u;
const NUM_RE = /^-?\d+(\.\d+)?$/u;

export class Money {
  private constructor(private readonly v: Decimal) {}

  static of(s: MoneyString): Money {
    if (!MONEY_RE.test(s)) throw new Error(`Money ต้องเป็น string ทศนิยม 2 ตำแหน่ง ได้ "${s}"`);
    return new Money(new D(s));
  }
  /** รับ string 0–2 ตำแหน่ง (เช่นจาก DB/ฟอร์ม "1070" หรือ "1070.5") แล้วทำเป็น 2 ตำแหน่ง */
  static parse(s: string): Money {
    if (!NUM_RE.test(s)) throw new Error(`ไม่ใช่ตัวเลข: "${s}"`);
    const d = new D(s);
    if (d.decimalPlaces() > 2) throw new Error(`ยอดเงินเกิน 2 ตำแหน่ง: "${s}"`);
    return new Money(d);
  }
  static zero(): Money {
    return new Money(new D(0));
  }
  /** ผลรวมแบบไม่ปัดระหว่างทาง */
  static sum(xs: readonly Money[]): Money {
    return xs.reduce((a, b) => a.plus(b), Money.zero());
  }
  plus(o: Money): Money {
    return new Money(this.v.plus(o.v));
  }
  minus(o: Money): Money {
    return new Money(this.v.minus(o.v));
  }
  /** คูณด้วยอัตรา/สัดส่วน (string) · ผลยังไม่ปัด */
  times(factor: string): Money {
    if (!NUM_RE.test(factor)) throw new Error(`factor ไม่ใช่ตัวเลข: "${factor}"`);
    return new Money(this.v.times(factor));
  }
  /** this × num ÷ den (เช่น ส่วนของ VAT ตามยอดที่รับ) · ผลยังไม่ปัด */
  ratio(num: Money, den: Money): Money {
    if (den.isZero()) throw new Error('หารด้วยศูนย์');
    return new Money(this.v.times(num.v).dividedBy(den.v));
  }
  /** ปัด 2 ตำแหน่ง ครึ่งขึ้น */
  round(): Money {
    return new Money(this.v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }
  neg(): Money {
    return new Money(this.v.negated());
  }
  abs(): Money {
    return new Money(this.v.abs());
  }
  equals(o: Money): boolean {
    return this.v.equals(o.v);
  }
  gt(o: Money): boolean {
    return this.v.greaterThan(o.v);
  }
  lt(o: Money): boolean {
    return this.v.lessThan(o.v);
  }
  isZero(): boolean {
    return this.v.isZero();
  }
  isNegative(): boolean {
    return this.v.isNegative() && !this.v.isZero();
  }
  isRounded(): boolean {
    return this.v.decimalPlaces() <= 2;
  }
  toString(): MoneyString {
    if (!this.isRounded()) throw new Error(`ยังไม่ปัดเศษ: ${this.v.toString()} — เรียก round() ก่อน`);
    return this.v.toFixed(2);
  }
}

/** last-line rounding: ปัดทุกส่วนแล้วโยนเศษไปส่วนสุดท้าย ให้ผลรวม = total พอดี */
export function allocate(total: Money, weights: readonly Money[]): Money[] {
  if (weights.length === 0) return [];
  const wsum = Money.sum(weights);
  const parts = weights.map((w) => (wsum.isZero() ? Money.zero() : total.ratio(w, wsum).round()));
  const diff = total.round().minus(Money.sum(parts));
  parts[parts.length - 1] = parts[parts.length - 1]!.plus(diff);
  return parts;
}
