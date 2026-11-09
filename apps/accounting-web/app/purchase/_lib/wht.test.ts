// ตัวเลขจาก fixtures/sample-company.json: AP2611-0079 + CNR2611-0003 (ฐาน 130,000 หัก 3,900) · AP2611-0043 (1% = 372.63) · EXP2611-0019 (600.00)
import { describe, expect, it } from 'vitest';
import { pct } from './types.ts';
import { expectedWht, sumWht } from './wht.ts';

const types = {
  service: { key: 'service', rate: '0.03', pnd: '3|53', label: 'ค่าบริการ' },
  transport_domestic: { key: 'transport_domestic', rate: '0.01', pnd: '53', label: 'ค่าขนส่ง' },
  freelance_software_dev: { key: 'freelance_software_dev', rate: '0.03', pnd: '3|53', label: 'ค่าจ้างพัฒนาซอฟต์แวร์ (ฟรีแลนซ์)', section: '40(2)', status: 'PENDING_AUDITOR' as const },
};

describe('expectedWht', () => {
  it('หักฐานด้วยใบลดหนี้ซื้อบัญชีเดียวกัน (AP2611-0079 − CNR2611-0003)', () => {
    const w = expectedWht([{ amount: '120000.00', account: '5301200', whtType: 'service' }, { amount: '30000.00', account: '5306100', whtType: 'service' }], types, [{ amount: '20000.00', account: '5301200' }]);
    expect(w).toEqual([expect.objectContaining({ type: 'service', base: '130000.00', amount: '3900.00', pendingAuditor: false })]);
  });
  it('ปัดครึ่งขึ้น 2 ตำแหน่ง (AP2611-0043)', () => {
    expect(sumWht(expectedWht([{ amount: '37263.40', account: '5301300', whtType: 'transport_domestic' }], types))).toBe('372.63');
  });
  it('ฟรีแลนซ์ = รอยืนยัน · บรรทัดไม่หักไม่นับ (EXP2611-0019)', () => {
    const w = expectedWht([{ amount: '20000.00', account: '5301200', whtType: 'freelance_software_dev' }, { amount: '850.00', account: '5302100', whtType: null }], types);
    expect(w).toEqual([expect.objectContaining({ amount: '600.00', section: '40(2)', pendingAuditor: true })]);
  });
});

describe('pct', () => {
  it('อัตรา → เปอร์เซ็นต์', () => {
    expect(['0.01', '0.03', '0.05', '0.015', '0.10'].map(pct)).toEqual(['1', '3', '5', '1.5', '10']);
  });
});
