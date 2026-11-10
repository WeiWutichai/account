// หลายสกุลเงิน (Phase 2A FXB · pure) — journal ลงเป็นบาทเสมอ · บรรทัดเก็บยอดสกุลเดิมไว้ใน fx
import { Decimal } from 'decimal.js';
import { assertBalanced, type JournalLine } from './journal.ts';
import { Money, type MoneyString } from './money.ts';

export const BASE_CURRENCY = 'THB';
const RATE_RE = /^\d{1,12}(\.\d{1,6})?$/u;
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** อัตรา NUMERIC(18,6) (บาทต่อ 1 หน่วย) ต้องมากกว่า 0 */
export function isRate(s: string): boolean {
  return RATE_RE.test(s) && new D(s).greaterThan(0);
}

/** ยอดสกุลเอกสาร × อัตรา → บาท ปัด 2 ตำแหน่ง (ครึ่งขึ้น) */
export function toBase(amount: Money | MoneyString, rate: string): Money {
  if (!isRate(rate)) throw new Error(`อัตราแลกเปลี่ยนไม่ถูกต้อง "${rate}"`);
  return (typeof amount === 'string' ? Money.parse(amount) : amount).times(rate).round();
}

/**
 * แปลง journal สกุลเอกสาร → บาท: ทุกบรรทัด = ยอด × อัตรา ปัด 2 ตำแหน่ง แล้วโยนเศษให้ Dr = Cr ไปที่บรรทัดสุดท้ายที่ไม่ได้ตรึงไว้ (last-line rounding)
 * บรรทัดที่ตรึง (fixed) = บัญชีคุม/เงิน/ภาษี — ยอดบาทต้องเท่ากับ ยอด × อัตรา พอดี (ใช้ตัดชำระ/รายงานภาษีภายหลัง) · ที่เหลือ (รายได้/ค่าใช้จ่ายรายบรรทัด) รับเศษ
 */
export function convertJournal(lines: readonly JournalLine[], rate: string, currency: string, fixed: (l: JournalLine) => boolean): JournalLine[] {
  if (currency === BASE_CURRENCY) throw new Error('เอกสารบาทไม่ต้องแปลง');
  assertBalanced(lines);
  const out: JournalLine[] = lines.map((l) => ({ ...l, amount: toBase(l.amount, rate), fx: { currency, amount: l.amount } }));
  const dr = Money.sum(out.filter((l) => l.side === 'Dr').map((l) => l.amount));
  const cr = Money.sum(out.filter((l) => l.side === 'Cr').map((l) => l.amount));
  const diff = dr.minus(cr);
  if (!diff.isZero()) {
    let idx = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (!fixed(out[i]!)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) idx = out.length - 1;
    const l = out[idx]!;
    const amount = l.side === 'Dr' ? l.amount.minus(diff) : l.amount.plus(diff);
    if (!amount.gt(Money.zero())) throw new Error('ปัดเศษอัตราแลกเปลี่ยนแล้วบรรทัดเป็นศูนย์/ติดลบ');
    out[idx] = { ...l, amount };
  }
  assertBalanced(out);
  return out;
}

/**
 * ตัดชำระสกุลต่างประเทศ: บรรทัดบัญชีคุม (ลูกหนี้/เจ้าหนี้ ตำแหน่ง controlIndex) ใช้ยอดบาทตามอัตราเดิม (controlBase) แทนยอดตามอัตราวันรับ/จ่าย
 * ผลต่างที่ทำให้ไม่ดุล → กำไร (Cr gain) / ขาดทุน (Dr loss) จากอัตราแลกเปลี่ยนที่เกิดขึ้นจริง · difference > 0 = กำไร
 */
export function settleAtOriginalRate(lines: readonly JournalLine[], controlIndex: number, controlBase: Money, accounts: { gain: string; loss: string }): { lines: JournalLine[]; difference: Money } {
  if (!lines[controlIndex]) throw new Error('ไม่พบบรรทัดบัญชีคุม');
  if (!controlBase.gt(Money.zero())) throw new Error('ยอดบาทของบัญชีคุมต้องมากกว่าศูนย์');
  const out: JournalLine[] = lines.map((l, i) => (i === controlIndex ? { ...l, amount: controlBase } : l));
  const dr = Money.sum(out.filter((l) => l.side === 'Dr').map((l) => l.amount));
  const cr = Money.sum(out.filter((l) => l.side === 'Cr').map((l) => l.amount));
  const diff = dr.minus(cr);
  if (diff.gt(Money.zero())) out.push({ side: 'Cr', account: accounts.gain, amount: diff, memo: 'กำไรจากอัตราแลกเปลี่ยนที่เกิดขึ้นจริง' });
  else if (diff.isNegative()) out.push({ side: 'Dr', account: accounts.loss, amount: diff.neg(), memo: 'ขาดทุนจากอัตราแลกเปลี่ยนที่เกิดขึ้นจริง' });
  assertBalanced(out);
  return { lines: out, difference: diff };
}

/** ยอดบาทที่ล้างจากเอกสารเมื่อตัดชำระ (อัตราเดิม): ตัดครบ = ยอดบาทคงเหลือทั้งหมด (เศษไปครั้งสุดท้าย) · ไม่ครบ = ยอดสกุลเดิม × อัตราเดิม */
export function carryingCleared(p: { settleFx: Money; openFxBefore: Money; openBaseBefore: Money; rate: string }): Money {
  if (p.settleFx.gt(p.openFxBefore)) throw new Error('ตัดยอดเกินยอดค้าง');
  return p.settleFx.equals(p.openFxBefore) ? p.openBaseBefore : toBase(p.settleFx, p.rate);
}

/** ปรับมูลค่าสิ้นงวด: ยอดค้างสกุลเดิม × อัตราสิ้นงวด − ยอดบาทตามบัญชี (บวก = ยอดบาทของรายการเพิ่มขึ้น) */
export function revaluation(p: { openFx: Money; carryingBase: Money; closingRate: string }): { revalued: Money; adjustment: Money } {
  const revalued = toBase(p.openFx, p.closingRate);
  return { revalued, adjustment: revalued.minus(p.carryingBase) };
}
