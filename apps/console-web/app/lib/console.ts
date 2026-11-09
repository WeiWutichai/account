// Console (admin.*) เรียก accounting-api /console/v1 ด้วย session ของ Innovera ID (cookie inn_at · ต้องผ่าน 2FA · เฉพาะทีม Innovera)
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const ACCOUNTING_API = process.env.ACCOUNTING_API_URL ?? 'http://localhost:4000';
export const ID_WEB = process.env.ID_WEB_URL ?? 'http://localhost:3100';
export const CONSOLE_ORIGIN = process.env.CONSOLE_WEB_URL ?? 'http://localhost:3200';

export async function consoleApi<T>(path: string): Promise<T> {
  const at = (await cookies()).get('inn_at')?.value;
  if (!at) redirect(`${ID_WEB}/login?next=${encodeURIComponent(`${CONSOLE_ORIGIN}/`)}`);
  const res = await fetch(`${ACCOUNTING_API}/console/v1/${path}`, { headers: { authorization: `Bearer ${at}` }, cache: 'no-store' });
  if (res.status === 401) redirect(`${ID_WEB}/refresh?next=${encodeURIComponent(`${CONSOLE_ORIGIN}/`)}`);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Console API ${res.status}`);
  return body;
}
