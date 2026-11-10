// ภาษีจ่ายต่างประเทศ (Phase 2A SWT) — pure TS
// ภ.พ.36 (ม.83/6): ผู้จ่ายค่าบริการให้ผู้ประกอบการต่างประเทศนำส่ง VAT แทน 7% ของเงินที่จ่าย → ใช้เป็นภาษีซื้อได้เดือนถัดไป (เมื่อยื่น/ชำระแล้ว)
// ภ.ง.ด.54 (ม.70): หัก ณ ที่จ่ายเงินได้ 40(2)–(6) ที่จ่ายนิติบุคคลต่างประเทศที่ไม่ได้ประกอบกิจการในไทย
// TODO(Wei) รอผู้สอบบัญชี: อัตราตามประมวลรัษฎากรด้านล่าง (15% · เงินปันผล 10%) และเงื่อนไข ภ.พ.36 แต่ละกรณี ต้องยืนยันก่อนใช้จริง
//   อัตราตามอนุสัญญาภาษีซ้อนรายประเทศ = ค่าตั้งบริษัท tax.pnd54.treaty_rates (ค่าตั้งต้นว่าง = ใช้อัตราตามประมวล) · ระบบไม่ใส่อัตราอนุสัญญาให้เอง
import { Money, type MoneyString } from '@innovera/ledger';

export const PP36_RATE = '0.07';

export interface Pnd54IncomeType { readonly key: string; readonly section: string; readonly rate: string; readonly label: string }
/** อัตราตามประมวลรัษฎากร ม.70 (ค่าตั้งต้นชั่วคราว · TODO(Wei) ยืนยัน) */
export const PND54_INCOME_TYPES: Readonly<Record<string, Pnd54IncomeType>> = {
  pnd54_service: { key: 'pnd54_service', section: '40(2)', rate: '0.15', label: 'ค่าบริการ/ค่านายหน้า จ่ายต่างประเทศ' },
  pnd54_royalty: { key: 'pnd54_royalty', section: '40(3)', rate: '0.15', label: 'ค่าสิทธิ/ค่าลิขสิทธิ์ จ่ายต่างประเทศ' },
  pnd54_interest: { key: 'pnd54_interest', section: '40(4)(ก)', rate: '0.15', label: 'ดอกเบี้ย จ่ายต่างประเทศ' },
  pnd54_dividend: { key: 'pnd54_dividend', section: '40(4)(ข)', rate: '0.10', label: 'เงินปันผล จ่ายต่างประเทศ' },
  pnd54_rent: { key: 'pnd54_rent', section: '40(5)', rate: '0.15', label: 'ค่าเช่า จ่ายต่างประเทศ' },
  pnd54_professional: { key: 'pnd54_professional', section: '40(6)', rate: '0.15', label: 'ค่าวิชาชีพอิสระ จ่ายต่างประเทศ' },
};
export const isPnd54Type = (key: string | null | undefined): boolean => Boolean(key && key in PND54_INCOME_TYPES);

/** ค่าตั้ง tax.pnd54.treaty_rates: { "SG": { "pnd54_royalty": "0.10" } } — ประเทศ (ISO alpha-2) → ประเภทเงินได้ → อัตรา */
export type TreatyRates = Readonly<Record<string, Readonly<Record<string, string>>>>;
const RATE_RE = /^0(\.\d{1,4})?$/u;

export function validTreatyRates(v: unknown): v is TreatyRates {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const [country, rates] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[A-Z]{2}$/u.test(country) || !rates || typeof rates !== 'object' || Array.isArray(rates)) return false;
    for (const [k, r] of Object.entries(rates as Record<string, unknown>)) if (!isPnd54Type(k) || typeof r !== 'string' || !RATE_RE.test(r)) return false;
  }
  return true;
}

/** อัตรา ภ.ง.ด.54: อนุสัญญาของประเทศผู้รับ (ถ้าตั้งไว้) มิฉะนั้นอัตราตามประมวล */
export function pnd54Rate(key: string, country: string | null | undefined, treaty: TreatyRates = {}): { rate: string; treaty: boolean; section: string; label: string } {
  const t = PND54_INCOME_TYPES[key];
  if (!t) throw new Error(`ไม่รู้จักประเภทเงินได้ ภ.ง.ด.54 ${key}`);
  const r = country ? treaty[country]?.[key] : undefined;
  return r !== undefined ? { rate: r, treaty: true, section: t.section, label: t.label } : { rate: t.rate, treaty: false, section: t.section, label: t.label };
}

/**
 * ภาษีหัก ณ ที่จ่าย ภ.ง.ด.54 · grossUp = ผู้จ่ายออกภาษีแทน (tax.pnd54.gross_up · รอยืนยัน):
 *   ปกติ: ภาษี = ฐาน × อัตรา · ผู้รับได้ ฐาน − ภาษี
 *   ออกแทน: เงินได้ที่ใช้คำนวณ = ฐาน ÷ (1 − อัตรา) · ภาษี = ฐาน × อัตรา ÷ (1 − อัตรา) · ผู้รับได้ ฐาน เต็ม
 */
export function pnd54Tax(base: MoneyString, rate: string, grossUp = false): { base: MoneyString; tax: MoneyString } {
  const b = Money.of(base);
  if (!grossUp) return { base: b.toString(), tax: b.times(rate).round().toString() };
  const one = Money.parse('1');
  const tax = b.times(rate).ratio(one, one.minus(one.times(rate))).round();
  return { base: b.plus(tax).toString(), tax: tax.toString() };
}

/** VAT ที่นำส่งแทน (ภ.พ.36) = ฐาน (บาท) × 7% */
export function pp36Vat(base: MoneyString): MoneyString {
  return Money.of(base).times(PP36_RATE).round().toString();
}
