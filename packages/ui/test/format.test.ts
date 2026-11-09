import { describe, expect, it } from 'vitest';
import { css } from '../src/css.ts';
import { money, parseThaiDate, thaiDate } from '../src/format.ts';

describe('money', () => {
  it('คอมมา + 2 ตำแหน่ง', () => expect(money('4120088.95')).toBe('4,120,088.95'));
  it('ค่าลบในงบใช้วงเล็บ', () => expect(money('-1187624.16', { paren: true })).toBe('(1,187,624.16)'));
  it('ค่าลบในหน้าทำงานใช้ − ', () => expect(money('-1200.00')).toBe('−1,200.00'));
  it('ช่องศูนย์ใน Dr/Cr เว้นว่าง', () => expect(money('0.00', { blankZero: true })).toBe(''));
});
describe('วันที่', () => {
  it('ค.ศ. → พ.ศ.', () => expect(thaiDate('2026-11-30')).toBe('30/11/2569'));
  it('พ.ศ. → ค.ศ.', () => expect(parseThaiDate('30/11/2569')).toBe('2026-11-30'));
});
describe('css', () => {
  it('แปลง style string ของแบบร่าง', () => expect(css('display: flex; font-variant-numeric: tabular-nums; border-bottom: 1px solid #e0e0e0')).toEqual({ display: 'flex', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid #e0e0e0' }));
});
