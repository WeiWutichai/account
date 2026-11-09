// Money: ยอดเงินทุกที่ใช้ decimal.js · เก็บ/รับส่งเป็น string 2 ตำแหน่ง · ห้าม number (CLAUDE.md)
import { Decimal } from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyString = string; // "1234.50" — รูปแบบใน fixtures/API/DB(NUMERIC 18,2)
const MONEY_RE = /^-?\d+\.\d{2}$/u;

export class Money {
  private constructor(private readonly v: Decimal) {}

  static of(s: MoneyString): Money {
    if (!MONEY_RE.test(s)) throw new Error(`Money ต้องเป็น string ทศนิยม 2 ตำแหน่ง ได้ "${s}"`);
    return new Money(new D(s));
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
  equals(o: Money): boolean {
    return this.v.equals(o.v);
  }
  isZero(): boolean {
    return this.v.isZero();
  }
  toString(): MoneyString {
    return this.v.toFixed(2);
  }
}
