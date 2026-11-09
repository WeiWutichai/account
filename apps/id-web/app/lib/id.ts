// ค่าที่ id-web ใช้ร่วม · เรียก id-api ผ่าน /api/id (same-origin → cookie ของ id-api ตั้งบนโดเมนนี้)
export const ID_API = process.env.ID_API_URL ?? 'http://localhost:4100';
export const ACCOUNTING_WEB = process.env.ACCOUNTING_WEB_URL ?? 'http://localhost:3010';
/** ปลายทางหลังเข้าสู่ระบบที่อนุญาต (กัน open redirect) */
const ALLOWED = (process.env.ID_REDIRECT_ORIGINS ?? 'http://localhost:3010,http://localhost:3100,http://localhost:3200').split(',');
export function safeNext(next: string | null | undefined, fallback = `${ACCOUNTING_WEB}/companies`): string {
  if (!next) return fallback;
  try {
    const u = new URL(next);
    return ALLOWED.includes(u.origin) ? u.href : fallback;
  } catch {
    return next.startsWith('/') && !next.startsWith('//') ? next : fallback;
  }
}
