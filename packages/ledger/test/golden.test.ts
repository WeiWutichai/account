import { describe, expect, it } from 'vitest';
import { assertBalanced, fromTuples, Money, totals, UnbalancedJournalError } from '../src/index.ts';
import { doc, fixtures } from './fixtures.ts';

describe('golden 1 · IV2611-0052 บริการ 10,000 + VAT 700 (PLAN §3)', () => {
  const iv = doc('IV2611-0052');
  const lines = fromTuples(iv.expected_journal ?? []);

  it('ตรงกับ PLAN: Dr 1130100 10,700 / Cr 4100200 10,000 / Cr 2150400 700', () => {
    expect(lines.map((l) => [l.side, l.account, l.amount.toString()])).toEqual([
      ['Dr', '1130100', '10700.00'],
      ['Cr', '4100200', '10000.00'],
      ['Cr', '2150400', '700.00'],
    ]);
  });
  it('Dr = Cr และ = grand_total ของเอกสาร', () => {
    assertBalanced(lines);
    expect(totals(lines).debit.toString()).toBe(iv.grand_total);
  });
  it('ภาษีขายของบริการลง 2150400 (ยังไม่ถึงกำหนด ม.78/1) ไม่ใช่ 2150100', () => {
    expect(lines.some((l) => l.account === '2150100')).toBe(false);
  });
});

describe('ทุก expected_journal ใน fixtures ต้องดุล', () => {
  const withJournal = Object.entries(fixtures.documents).filter(([, d]) => d.expected_journal);
  it('มีอย่างน้อย 10 ชุด', () => expect(withJournal.length).toBeGreaterThanOrEqual(10));
  it.each(withJournal.map(([no, d]) => [no, d.expected_journal ?? []] as const))('%s', (_no, tuples) => {
    assertBalanced(fromTuples(tuples));
  });
});

describe('Money / assertBalanced', () => {
  it('ไม่มีปัญหา float: 0.10 + 0.20 = 0.30', () => {
    expect(Money.of('0.10').plus(Money.of('0.20')).toString()).toBe('0.30');
  });
  it('ปฏิเสธ number-ish ที่ไม่ใช่ 2 ตำแหน่ง', () => {
    expect(() => Money.of('1.5')).toThrow();
    expect(() => Money.of('1.505')).toThrow();
  });
  it('ไม่ดุล → UnbalancedJournalError', () => {
    expect(() => assertBalanced(fromTuples([['Dr', '1130100', '100.00'], ['Cr', '4100200', '99.99']]))).toThrow(UnbalancedJournalError);
  });
  it('รหัสบัญชีกลุ่ม (53xxxxx) ใช้ใน engine ไม่ได้', () => {
    expect(() => fromTuples([['Dr', '53xxxxx', '1.00'], ['Cr', '1100100', '1.00']])).toThrow();
  });
});
