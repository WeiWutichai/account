// property test ปัดเศษ 10,000 เคส (Gate M2) · PRNG แบบกำหนด seed — ผลซ้ำได้ทุกครั้ง
import { describe, expect, it } from 'vitest';
import { allocate, assertBalanced, Money, post, ruleByCode } from '../src/index.ts';

function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = prng(20261109);
const amount = (max: number) => (Math.floor(rand() * max * 100) / 100).toFixed(2);
const N = 10_000;

describe(`last-line rounding · ${N} เคส`, () => {
  it('allocate: ผลรวมของส่วน = ยอดรวมพอดีเสมอ และทุกส่วนเป็น 2 ตำแหน่ง', () => {
    for (let i = 0; i < N; i++) {
      const total = Money.of(amount(10_000_000));
      const weights = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => Money.of(amount(100_000)));
      if (Money.sum(weights).isZero()) continue;
      const parts = allocate(total, weights);
      expect(Money.sum(parts).toString()).toBe(total.toString());
      for (const p of parts) expect(p.isRounded()).toBe(true);
    }
  });
  it('Service[IV]: ฐาน + VAT (ปัดครั้งเดียว) = ยอดรวม และ Dr = Cr เสมอ', () => {
    for (let i = 0; i < N; i++) {
      const net = Money.of(amount(5_000_000));
      const vat = net.times('0.07').round();
      const gt = net.plus(vat);
      const lines = post(ruleByCode('Service[IV]'), { docType: 'IV', amounts: { grand_total: gt.toString(), net: net.toString(), vat: vat.toString() } });
      assertBalanced(lines);
    }
  });
  it('รับชำระบางส่วนหลายงวด: ผลรวม VAT ที่โอนแต่ละงวด (งวดสุดท้ายรับเศษ) = VAT ทั้งใบ', () => {
    for (let i = 0; i < N / 10; i++) {
      const total = Money.of(amount(1_000_000));
      if (total.isZero()) continue;
      const vat = total.ratio(Money.of('7.00'), Money.of('107.00')).round();
      const k = 1 + Math.floor(rand() * 6);
      const pays = allocate(total, Array.from({ length: k }, () => Money.of(amount(1000)).plus(Money.of('0.01'))));
      const vatParts = allocate(vat, pays);
      expect(Money.sum(vatParts).toString()).toBe(vat.toString());
    }
  });
});
