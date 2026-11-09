// M4: ยอดเอกสารขาย / รับชำระ / ตัวอักษรจำนวนเงิน — ตัวเลขจาก fixtures เท่านั้น
import { docTotals, fromTuples, post, receiptTotals, ruleByCode, toTuples } from '@innovera/ledger';
import { bahtText, thaiNumber } from '@innovera/tax-th';
import { describe, expect, it } from 'vitest';
import { doc, s } from './fixtures.ts';

type Line = { qty: string; price: string; amount: string; vat: boolean };

describe('ยอดเอกสาร (ScreenInvoice)', () => {
  it('IV2611-0052: บรรทัด × ราคา → มูลค่าก่อนภาษี / VAT / ยอดรวม ตาม fixtures', () => {
    const iv = doc('IV2611-0052');
    const lines = iv.lines as unknown as Line[];
    const t = docTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.price, vat: l.vat })), { priceInclVat: false });
    expect(t.lines.map((l) => l.amount)).toEqual(lines.map((l) => l.amount));
    expect([t.subtotal, t.vat, t.grandTotal]).toEqual([s(iv.subtotal), s(iv.vat), s(iv.grand_total)]);
    expect(bahtText(t.grandTotal as never)).toBe(s(iv.amount_text));
  });
  it('ราคารวม VAT: IV2611-0053 31,200 → ฐาน 29,158.88 + VAT 2,041.12', () => {
    const iv = doc('IV2611-0053');
    const t = docTotals([{ qty: '1', unitPrice: s(iv.grand_total), vat: true }], { priceInclVat: true });
    expect([t.net, t.vat, t.grandTotal]).toEqual([s(iv.subtotal), s(iv.vat), s(iv.grand_total)]);
  });
  it('ส่วนลดท้ายบิลกระจายตามสัดส่วน · รายการไม่มี VAT ไม่คิดภาษี · ยอดรวม = net + vat', () => {
    const t = docTotals([{ qty: '1', unitPrice: '1000', vat: true }, { qty: '1', unitPrice: '500', vat: false }], { priceInclVat: false, billDiscount: '150.00' });
    expect(t).toMatchObject({ subtotal: '1500.00', discount: '150.00', net: '1350.00', exemptBase: '450.00', vatBase: '900.00', vat: '63.00', grandTotal: '1413.00' });
    const inc = docTotals([{ qty: '3', unitPrice: '33.3333', discount: '0.00', vat: true }], { priceInclVat: true, billDiscount: '10.00' });
    expect(Number(inc.net) + Number(inc.vat)).toBeCloseTo(Number(inc.grandTotal), 10);
    expect(inc.grandTotal).toBe('90.00');
  });
});

describe('รับชำระ RV2611-0021 (ScreenReceipt) ตัด 2 ใบ + 50 ทวิ + ค่าธรรมเนียม', () => {
  const rv = doc('RV2611-0021');
  const apps = rv.applications as unknown as { doc: string; applied: string; wht: string }[];
  const r = receiptTotals(apps.map((a) => {
    const iv = doc(a.doc);
    return { invoiceTotal: s(iv.grand_total), invoiceVat: s(iv.vat), vatOnPayment: true, settledBefore: '0.00', vatDueBefore: '0.00', applied: a.applied, wht: a.wht };
  }), s(rv.bank_fee));
  it('ยอดตัด / ภาษีถูกหัก / เงินเข้าจริง / ภาษีขายที่โอน ตรง fixtures', () => {
    expect([r.applied, r.wht, r.cashIn]).toEqual([s(rv.total_applied), s(rv.total_wht), s(rv.cash_in)]);
    expect(r.vatDue).toBe(s((rv.vat_transfer as Record<string, string>).vat));
    expect(bahtText(r.cashIn as never)).toBe(s(rv.amount_text));
  });
  it('Receive[RV] → journal ตาม expected_journal', () => {
    const out = post(ruleByCode('Receive[RV]'), { docType: 'RV', amounts: { cash_in: r.cashIn, wht: r.wht, fee: r.fee, vat_due: r.vatDue, settled: r.settled }, contact: { arAccount: '1130100' }, accounts: { cash: s(rv.bank_account) } });
    expect(new Set(toTuples(out).map((x) => x.join(' ')))).toEqual(new Set(toTuples(fromTuples(rv.expected_journal!)).map((x) => x.join(' '))));
  });
  it('รับส่วนที่เหลือของ IV2611-0053 → ภาษีขายที่โอนรวมเท่ากับ VAT ทั้งใบพอดี', () => {
    const iv = doc('IV2611-0053');
    const first = r.perDoc[1]!;
    const rest = receiptTotals([{ invoiceTotal: s(iv.grand_total), invoiceVat: s(iv.vat), vatOnPayment: true, settledBefore: first.settled, vatDueBefore: first.vatDue, applied: s(iv.outstanding_2569_11_30), wht: '0.00' }]);
    expect((Number(first.vatDue) + Number(rest.vatDue)).toFixed(2)).toBe(s(iv.vat));
    expect(() => receiptTotals([{ invoiceTotal: '100.00', invoiceVat: '0.00', vatOnPayment: false, settledBefore: '90.00', vatDueBefore: '0.00', applied: '20.00', wht: '0.00' }])).toThrow(/เกิน/u);
  });
});

