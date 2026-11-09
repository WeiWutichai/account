import { describe, expect, it } from 'vitest';
import { DocumentDraftCreate, Money, WebhookEvent } from '../src/index.ts';

describe('Money', () => {
  it('รับ string 2 ตำแหน่ง', () => expect(Money.parse('1070.00')).toBe('1070.00'));
  it.each([[1070], ['1070'], ['1070.5'], ['1070.505'], ['1,070.00']])('ปฏิเสธ %j', (v) => expect(Money.safeParse(v).success).toBe(false));
});

describe('DocumentDraftCreate', () => {
  const ok = { doc_type: 'AP', issue_date: '2026-11-28', contact_code: 'V0102', lines: [{ description: 'ค่าขนส่ง', amount: '600000.00' }], external_source: 'tms', external_ref: 'SUB-BILL-7701' };
  it('รับเอกสารจาก TMS', () => expect(DocumentDraftCreate.parse(ok).branch_code).toBe('00000'));
  it('ห้ามส่ง status มา (สร้างได้แค่ร่าง)', () => expect(DocumentDraftCreate.safeParse({ ...ok, status: 'posted' }).success).toBe(false));
  it('external_source ต้องมาคู่กับ external_ref', () => expect(DocumentDraftCreate.safeParse({ ...ok, external_ref: undefined }).success).toBe(false));
  it('ต้องมีอย่างน้อย 1 บรรทัด', () => expect(DocumentDraftCreate.safeParse({ ...ok, lines: [] }).success).toBe(false));
});

describe('WebhookEvent', () => {
  it('payment.paid ไป TMS', () => {
    expect(WebhookEvent.safeParse({ id: '2c1d0f6e-1b7b-4a8f-9a55-9f0a7c6f0b11', type: 'payment.paid', company_id: '3c1d0f6e-1b7b-4a8f-9a55-9f0a7c6f0b11',
      occurred_at: '2026-11-28T09:40:00Z', data: { doc_no: 'PV2611-0031', amount: '712800.00', external_ref: 'SUB-BILL-7701' } }).success).toBe(true);
  });
});
