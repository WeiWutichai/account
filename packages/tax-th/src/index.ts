// @innovera/tax-th — VAT / WHT ตามกติกาที่ล็อกใน CLAUDE.md · pure TS
import { Money, type MoneyString } from '@innovera/ledger';

export const VAT_RATE = '0.07';

/** แยก VAT ออกจากยอดรวม (ราคารวม VAT) · ฐาน = รวม − VAT */
export function splitInclusive(gross: MoneyString): { base: MoneyString; vat: MoneyString } {
  const g = Money.of(gross);
  const vat = g.ratio(Money.of('7.00'), Money.of('107.00')).round();
  return { base: g.minus(vat).toString(), vat: vat.toString() };
}

export function vatOn(base: MoneyString): MoneyString {
  return Money.of(base).times(VAT_RATE).round().toString();
}

/**
 * ภาษีขายที่ถึงกำหนดเมื่อรับชำระ (บริการ ม.78/1) = ยอดที่รับ × VAT ของใบ ÷ ยอดรวมของใบ
 * รับครบ = VAT ทั้งใบพอดี (ไม่มีเศษ)
 */
export function vatDueOnReceipt(settled: MoneyString, invoiceVat: MoneyString, invoiceTotal: MoneyString): MoneyString {
  if (settled === invoiceTotal) return invoiceVat;
  return Money.of(invoiceVat).ratio(Money.of(settled), Money.of(invoiceTotal)).round().toString();
}

export type WhtMethod = 'flat' | 'progressive';
export interface WhtType {
  readonly key: string;
  readonly rate: string; // "0.03"
  readonly pnd: '3' | '53' | '3|53' | '54' | '-';
  readonly method?: WhtMethod;
  /** PENDING_AUDITOR = รอผู้สอบบัญชียืนยัน (CLAUDE.md) — ใช้ค่าตั้งต้นชั่วคราว พร้อมป้าย "รอยืนยัน" */
  readonly status?: 'CONFIRMED' | 'PENDING_AUDITOR';
}

export class PendingAuditorError extends Error {}

/** WHT ฝั่งจ่าย (คำนวณเอง · รับรู้ตอนจ่าย) */
export function whtOnPayment(base: MoneyString, t: WhtType): { amount: MoneyString; pendingAuditor: boolean } {
  if (t.method === 'progressive') {
    // อัตราก้าวหน้า ม.50(1) ยังไม่ทำ — ขึ้นกับคำตอบผู้สอบบัญชี (CLAUDE.md "รอผู้สอบบัญชี")
    throw new PendingAuditorError(`WHT ${t.key}: วิธีอัตราก้าวหน้ารอผู้สอบบัญชียืนยัน`);
  }
  return { amount: Money.of(base).times(t.rate).round().toString(), pendingAuditor: t.status === 'PENDING_AUDITOR' };
}

/**
 * WHT ฝั่งรับ (RV): ไม่คำนวณเอง — ใช้ยอดตามหนังสือรับรอง 50 ทวิ ที่ลูกค้าออก (PLAN §3)
 * เตือนเมื่อต่างจากที่คำนวณได้เกิน tolerance แต่ไม่บังคับแก้
 */
export function whtOnReceipt(p: { base: MoneyString; rate: string; certified: MoneyString; tolerance?: MoneyString }): {
  amount: MoneyString; expected: MoneyString; diff: MoneyString; warning: string | null;
} {
  const expected = Money.of(p.base).times(p.rate).round();
  const certified = Money.of(p.certified);
  const diff = certified.minus(expected);
  const tol = Money.of(p.tolerance ?? '1.00');
  const warning = diff.abs().gt(tol) ? `ยอดตาม 50 ทวิ ${certified.toString()} ต่างจากที่คำนวณได้ ${expected.toString()} อยู่ ${diff.abs().toString()} บาท` : null;
  return { amount: certified.toString(), expected: expected.toString(), diff: diff.toString(), warning };
}
export { bahtText, thaiNumber } from './baht.ts';
export { isPnd54Type, PND54_INCOME_TYPES, pnd54Rate, pnd54Tax, PP36_RATE, pp36Vat, validTreatyRates, type Pnd54IncomeType, type TreatyRates } from './foreign.ts';
export { FREELANCE_DEFAULT, pndOf, WHT_TYPES, whtTypeFor, type FreelanceWhtConfig } from './wht-types.ts';

/** เลขประจำตัวผู้เสียภาษี 13 หลัก ตรวจ checksum (FR-TN-02 · ตัวเดียวกับ apps/id-api/src/org.ts validTaxId) */
export function validateTaxId(id: string): boolean {
  if (!/^\d{13}$/u.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}
