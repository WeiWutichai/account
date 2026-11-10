// โครง journal ตาม ADR-002 · Dr=Cr ชั้นที่ 1 (engine) — ชั้นที่ 2 คือ constraint ที่ DB
import { Money, type MoneyString } from './money.ts';

export type Side = 'Dr' | 'Cr';
/** รูปแบบเดียวกับ expected_journal ใน fixtures: [side, account, amount] */
export type JournalLineTuple = readonly [Side, string, MoneyString];

export interface JournalLine {
  readonly side: Side;
  readonly account: string;
  readonly amount: Money;
  readonly contactId?: string;
  readonly memo?: string;
  /** ยอดสกุลเดิมของบรรทัด (เอกสารสกุลต่างประเทศ · Phase 2A FXB) — amount = บาทเสมอ */
  readonly fx?: { readonly currency: string; readonly amount: Money };
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
export const isAccountCode = (s: string): boolean => ACCOUNT_RE.test(s);

export function fromTuples(lines: readonly JournalLineTuple[]): JournalLine[] {
  return lines.map(([side, account, amount]) => {
    if (!ACCOUNT_RE.test(account)) throw new Error(`รหัสบัญชีต้องเป็นตัวเลข 7 หลัก ได้ "${account}"`);
    return { side, account, amount: Money.of(amount) };
  });
}

export function toTuples(lines: readonly JournalLine[]): JournalLineTuple[] {
  return lines.map((l) => [l.side, l.account, l.amount.toString()] as const);
}

export function totals(lines: readonly JournalLine[]): { debit: Money; credit: Money } {
  return {
    debit: Money.sum(lines.filter((l) => l.side === 'Dr').map((l) => l.amount)),
    credit: Money.sum(lines.filter((l) => l.side === 'Cr').map((l) => l.amount)),
  };
}

export function assertBalanced(lines: readonly JournalLine[]): void {
  if (lines.length < 2) throw new Error('journal ต้องมีอย่างน้อย 2 บรรทัด');
  for (const l of lines) {
    if (!l.amount.isRounded()) throw new Error(`บรรทัด ${l.account} ยังไม่ปัดเศษ`);
    if (l.amount.isNegative()) throw new Error(`บรรทัด ${l.account} ติดลบ`);
  }
  const { debit, credit } = totals(lines);
  if (!debit.equals(credit)) throw new UnbalancedJournalError(debit.toString(), credit.toString());
}

/** กลับรายการ (void): สลับฝั่งทุกบรรทัด ยอดเท่าเดิม (ADR-002 · golden 8) */
export function reverse(lines: readonly JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, side: l.side === 'Dr' ? 'Cr' : 'Dr' }));
}
