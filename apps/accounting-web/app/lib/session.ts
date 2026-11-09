// session ของ Innovera ID ฝั่ง accounting-web: cookie inn_at (access JWT, ตั้งโดย id-web) + inn_co (บริษัทที่เลือก · FR-TN-04)
// dev: AUTH_DEV_HEADERS=1 → ใช้ header x-company-id/x-role แทน (ห้ามใน production · accounting-api ตรวจซ้ำ)
export const ID_WEB = process.env.ID_WEB_URL ?? 'http://localhost:3100';
export const ID_API = process.env.ID_API_URL ?? 'http://localhost:4100';
export const ACCOUNTING_API = process.env.ACCOUNTING_API_URL ?? 'http://localhost:4000';
export const DEV_HEADERS = process.env.AUTH_DEV_HEADERS === '1' && process.env.NODE_ENV !== 'production';
export const DEV_COMPANY_ID = process.env.DEV_COMPANY_ID ?? '00000000-0000-4000-8000-000000000001';
export const COOKIE = { access: 'inn_at', refresh: 'inn_rt', company: 'inn_co' } as const;

/** header ที่ส่งไป accounting-api จาก cookie ของผู้ใช้ */
export function apiHeaders(get: (name: string) => string | undefined): Record<string, string> {
  if (DEV_HEADERS) return { 'x-company-id': get(COOKIE.company) ?? DEV_COMPANY_ID, 'x-role': 'accounting_manager' };
  const h: Record<string, string> = {};
  const at = get(COOKIE.access);
  if (at) h.authorization = `Bearer ${at}`;
  const co = get(COOKIE.company);
  if (co) h['x-company-id'] = co;
  return h;
}
export const loginUrl = (next: string): string => `${ID_WEB}/login?next=${encodeURIComponent(next)}`;
export const refreshUrl = (next: string): string => `${ID_WEB}/refresh?next=${encodeURIComponent(next)}`;
