// โครง journal ตาม ADR-002 · Dr=Cr ชั้นที่ 1 (engine) — ชั้นที่ 2 คือ constraint ที่ DB (M1)
import { Money, type MoneyString } from './money.ts';

export type Side = 'Dr' | 'Cr';
/** รูปแบบเดียวกับ expected_journal ใน fixtures: [side, account, amount] */
export type JournalLineTuple = readonly [Side, string, MoneyString];

export interface JournalLine {
  readonly side: Side;
  readonly account: string;
  readonly amount: Money;
}

export class UnbalancedJournalError extends Error {
  constructor(
    readonly debit: MoneyString,
    readonly credit: MoneyString,
  ) {
    super(`Dr ≠ Cr: ${debit} ≠ ${credit}`);
  }
}

const ACCOUNT_RE = /^\d{7}$/u;

export function fromTuples(lines: readonly JournalLineTuple[]): JournalLine[] {
  return lines.map(([side, account, amount]) => {
    if (!ACCOUNT_RE.test(account)) throw new Error(`รหัสบัญชีต้องเป็นตัวเลข 7 หลัก ได้ "${account}"`);
    return { side, account, amount: Money.of(amount) };
  });
}

export function totals(lines: readonly JournalLine[]): { debit: Money; credit: Money } {
  return {
    debit: Money.sum(lines.filter((l) => l.side === 'Dr').map((l) => l.amount)),
    credit: Money.sum(lines.filter((l) => l.side === 'Cr').map((l) => l.amount)),
  };
}

export function assertBalanced(lines: readonly JournalLine[]): void {
  if (lines.length < 2) throw new Error('journal ต้องมีอย่างน้อย 2 บรรทัด');
  const { debit, credit } = totals(lines);
  if (!debit.equals(credit)) throw new UnbalancedJournalError(debit.toString(), credit.toString());
}
