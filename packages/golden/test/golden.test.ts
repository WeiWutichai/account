// Golden tests 1–9 (PLAN §3) · ตัวเลขจาก fixtures เท่านั้น
import { canPost, depreciationSchedule, fromTuples, legalReserveAllocation, Money, post, reverse, ruleByCode, toTuples, yearEndClose } from '@innovera/ledger';
import { splitInclusive, vatDueOnReceipt, whtOnPayment, whtOnReceipt } from '@innovera/tax-th';
import { describe, expect, it } from 'vitest';
import { doc, fixtures, s, toCE } from './fixtures.ts';

const rate = (k: string) => String(fixtures.wht_rates[k]!.rate);

describe('golden 1 · IV2611-0052 บริการ 10,000 + VAT 700', () => {
  const iv = doc('IV2611-0052');
  it('Service[IV] → Dr 1130100 10,700 / Cr 4100200 10,000 / Cr 2150400 700', () => {
    const out = post(ruleByCode('Service[IV]'), { docType: 'IV', amounts: { grand_total: s(iv.grand_total), net: s(iv.subtotal), vat: s(iv.vat) } });
    expect(toTuples(out)).toEqual(iv.expected_journal);
  });
});

describe('golden 2 · RV2611-0021 รับชำระ 2 ใบ + WHT ตาม 50 ทวิ + ค่าธรรมเนียม', () => {
  const rv = doc('RV2611-0021');
  // ส่วน VAT ที่ถึงกำหนด = ตามสัดส่วนที่รับของแต่ละใบ (IV2610-0049 เต็มใบ · IV2611-0053 บางส่วน 30,000 จาก 31,200)
  const iv49 = splitInclusive('1530200.00');
  const iv53 = splitInclusive('31200.00');
  const vatDue = Money.of(vatDueOnReceipt('1530200.00', iv49.vat, '1530200.00')).plus(Money.of(vatDueOnReceipt('30000.00', iv53.vat, '31200.00'))).toString();
  const wht = whtOnReceipt({ base: iv49.base, rate: '0.03', certified: '42902.80' });

  it('VAT ที่ถึงกำหนด = 102,069.16 · WHT 3% ของฐาน 1,430,093.46 = 42,902.80 ตรง 50 ทวิ', () => {
    expect(iv49.base).toBe('1430093.46');
    expect(vatDue).toBe('102069.16');
    expect(wht.warning).toBeNull();
  });
  it('Receive[RV] → ตรง expected_journal · Dr=Cr 1,662,269.16', () => {
    const settled = '1560200.00';
    const cash = Money.of(settled).minus(Money.of(wht.amount)).minus(Money.of('20.00')).toString();
    const out = post(ruleByCode('Receive[RV]'), { docType: 'RV', amounts: { cash_in: cash, wht: wht.amount, fee: '20.00', vat_due: vatDue, settled }, accounts: { cash: '1100100' } });
    expect(toTuples(out)).toEqual(rv.expected_journal);
    expect(Money.sum(out.filter((l) => l.side === 'Dr').map((l) => l.amount)).toString()).toBe(s(rv.expected_journal_total));
  });
  it('กรณีแยก: 50 ทวิ ระบุ 42,900 → ใช้ยอดตามหนังสือ เตือนต่าง 2.80 ไม่บังคับแก้ · ยังดุล', () => {
    const w = whtOnReceipt({ base: iv49.base, rate: '0.03', certified: '42900.00' });
    expect(w.warning).toMatch(/2\.80/u);
    const out = post(ruleByCode('Receive[RV]'), { docType: 'RV', amounts: { cash_in: '1517280.00', wht: w.amount, fee: '20.00', vat_due: vatDue, settled: '1560200.00' }, accounts: { cash: '1100100' } });
    expect(out.find((l) => l.account === '1160100')!.amount.toString()).toBe('42900.00');
  });
  it('ไม่ระบุบัญชีรับเงิน → error (ห้ามเดา)', () => {
    expect(() => post(ruleByCode('Receive[RV]'), { docType: 'RV', amounts: { cash_in: '1.00', settled: '1.00' } })).toThrow(/ห้ามเดา/u);
  });
});

