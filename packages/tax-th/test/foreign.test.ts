// Phase 2A SWT: ภ.พ.36 / ภ.ง.ด.54 (อัตราตามประมวล = ค่าตั้งต้นชั่วคราว รอผู้สอบบัญชี · อนุสัญญา = ค่าตั้งบริษัท)
import { describe, expect, it } from 'vitest';
import { isPnd54Type, PND54_INCOME_TYPES, pnd54Rate, pnd54Tax, pp36Vat, validTreatyRates, WHT_TYPES, whtTypeFor } from '../src/index.ts';

describe('ภ.ง.ด.54', () => {
  it('อัตราตามประมวล (ค่าตั้งต้น): 15% · เงินปันผล 10% · ป้ายรอยืนยัน', () => {
    expect(PND54_INCOME_TYPES.pnd54_royalty!.rate).toBe('0.15');
    expect(PND54_INCOME_TYPES.pnd54_dividend!.rate).toBe('0.10');
    expect(whtTypeFor('pnd54_service')).toMatchObject({ pnd: '54', rate: '0.15', section: '40(2)', status: 'PENDING_AUDITOR' });
  });
  it('ไม่เพิ่มในรายการ WHT_TYPES เดิม (หน้าจอ Phase 1 ไม่เปลี่ยน)', () => {
    expect(Object.keys(WHT_TYPES).some(isPnd54Type)).toBe(false);
  });
  it('อนุสัญญาตามประเทศ (config) · ไม่ตั้ง = อัตราตามประมวล', () => {
    const treaty = { SG: { pnd54_royalty: '0.10' } };
    expect(pnd54Rate('pnd54_royalty', 'SG', treaty)).toMatchObject({ rate: '0.10', treaty: true });
    expect(pnd54Rate('pnd54_royalty', 'JP', treaty)).toMatchObject({ rate: '0.15', treaty: false });
    expect(pnd54Rate('pnd54_royalty', null)).toMatchObject({ rate: '0.15', treaty: false });
    expect(() => pnd54Rate('service', 'SG')).toThrow();
  });
  it('ภาษี: ปกติ = ฐาน × อัตรา · ออกแทน = ฐาน × อัตรา ÷ (1 − อัตรา)', () => {
    expect(pnd54Tax('100000.00', '0.15')).toEqual({ base: '100000.00', tax: '15000.00' });
    expect(pnd54Tax('8500.00', '0.15', true)).toEqual({ base: '10000.00', tax: '1500.00' });
  });
  it('ตรวจรูปค่าตั้งอนุสัญญา', () => {
    expect(validTreatyRates({})).toBe(true);
    expect(validTreatyRates({ SG: { pnd54_royalty: '0.10' } })).toBe(true);
    expect(validTreatyRates({ sg: { pnd54_royalty: '0.10' } })).toBe(false);
    expect(validTreatyRates({ SG: { royalty: '0.10' } })).toBe(false);
    expect(validTreatyRates({ SG: { pnd54_royalty: '1.5' } })).toBe(false);
  });
});

describe('ภ.พ.36', () => {
  it('7% ของฐานบาท', () => {
    expect(pp36Vat('50000.00')).toBe('3500.00');
    expect(pp36Vat('8500.00')).toBe('595.00');
  });
});
