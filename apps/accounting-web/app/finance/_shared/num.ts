// ตัวเลขเงินฝั่งหน้าจอ (แสดงผล/รวมยอดระหว่างกรอก) — ใช้ BigInt หน่วยสตางค์ ห้าม float (CLAUDE.md)
// ตัวเลขที่บันทึกจริงคำนวณซ้ำที่ API (Posting Engine) เสมอ

/** "1,234.5" / "1234.50" → "1234.50" · ไม่ถูกต้อง = '' */
export function norm(v: string): string {
  const t = v.replace(/,/gu, '').trim();
  if (!t || !/^\d+(\.\d{0,2})?$/u.test(t)) return '';
  const [i = '0', f = ''] = t.split('.');
  return `${BigInt(i).toString()}.${(f + '00').slice(0, 2)}`;
}
export const cents = (v: string | null | undefined): bigint => {
  if (!v) return 0n;
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  const c = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
};
export const fromCents = (c: bigint): string => {
  const a = (c < 0n ? -c : c).toString().padStart(3, '0');
  return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`;
};
/** หารปัดครึ่งขึ้น (a, b > 0) */
export const roundDiv = (a: bigint, b: bigint): bigint => (a < 0n ? -((-a * 2n + b) / (2n * b)) : (a * 2n + b) / (2n * b));
export const sumCents = (xs: readonly (string | null | undefined)[]): bigint => xs.reduce<bigint>((s, x) => s + cents(x), 0n);

/** อัตรา % ("3" / "1.5") → basis point ×100 (3% = 300) · ไม่ถูกต้อง = null */
export function pctToBp(p: string): bigint | null {
  const t = p.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/u.test(t)) return null;
  return cents(t);
}
/** basis point → อัตราที่ API ใช้ ("0.0300") */
export const bpToRate = (bp: bigint): string => `${bp / 10000n}.${(bp % 10000n).toString().padStart(4, '0')}`;
/** "0.0300" → "3" (แสดงผล) */
export function rateToPct(rate: string | null | undefined): string {
  if (!rate) return '';
  const [i = '0', f = ''] = rate.split('.');
  const bp = BigInt(i) * 10000n + BigInt((f + '0000').slice(0, 4));
  const whole = bp / 100n;
  const frac = (bp % 100n).toString().padStart(2, '0').replace(/0+$/u, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
