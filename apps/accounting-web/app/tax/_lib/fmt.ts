// ตัวช่วยแสดงผลของหน้าภาษี/แบบพิมพ์รายเดือน — ใช้ได้ทั้ง server และ client (ไม่มี server-only)
// ---------- เดือนภาษี ----------
export const YM = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const parts = (ym: string): [number, number] => [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
/** '2026-11' → 'พ.ย. 2569' */
export const monthShort = (ym: string): string => { const [y, m] = parts(ym); return `${TH_SHORT[m - 1]} ${y + 543}`; };
/** '2026-11' → 'พ.ย.' */
export const monthAbbr = (ym: string): string => TH_SHORT[parts(ym)[1] - 1] ?? '';
/** '2026-11' → 'พฤศจิกายน ปี 2569' */
export const monthFull = (ym: string): string => { const [y, m] = parts(ym); return `${TH_FULL[m - 1]} ปี ${y + 543}`; };
export function shiftMonth(ym: string, by: number): string {
  const [y, m] = parts(ym);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** ชื่อไฟล์ RD Prep ตาม accounting-api (PND3_2569_11.txt) */
export const rdPrepName = (ym: string, form: '3' | '53'): string => `PND${form}_${parts(ym)[0] + 543}_${ym.slice(5, 7)}.txt`;
export const rdPrepUrl = (ym: string, form: '3' | '53'): string => `/api/proxy/tax/pnd/rdprep?month=${ym}&form=${form}`;

/**
 * กำหนดยื่นแบบของเดือนภาษี (วันที่ในเดือนถัดไป)
 * CLAUDE.md "รอผู้สอบบัญชี": ขยายกำหนดยื่นออนไลน์ (ภ.ง.ด. วันที่ 15 · ภ.พ.30 วันที่ 23) — config `tax.filing.online_extension` ค่าตั้งต้น true
 * TODO(backend): ยังไม่มี GET company-settings/tax.filing.online_extension → ใช้ค่าตั้งต้น true เสมอ (ป้าย "รอยืนยัน" บนหน้าจอ)
 */
export interface Deadlines { online: boolean; pnd: string; pp30: string; sso: string }
export function deadlines(ym: string, online = true): Deadlines {
  const next = monthAbbr(shiftMonth(ym, 1));
  return { online, pnd: `${online ? 15 : 7} ${next}`, pp30: `${online ? 23 : 15} ${next}`, sso: `15 ${next}` };
}

// ---------- ตัวเลข (สตางค์ BigInt) ----------
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
/** อัตรา NUMERIC(7,4) '0.0300' → '3' */
export function ratePct(rate: string): string {
  const [i = '0', f = ''] = rate.split('.');
  const bp = BigInt(i || '0') * 10000n + BigInt((f + '0000').slice(0, 4));
  const frac = (bp % 100n).toString().padStart(2, '0').replace(/0+$/u, '');
  return frac ? `${bp / 100n}.${frac}` : `${bp / 100n}`;
}
/** สถานประกอบการของคู่ค้า: 00000/ไม่ระบุ = สนญ. · อื่นๆ = สาขา xxxxx
 * TODO(backend): contact.branch_code ว่างในข้อมูล dev — ถือเป็นสำนักงานใหญ่ตามแบบร่าง (PrintVatSales.dc.html) */
export const branchShort = (b: string | null | undefined): string => (!b || b === '00000' ? 'สนญ.' : `สาขา ${b}`);
