import { describe, expect, it } from 'vitest';
import { PendingAuditorError, splitInclusive, vatDueOnReceipt, vatOn, whtOnPayment, whtOnReceipt } from '../src/index.ts';

describe('VAT', () => {
  it('ราคารวม VAT 281,200 → ฐาน 262,803.74 + VAT 18,396.26 (IV2611-0056)', () => expect(splitInclusive('281200.00')).toEqual({ base: '262803.74', vat: '18396.26' }));
  it('VAT 7% ของ 10,000 = 700', () => expect(vatOn('10000.00')).toBe('700.00'));
  it('รับบางส่วน 30,000 จากใบ 31,200 (VAT 2,041.12) → 1,962.62', () => expect(vatDueOnReceipt('30000.00', '2041.12', '31200.00')).toBe('1962.62'));
  it('รับครบ = VAT ทั้งใบ', () => expect(vatDueOnReceipt('1530200.00', '100106.54', '1530200.00')).toBe('100106.54'));
});

describe('WHT', () => {
  it('ขนส่ง 1% ของ 720,000 = 7,200', () => expect(whtOnPayment('720000.00', { key: 'transport_domestic', rate: '0.01', pnd: '53' }).amount).toBe('7200.00'));
  it('ฟรีแลนซ์: ค่าตั้งต้นชั่วคราว 3% พร้อมธง "รอยืนยัน"', () => {
    expect(whtOnPayment('20000.00', { key: 'freelance_software_dev', rate: '0.03', pnd: '3', status: 'PENDING_AUDITOR' })).toEqual({ amount: '600.00', pendingAuditor: true });
  });
  it('วิธีอัตราก้าวหน้า → ไม่เดา (รอผู้สอบบัญชี)', () => {
    expect(() => whtOnPayment('20000.00', { key: 'freelance_software_dev', rate: '0', pnd: '3', method: 'progressive' })).toThrow(PendingAuditorError);
  });
  it('ฝั่งรับ: ใช้ยอดตาม 50 ทวิ 42,900 · เตือนต่าง 2.80 แต่ไม่บังคับ', () => {
    const r = whtOnReceipt({ base: '1430093.46', rate: '0.03', certified: '42900.00' });
    expect(r).toMatchObject({ amount: '42900.00', expected: '42902.80', diff: '-2.80' });
    expect(r.warning).toMatch(/2\.80/u);
  });
  it('ฝั่งรับ: ตรงกัน → ไม่มีคำเตือน', () => expect(whtOnReceipt({ base: '1430093.46', rate: '0.03', certified: '42902.80' }).warning).toBeNull());
});