describe('golden 3 · EXP2611-0019 ฟรีแลนซ์ 20,000 (หัก 3%) + ค่าเดินทาง 850 (ไม่หัก)', () => {
  const exp = doc('EXP2611-0019');
  it('Cash[EXP] → ตรง expected_journal · WHT ติดธง "รอยืนยัน"', () => {
    const w = whtOnPayment('20000.00', { key: 'freelance_software_dev', rate: rate('freelance_software_dev'), pnd: '3', status: 'PENDING_AUDITOR' });
    expect(w).toEqual({ amount: s(exp.wht), pendingAuditor: true });
    const paid = Money.of(s(exp.total)).minus(Money.of(w.amount)).toString();
    const out = post(ruleByCode('Cash[EXP]'), {
      docType: 'EXP', amounts: { paid, wht: w.amount }, accounts: { cash: s(exp.pay_from) },
      lines: [{ account: '5301200', amounts: { amount: '20000.00' } }, { account: '5302100', amounts: { amount: '850.00' } }],
    });
    expect(paid).toBe(s(exp.paid));
    expect(toTuples(out)).toEqual(exp.expected_journal);
  });
});

describe('golden 4 · AP2611-0088 ค่าขนส่ง 600,000 ไม่มี VAT · PV หัก 1%', () => {
  it('ตั้งหนี้ไม่มี WHT (รับรู้ตอนจ่าย)', () => {
    const ap = doc('AP2611-0088');
    const out = post(ruleByCode('Credit[AP]'), { docType: 'AP', amounts: { grand_total: s(ap.grand_total) }, lines: [{ account: '5301300', amounts: { amount: s(ap.subtotal) } }] });
    expect(toTuples(out)).toEqual(ap.expected_journal);
    expect(out.some((l) => l.account === '2150300')).toBe(false);
  });
  it('PV2611-0031 จ่าย 720,000 → WHT 1% = 7,200 (ขนส่ง)', () => {
    const pv = doc('PV2611-0031');
    const w = whtOnPayment(s(pv.outstanding), { key: 'transport_domestic', rate: rate('transport_domestic'), pnd: '53' });
    const out = post(ruleByCode('Pay[PV]'), { docType: 'PV', amounts: { settled: s(pv.outstanding), paid: Money.of(s(pv.outstanding)).minus(Money.of(w.amount)).toString(), wht: w.amount }, accounts: { cash: s(pv.pay_from) } });
    expect(toTuples(out)).toEqual(pv.expected_journal);
  });
});

describe('golden 5 · CNR2611-0003 ลดหนี้ซื้อ 20,000 + กลับภาษีซื้อ 1,400', () => {
  it('CNR → ตรง expected_journal', () => {
    const cnr = doc('CNR2611-0003');
    const out = post(ruleByCode('CNR'), { docType: 'CNR', amounts: { grand_total: s(cnr.total), vat: s(cnr.vat) }, lines: [{ account: '5301200', amounts: { amount: s(cnr.subtotal) } }] });
    expect(toTuples(out)).toEqual(cnr.expected_journal);
  });
});

describe('golden 6 · ค่าเสื่อม FA-0017 (78,000 − 1) ÷ 3 ปี', () => {
  const fa = fixtures.fixed_assets.find((a) => a['code'] === 'FA-0017')!;
  const sch = depreciationSchedule({ cost: s(fa['cost']), salvage: s(fa['salvage']), lifeYears: Number(fa['life_years']), startDate: toCE(s(fa['start'])) });
  it('เดือนแรก 19 วัน = 1,353.41', () => {
    expect(sch[0]).toMatchObject({ month: '2026-11', amount: s(fa['first_month_dep']) });
  });
  it('เดือนสุดท้ายปรับให้สะสม = ทุน − ซาก พอดี (77,999.00) · มูลค่าคงเหลือ = ซาก', () => {
    const last = sch[sch.length - 1]!;
    expect(last.accumulated).toBe('77999.00');
    expect(last.nbv).toBe('1.00');
    expect(Money.sum(sch.map((x) => Money.of(x.amount))).toString()).toBe('77999.00');
  });
});

