// Phase 2A FXB: แปลง journal สกุลต่างประเทศเป็นบาท (last-line rounding) · ผลต่างอัตราแลกเปลี่ยนที่เกิดขึ้นจริง · ปรับมูลค่าสิ้นงวด
import { describe, expect, it } from 'vitest';
import { carryingCleared, convertJournal, Money, post, revaluation, ruleByCode, settleAtOriginalRate, toBase, toTuples, totals, type JournalLine } from '../src/index.ts';

const FIXED = new Set(['1130100', '2110100', '2150100', '2150400', '1170100', '1100100']);
const fixed = (l: JournalLine) => FIXED.has(l.account);

function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('convertJournal', () => {
  it('ใบแจ้งหนี้ USD 10,700.00 @ 33.25 (fixtures/p2a-fx.json IV-USD)', () => {
    const fx = post(ruleByCode('Service[IV]'), { docType: 'IV', amounts: { grand_total: '10700.00', net: '10000.00', vat: '700.00' } });
    const thb = convertJournal(fx, '33.250000', 'USD', fixed);
    expect(toTuples(thb)).toEqual([['Dr', '1130100', '355775.00'], ['Cr', '4100200', '332500.00'], ['Cr', '2150400', '23275.00']]);
    expect(thb.map((l) => l.fx?.amount.toString())).toEqual(['10700.00', '10000.00', '700.00']);
  });
  it('เศษปัดไปบรรทัดสุดท้ายที่ไม่ได้ตรึง — บัญชีคุม/ภาษี = ยอด × อัตรา พอดี · 5,000 เคส Dr = Cr', () => {
    const rand = prng(20261110);
    const amt = (max: number) => Money.of((Math.floor(rand() * max * 100) / 100 + 0.01).toFixed(2));
    for (let i = 0; i < 5000; i++) {
      const lines = [amt(50_000), amt(50_000), amt(50_000)];
      const net = Money.sum(lines);
      const vat = net.times('0.07').round();
      const rate = (rand() * 50 + 0.5).toFixed(6);
      const fx = post(ruleByCode('Credit[IV]'), { docType: 'IV', amounts: { grand_total: net.plus(vat).toString(), vat: vat.toString() }, lines: lines.map((l) => ({ amounts: { amount: l.toString() }, account: '4100100' })) });
      const thb = convertJournal(fx, rate, 'USD', fixed);
      const t = totals(thb);
      expect(t.debit.equals(t.credit)).toBe(true);
      expect(thb.find((l) => l.account === '1130100')!.amount.equals(toBase(net.plus(vat), rate))).toBe(true);
      if (!vat.isZero()) expect(thb.find((l) => l.account === '2150100')!.amount.equals(toBase(vat, rate))).toBe(true);
    }
  });
});

describe('settleAtOriginalRate', () => {
  it('รับ 5,350.00 USD @ 33.80 ล้างลูกหนี้ @ 33.25 → กำไร 2,942.50', () => {
    const lines: JournalLine[] = [
      { side: 'Dr', account: '1100100', amount: Money.of('180830.00') },
      { side: 'Cr', account: '1130100', amount: Money.of('180830.00') },
    ];
    const r = settleAtOriginalRate(lines, 1, toBase('5350.00', '33.25'), { gain: '4910100', loss: '5920100' });
    expect(toTuples(r.lines)).toEqual([['Dr', '1100100', '180830.00'], ['Cr', '1130100', '177887.50'], ['Cr', '4910100', '2942.50']]);
    expect(r.difference.toString()).toBe('2942.50');
  });
  it('จ่ายเจ้าหนี้ 2,000.00 USD @ 33.60 ล้าง @ 33.40 → ขาดทุน 400.00', () => {
    const lines: JournalLine[] = [
      { side: 'Dr', account: '2110100', amount: Money.of('67200.00') },
      { side: 'Cr', account: '1100100', amount: Money.of('67200.00') },
    ];
    const r = settleAtOriginalRate(lines, 0, toBase('2000.00', '33.4'), { gain: '4910100', loss: '5920100' });
    expect(toTuples(r.lines)).toEqual([['Dr', '2110100', '66800.00'], ['Cr', '1100100', '67200.00'], ['Dr', '5920100', '400.00']]);
  });
});

describe('carryingCleared / revaluation', () => {
  it('ตัดครบ = ยอดบาทคงเหลือทั้งหมด · ไม่ครบ = × อัตราเดิม', () => {
    expect(carryingCleared({ settleFx: Money.of('0.01'), openFxBefore: Money.of('0.03'), openBaseBefore: Money.of('1.00'), rate: '33.333333' }).toString()).toBe('0.33');
    expect(carryingCleared({ settleFx: Money.of('0.03'), openFxBefore: Money.of('0.03'), openBaseBefore: Money.of('1.00'), rate: '33.333333' }).toString()).toBe('1.00');
  });
  it('คงค้าง 5,350.00 USD @ 33.50 เทียบ 177,887.50 → +1,337.50', () => {
    const r = revaluation({ openFx: Money.of('5350.00'), carryingBase: Money.of('177887.50'), closingRate: '33.5' });
    expect([r.revalued.toString(), r.adjustment.toString()]).toEqual(['179225.00', '1337.50']);
  });
});