describe('จำนวนเงินเป็นตัวอักษร', () => {
  it.each([['RV2611-0024', 'amount'], ['PV2611-0031', 'paid'], ['RV2611-0022', null]])('%s', (no, field) => {
    const d = doc(no);
    const amount = field ? s(d[field]) : (Number(s(d.cash_in)) + Number(s(d.wht))).toFixed(2);
    expect(bahtText(amount as never)).toBe(s(d.amount_text));
  });
  it('กรณีพิเศษ: เอ็ด ยี่ ล้านซ้อน สตางค์ ศูนย์', () => {
    expect(bahtText('21.00' as never)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(bahtText('101.01' as never)).toBe('หนึ่งร้อยเอ็ดบาทหนึ่งสตางค์');
    expect(bahtText('0.50' as never)).toBe('ห้าสิบสตางค์');
    expect(bahtText('0.00' as never)).toBe('ศูนย์บาทถ้วน');
    expect(thaiNumber('1000000000000')).toBe('หนึ่งล้านล้าน');
    expect(thaiNumber('11000011')).toBe('สิบเอ็ดล้านสิบเอ็ด');
    expect(bahtText('-5.00' as never)).toBe('ลบห้าบาทถ้วน');
  });
});

describe('มัดจำ / เพิ่มหนี้ (สูตรตั้งต้นใหม่ M4)', () => {
  const dp = doc('DP2610-0006');
  it('Deposit[DP] รับมัดจำ → receive_journal', () => {
    const out = post(ruleByCode('Deposit[DP]'), { docType: 'DP', amounts: { grand_total: s(dp.total), net: s(dp.deposit_base), vat: s(dp.vat) }, accounts: { cash: '1100100' } });
    expect(toTuples(out)).toEqual(dp.receive_journal);
  });
  it('Credit[IV] หักมัดจำ → apply_example.journal', () => {
    const ex = dp.apply_example as Record<string, string> & { journal: unknown };
    const out = post(ruleByCode('Credit[IV]'), { docType: 'IV', amounts: { grand_total: ex.customer_pays!, deposit: ex.deposit_applied!, vat: ex.vat_now! }, contact: { arAccount: '1130100' },
      lines: [{ amounts: { amount: ex.work_value! }, account: '4100100' }] });
    expect(new Set(toTuples(out).map((x) => x.join(' ')))).toEqual(new Set((ex.journal as string[][]).map((x) => x.join(' '))));
  });
  it('DN[ref IV] DN2612-0001 → Dr ลูกหนี้ 2,140 / Cr รายได้ 2,000 / Cr ภาษีขาย 140', () => {
    const dn = doc('DN2612-0001');
    const t = docTotals((dn.lines as unknown as Line[]).map((l) => ({ qty: l.qty, unitPrice: l.price, vat: true })), { priceInclVat: false });
    expect([t.net, t.vat, t.grandTotal]).toEqual([s(dn.diff), s(dn.vat), s(dn.total)]);
    const out = post(ruleByCode('DN[ref IV]'), { docType: 'DN', amounts: { grand_total: t.grandTotal, vat: t.vat }, contact: { arAccount: '1130100' }, lines: [{ amounts: { amount: t.net }, account: '4100100' }] });
    expect(toTuples(out)).toEqual([['Dr', '1130100', s(dn.total)], ['Cr', '4100100', s(dn.diff)], ['Cr', '2150100', s(dn.vat)]]);
  });
});
