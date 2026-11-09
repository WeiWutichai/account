// เรียก accounting-api จากฝั่ง server ด้วย session ของผู้ใช้ (cookie) · 401 → ต่อ session/เข้าสู่ระบบใหม่ · 403/ไม่มีบริษัท → เลือกบริษัท
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCOUNTING_API, apiHeaders, refreshUrl } from './session';

export async function currentUrl(): Promise<string> {
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3010'}${h.get('x-invoke-path') ?? h.get('x-pathname') ?? '/'}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const jar = await cookies();
  const res = await fetch(`${ACCOUNTING_API}${path}`, { ...init, cache: 'no-store', headers: { ...apiHeaders((n) => jar.get(n)?.value), ...(init?.headers ?? {}) } });
  if (res.status === 401) redirect(refreshUrl(await currentUrl()));
  const body = (await res.json()) as T & { error?: string };
  if (res.status === 400 && /เลือกบริษัท/u.test(body.error ?? '')) redirect('/companies');
  if (res.status === 403 && /ไม่มีสิทธิ์เข้าบริษัท/u.test(body.error ?? '')) redirect('/companies');
  if (!res.ok) throw new Error(body.error ?? `API ${res.status}`);
  return body;
}

export interface Context { id: string; name: string; branch: string; period: { fiscal_year: number; period_no: number; status: string } | null }
