// เรียก id-api (Innovera ID) จากฝั่ง server ด้วย access token ใน cookie inn_at · token ไม่ออกไปฝั่ง client
// ใช้ใน server component (idApi) และ route handler ที่ forward คำขอจาก client (forwardId)
import 'server-only';
import { cookies } from 'next/headers';
import { thaiDate } from '@innovera/ui';
import { redirect } from 'next/navigation';
import { currentUrl } from './api';
import { COOKIE, DEV_COMPANY_ID, DEV_HEADERS, ID_API, refreshUrl } from './session';

async function bearer(): Promise<Record<string, string>> {
  const at = (await cookies()).get(COOKIE.access)?.value;
  return at ? { authorization: `Bearer ${at}` } : {};
}

/** server component: GET/… id-api · 401 → ต่อ session ที่ id-web */
export async function idApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ID_API}${path}`, { ...init, cache: 'no-store', headers: { ...(await bearer()), ...(init?.headers ?? {}) } });
  if (res.status === 401) redirect(refreshUrl(await currentUrl()));
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new IdApiError(res.status, body.error ?? `ID API ${res.status}`);
  return body;
}
export class IdApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** route handler: ส่งคำขอของ client ต่อไป id-api (same-origin → bearer จาก cookie) แล้วคืนผลตามเดิม */
export async function forwardId(req: Request, path: string): Promise<Response> {
  const headers: Record<string, string> = await bearer();
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const res = await fetch(`${ID_API}${path}`, { method: req.method, headers, cache: 'no-store', ...(req.method === 'GET' || req.method === 'DELETE' ? {} : { body: await req.text() }) });
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}

/** route handler: ส่ง JSON ที่ประกอบฝั่ง server ไป id-api */
export async function forwardJson(method: string, path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${ID_API}${path}`, { method, cache: 'no-store', headers: { ...(await bearer()), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}

/** บริษัทที่เลือกอยู่ (cookie inn_co · dev header mode ใช้บริษัท dev) */
export async function companyId(): Promise<string | null> {
  return (await cookies()).get(COOKIE.company)?.value ?? (DEV_HEADERS ? DEV_COMPANY_ID : null);
}

export interface Me { user: { id: string; email: string; display_name: string; mfa_enabled: boolean }; companies: CompanyItem[] }
export interface CompanyItem {
  id: string; name_th: string; branch_code: string; fiscal_year_start: string; setup_step: number; setup_done: boolean; created_at: string; status: string;
  org_id: string; org_name: string; company_role: string; expires_at: string | null; last_used_at: string | null;
  plan_code: string | null; company_limit: number | null; seat_limit: number | null; org_role: string | null;
}

/** "wei@innovera.co.th" → "wei@innovera…" (แบบเดียวกับ id-api maskEmail · แบบร่างแสดงอีเมลแบบย่อ) */
export const maskEmail = (e: string): string => { const [u, d = ''] = e.split('@'); return `${u}@${d.split('.')[0]}…`; };
/** timestamp → วันที่ตามเวลาไทย DD/MM/YYYY (พ.ศ.) */
const BKK_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
export const bkkDay = (d: Date): string => BKK_DAY.format(d);
export const bkkThaiDate = (iso: string): string => thaiDate(bkkDay(new Date(iso)));
/** รหัสแผน → ชื่อแผนตามแบบร่าง ("แผน Business") */
export const planLabel = (code: string | null): string => (code ? code.charAt(0).toUpperCase() + code.slice(1) : '');
