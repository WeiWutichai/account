// รูปแบบวันที่/อีเมลของหน้า Innovera ID (ใช้ได้ทั้ง server และ client) · เวลาแสดงตามเขต Asia/Bangkok · ปี พ.ศ.

const PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function bkk(v: string | Date): { y: number; m: string; d: string; hh: string; mm: string; day: string } {
  const p = Object.fromEntries(PARTS.formatToParts(typeof v === 'string' ? new Date(v) : v).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: p.month ?? '', d: p.day ?? '', hh: p.hour ?? '', mm: p.minute ?? '', day: `${p.year}-${p.month}-${p.day}` };
}

/** วันเวลา → 'DD/MM/YYYY' (พ.ศ.) · รับ 'YYYY-MM-DD' ได้ด้วย */
export function dmy(v: string | Date): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${Number(v.slice(0, 4)) + 543}`;
  const b = bkk(v);
  return `${b.d}/${b.m}/${b.y + 543}`;
}
/** → 'DD/MM' */
export const dm = (v: string | Date): string => dmy(v).slice(0, 5);
/** → 'MM/YYYY' (พ.ศ.) — "Innovera ID ตั้งแต่ 02/2569" */
export const my = (v: string | Date): string => dmy(v).slice(3);

/** ใช้ล่าสุด: 'วันนี้ 08:10' · 'เมื่อวาน 17:42' (หรือ 'เมื่อวาน' เมื่อ withTime=false) · ก่อนนั้น 'DD/MM/YYYY' */
export function lastUsed(v: string | Date | null, now: Date, withTime = true): string {
  if (!v) return '—';
  const b = bkk(v);
  const today = bkk(now).day;
  const yesterday = bkk(new Date(now.getTime() - 86_400_000)).day;
  if (b.day === today) return `วันนี้ ${b.hh}:${b.mm}`;
  if (b.day === yesterday) return withTime ? `เมื่อวาน ${b.hh}:${b.mm}` : 'เมื่อวาน';
  return dmy(v);
}

/** จำนวนวันที่เหลือ (ปัดขึ้น) */
export const daysLeft = (v: string | Date, now: Date): number => Math.max(0, Math.ceil((new Date(v).getTime() - now.getTime()) / 86_400_000));

/** "wei@innovera.co.th" → "wei@innovera…" (แบบร่าง ScreenTwoFactor/ScreenProfile) */
export const maskEmail = (e: string): string => { const [u, d = ''] = e.split('@'); return `${u}@${d.split('.')[0]}…`; };
/** "acct2@company.co.th" → "acct2@…" (แบบร่าง ScreenPasswordReset/ScreenOrgMembers) */
export const maskLocal = (e: string): string => `${e.split('@')[0]}@…`;

/** user agent → "Mac · Chrome" (แบบร่าง ScreenProfile คอลัมน์ "อุปกรณ์") */
export function deviceLabel(ua: string | null): string {
  if (!ua) return '—';
  const os = /iPhone/u.test(ua) ? 'iPhone' : /iPad/u.test(ua) ? 'iPad' : /Android/u.test(ua) ? 'Android' : /Mac OS X|Macintosh/u.test(ua) ? 'Mac' : /Windows/u.test(ua) ? 'Windows' : /Linux/u.test(ua) ? 'Linux' : null;
  const br = /Edg\//u.test(ua) ? 'Edge' : /OPR\//u.test(ua) ? 'Opera' : /Firefox\//u.test(ua) ? 'Firefox' : /Chrome\//u.test(ua) ? 'Chrome' : /Safari\//u.test(ua) ? 'Safari' : null;
  if (!os && !br) return ua.slice(0, 40);
  return [os, br].filter(Boolean).join(' · ');
}