describe('golden 7 · ปิดปี งวด 13 + สำรองตามกฎหมาย', () => {
  const ye = fixtures.year_end_2569_preview;
  const rev = ye['close_pl']!.find((l) => l[1] === '4xxxxxx')![2];
  const exp = ye['close_pl']!.find((l) => l[1] === '5xxxxxx')![2];
  // แยกเป็นหลายบัญชีให้รวมได้ยอดเดียวกับ fixtures
  const balances = [
    { account: '4100100', type: 'revenue', balance: Money.of(rev).minus(Money.of('1284000.00')).neg().toString() },
    { account: '4101100', type: 'revenue', balance: '-1284000.00' },
    { account: '5301200', type: 'expense', balance: '8840000.00' },
    { account: '5303100', type: 'expense', balance: Money.of(exp).minus(Money.of('8840000.00')).toString() },
    { account: '1100100', type: 'asset', balance: '2297170.15' },
  ];
  it('ปิดรายได้/ค่าใช้จ่าย → 3900100 → 3200100 เต็มจำนวน 2,872,880 · ไม่มีสำรองตามกฎหมาย', () => {
    const r = yearEndClose(balances);
    expect(r.netProfit).toBe('2872880.00');
    expect(toTuples(r.transfer)).toEqual(ye['transfer_re']);
    expect(r.closePl.some((l) => l.account === '3300100')).toBe(false);
    expect(r.closePl.some((l) => l.account === '1100100')).toBe(false);
  });
  it('สำรองตามกฎหมายตามมติปันผล: 5% ของกำไร แต่ไม่เกินเพดาน 10% ของทุน', () => {
    expect(legalReserveAllocation({ netProfit: '2872880.00', registeredCapital: '10000000.00', existingReserve: '0.00' }).amount).toBe('143644.00');
    const capped = legalReserveAllocation({ netProfit: '2872880.00', registeredCapital: '10000000.00', existingReserve: '950000.00' });
    expect(capped).toMatchObject({ amount: '50000.00', capReached: true });
    expect(legalReserveAllocation({ netProfit: '2872880.00', registeredCapital: '10000000.00', existingReserve: '1000000.00' }).amount).toBe('0.00');
    expect(() => legalReserveAllocation({ netProfit: '1.00', registeredCapital: '1.00', existingReserve: '0.00', rate: '0.04' })).toThrow(/5%/u);
  });
});

describe('golden 8 · void IV ที่ผ่านแล้ว → reversal ครบทุกบรรทัด', () => {
  it('IV2611-0058 53,500 → expected_reversal', () => {
    const iv = doc('IV2611-0058');
    const original = post(ruleByCode('Service[IV]'), { docType: 'IV', amounts: { grand_total: s(iv.grand_total), net: '50000.00', vat: '3500.00' } });
    const rev = reverse(original);
    // ลำดับอาจต่าง — เทียบแบบไม่สนลำดับ
    expect(new Set(toTuples(rev).map((t) => t.join('|')))).toEqual(new Set(fromTuples(iv.expected_reversal!).map((l) => [l.side, l.account, l.amount.toString()].join('|'))));
  });
});

describe('golden 9 · สิทธิ์ลงรายการตามสถานะงวด', () => {
  it('hard_closed → ทุกคน reject', () => {
    expect(canPost('hard_closed', 'owner').ok).toBe(false);
  });
  it('soft_closed → accountant reject · manager ผ่าน', () => {
    expect(canPost('soft_closed', 'accountant').ok).toBe(false);
    expect(canPost('soft_closed', 'accounting_manager').ok).toBe(true);
  });
  it('open → accountant ผ่าน · viewer reject', () => {
    expect(canPost('open', 'accountant').ok).toBe(true);
    expect(canPost('open', 'viewer').ok).toBe(false);
  });
});
