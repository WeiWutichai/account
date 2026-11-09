import { describe, expect, it } from 'vitest';
import { lineDiscount, marginPct, percentOf, qtyText, qtyTimesPrice, sumMoney } from './num.ts';

describe('num (หน้าจอขาย)', () => {
  it('ส่วนลดซ้อน 10% + 5% ตาม ScreenQuote QO2611-0014', () => {
    expect(lineDiscount('10% + 5%', '120', '1500.00')).toBe('26100.00');
    expect(qtyTimesPrice('120', '1500')).toBe('180000.00');
  });
  it('ส่วนลดเป็นจำนวนเงิน / ว่าง / ผิดรูปแบบ', () => {
    expect(lineDiscount('1,000', '1', '5000')).toBe('1000.00');
    expect(lineDiscount('', '1', '5000')).toBe('0.00');
    expect(lineDiscount('abc%', '1', '5000')).toBeNull();
  });
  it('มัดจำ 30% ของ 267,393.00 = 80,217.90', () => expect(percentOf('267393.00', '30')).toBe('80217.90'));
  it('รวมยอด/จำนวน', () => {
    expect(sumMoney(['10000.00', '4000.00', '-0.01'])).toBe('13999.99');
    expect(qtyText('4.0000')).toBe('4');
    expect(qtyText('1200.5000')).toBe('1,200.5');
  });
  it('กำไรขั้นต้น % ตาม ScreenQuote QO2611-0014 · ต่ำกว่าทุน', () => {
    expect(marginPct('153900.00', '96000.00')).toBe('37.6');
    expect(marginPct('96000.00', '24000.00')).toBe('75.0');
    expect(marginPct('249900.00', '126000.00')).toBe('49.6');
    expect(marginPct('0.00', '6000.00')).toBe('below');
    expect(marginPct('100.00', null)).toBeNull();
  });
});
