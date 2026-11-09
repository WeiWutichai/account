// รูปแบบวันเวลาของ Console (เวลาไทย) — ตามรูปแบบในแบบร่าง Console*.dc.html: "30/11 10:12", "10 นาทีก่อน", "1 ชม.", "เมื่อวาน", "วันนี้", "3 วันก่อน"
const TZ = 'Asia/Bangkok';
const parts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: p.month ?? '', d: p.day ?? '', hh: p.hour ?? '', mm: p.minute ?? '', wd: p.weekday ?? '' };
};
const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v.includes('T') || v.includes(' ') ? v.replace(' ', 'T').replace(/\+00$/u, 'Z') : `${v}T00:00:00+07:00`));
const dayKey = (d: Date) => { const p = parts(d); return `${p.y}-${p.m}-${p.d}`; };
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_WD: Record<string, string> = { Sun: 'อาทิตย์', Mon: 'จันทร์', Tue: 'อังคาร', Wed: 'พุธ', Thu: 'พฤหัสบดี', Fri: 'ศุกร์', Sat: 'เสาร์' };

/** "30/11" */
export const ddmm = (v: string | Date): string => { const p = parts(toDate(v)); return `${p.d}/${p.m}`; };
/** "30/11 10:12" */
export const ddmmhm = (v: string | Date): string => { const p = parts(toDate(v)); return `${p.d}/${p.m} ${p.hh}:${p.mm}`; };
/** "02/2569" (เดือน/ปี พ.ศ.) */
export const monthYear = (v: string | Date): string => { const p = parts(toDate(v)); return `${p.m}/${p.y + 543}`; };
/** "วันจันทร์ 30 พ.ย. 2569" */
export const longThaiDate = (v: Date): string => { const p = parts(v); return `วัน${TH_WD[p.wd] ?? ''} ${Number(p.d)} ${TH_MONTH[Number(p.m) - 1] ?? ''} ${p.y + 543}`; };
/** 'YYYY-MM' ของวันนี้ตามเวลาไทย */
export const thisMonth = (now = new Date()): string => { const p = parts(now); return `${p.y}-${p.m}`; };
export const thisYear = (now = new Date()): number => parts(now).y;
export const monthOf = (v: string | Date): string => { const p = parts(toDate(v)); return `${p.y}-${p.m}`; };

/** ทิกเก็ต (ConsoleSupport "อัปเดต"): "10 นาทีก่อน" · "1 ชม." · "เมื่อวาน" · "30/11" */
export function ago(v: string | Date, now = new Date()): string {
  const d = toDate(v);
  const min = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60_000));
  if (min < 60) return `${min} นาทีก่อน`;
  if (dayKey(d) === dayKey(now)) return `${Math.floor(min / 60)} ชม.`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return 'เมื่อวาน';
  return ddmm(d);
}
/** องค์กร (ConsoleTenants "ใช้ล่าสุด"): "วันนี้" · "3 วันก่อน" · "29/11" */
export function lastActive(v: string | null, now = new Date()): string {
  if (!v) return '—';
  const d = toDate(v);
  if (dayKey(d) === dayKey(now)) return 'วันนี้';
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return days >= 1 && days < 7 ? `${days} วันก่อน` : ddmm(d);
}
/** จำนวนเต็มคั่นหลักพัน (ตัวนับ ไม่ใช่ยอดเงิน) */
export const count = (n: number): string => n.toLocaleString('en-US');
/** ส่วนแรกของ id ยาว ตามรูป "org_01hv9…" ในแบบร่าง */
export const shortId = (id: string): string => `${id.slice(0, 8)}…`;
