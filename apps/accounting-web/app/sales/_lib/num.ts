// เลขทศนิยมแบบ fixed-point (BigInt) สำหรับหน้าจอขาย — ห้าม float (CLAUDE.md)
// ยอดหลักทั้งหมดมาจาก API (POST /v1/documents/preview · docTotals ใน @innovera/ledger) · ไฟล์นี้ใช้เฉพาะ
// รวมยอดในตาราง · แปลงสูตรส่วนลด "10% + 5%" เป็นจำนวนเงิน · คิดเปอร์เซ็นต์มัดจำ · ปัดแบบ half-up

/** "1,234.5" → 1234.5 ที่ scale ตำแหน่ง (BigInt) · ไม่ถูกต้อง = null */
export function parseDec(v: string | null | undefined, scale: number): bigint | null {
  if (v === null || v === undefined) return null;
  const t = v.replace(/,/gu, '').trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/u.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = (m[3] ?? '').padEnd(scale + 1, '0');
  let n = BigInt(`${m[2] || '0'}${frac.slice(0, scale)}`);
  if (Number(frac[scale] ?? '0') >= 5) n += 1n; // half-up ที่หลักถัดไป
  return m[1] === '-' ? -n : n;
}

/** หาร BigInt แบบปัดครึ่งขึ้น (ห่างจากศูนย์) */
export function divRound(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n);
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  const q = (x * 2n + y) / (y * 2n);
  return neg ? -q : q;
}

export const toCents = (v: string | null | undefined): bigint => parseDec(v, 2) ?? 0n;
export function fromCents(c: bigint): string {
  const a = (c < 0n ? -c : c).toString().padStart(3, '0');
  return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`;
}
export const sumMoney = (xs: readonly (string | null | undefined)[]): string => fromCents(xs.reduce((s, x) => s + toCents(x), 0n));
export const subMoney = (a: string | null | undefined, b: string | null | undefined): string => fromCents(toCents(a) - toCents(b));
export const isZero = (v: string | null | undefined): boolean => toCents(v) === 0n;

/** จำนวน × ราคา/หน่วย (4 ตำแหน่งทั้งคู่) ปัด 2 ตำแหน่ง — ตรงกับ lineGross ใน @innovera/ledger */
export function qtyTimesPrice(qty: string, price: string): string | null {
  const q = parseDec(qty, 4);
  const p = parseDec(price, 4);
  if (q === null || p === null) return null;
  return fromCents(divRound(q * p, 1_000_000n));
}

/** ยอด × pct% ปัด 2 ตำแหน่ง (เช่น มัดจำ 30%) */
export function percentOf(amount: string, pct: string): string {
  const p = parseDec(pct, 4) ?? 0n;
  return fromCents(divRound(toCents(amount) * p, 1_000_000n));
}

/**
 * กำไรขั้นต้น % (ทศนิยม 1 ตำแหน่ง) ของยอดขายเทียบต้นทุนประมาณ — ScreenQuote.dc.html: (153,900 − 96,000) ÷ 153,900 = 37.6%
 * 'below' = ขายต่ำกว่าทุน · null = ไม่มีต้นทุน/ยอดขาย
 */
export function marginPct(amount: string | null | undefined, cost: string | null | undefined): string | null {
  if (cost === null || cost === undefined || amount === null || amount === undefined || amount === '') return null;
  const a = toCents(amount);
  const c = toCents(cost);
  if (a < c) return 'below';
  if (a <= 0n) return null;
  const t = divRound((a - c) * 1000n, a); // หน่วย 0.1%
  return `${t / 10n}.${t % 10n}`;
}

/**
 * ส่วนลดบรรทัด: "10% + 5%" (ลดซ้อน) หรือ "500" / "1,000.00" (จำนวนเงิน) → จำนวนเงินส่วนลด (2 ตำแหน่ง)
 * ScreenQuote.dc.html: 120 × 1,500.00 ลด "10% + 5%" = 180,000 × 0.90 × 0.95 = 153,900.00 → ส่วนลด 26,100.00
 * คืน null ถ้าอ่านไม่ได้ · ว่าง = "0.00"
 */
export function lineDiscount(text: string, qty: string, price: string): string | null {
  const t = text.trim();
  if (!t) return '0.00';
  if (!t.includes('%')) {
    const c = parseDec(t, 2);
    return c === null || c < 0n ? null : fromCents(c);
  }
  const gross = qtyTimesPrice(qty || '0', price || '0');
  if (gross === null) return null;
  const parts = t.split('+').map((x) => x.trim());
  let num = toCents(gross) ; // ยอดหลังหักทีละขั้น (scale ร่วม)
  let den = 1n;
  for (const part of parts) {
    const m = /^(\d+(?:\.\d+)?)\s*%$/u.exec(part);
    if (!m) return null;
    const p = parseDec(m[1], 4)!; // เปอร์เซ็นต์ × 10^4
    if (p > 1_000_000n) return null;
    num *= 1_000_000n - p;
    den *= 1_000_000n;
  }
  const net = divRound(num, den);
  return fromCents(toCents(gross) - net);
}

/** "4.0000" → "4" · "1.5000" → "1.5" · คั่นหลักพัน */
export function qtyText(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const [i = '0', f = ''] = v.split('.');
  const frac = f.replace(/0+$/u, '');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}${frac ? `.${frac}` : ''}`;
}
