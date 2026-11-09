// รูปแบบตัวเลข (CLAUDE.md · design-system README): ทศนิยม 2 ตำแหน่ง คอมมาคั่นหลักพัน · ค่าลบในงบใช้วงเล็บ · ช่องศูนย์ใน Dr/Cr เว้นว่าง
export function money(v: string | null | undefined, opts: { paren?: boolean; blankZero?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '';
  const neg = v.startsWith('-');
  const [i = '0', f = '00'] = (neg ? v.slice(1) : v).split('.');
  if (opts.blankZero && /^0+$/u.test(i) && /^0*$/u.test(f)) return '';
  const body = `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${(f + '00').slice(0, 2)}`;
  if (!neg) return body;
  return opts.paren ? `(${body})` : `−${body}`;
}

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM-DD' (ค.ศ.) → 'DD/MM/YYYY' (พ.ศ.) */
export function thaiDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${Number(y) + 543}`;
}
/** 'YYYY-MM-DD' → 'DD/MM' */
export const shortDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** 'DD/MM/YYYY' (พ.ศ.) → 'YYYY-MM-DD' (ค.ศ.) · คืน null ถ้ารูปแบบผิด */
export function parseThaiDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(s.trim());
  if (!m) return null;
  return `${Number(m[3]) - 543}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}
export const thaiMonth = (m: number): string => TH_MONTH[m - 1] ?? '';
