// เรียก accounting-api จากฝั่ง server · M2: ส่งบริษัทผ่าน header (dev) — TODO(M3): ใช้ session ของ Innovera ID
import 'server-only';

const BASE = process.env.ACCOUNTING_API_URL ?? 'http://localhost:4000';
export const COMPANY_ID = process.env.DEV_COMPANY_ID ?? '00000000-0000-4000-8000-000000000001';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, cache: 'no-store', headers: { 'x-company-id': COMPANY_ID, 'x-role': 'accounting_manager', ...(init?.headers ?? {}) } });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `API ${res.status}`);
  return body;
}

export interface Context { id: string; name: string; branch: string; period: { fiscal_year: number; period_no: number; status: string } | null }
