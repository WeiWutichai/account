// เรียก id-api จาก server component ด้วย cookie ของผู้ใช้ · 401 → ต่อ session (/refresh) แล้วกลับมาหน้าเดิม
import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ID_API } from './id';

export type Got<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function idGet<T>(path: string, opts: { self?: string } = {}): Promise<Got<T>> {
  const h = await headers();
  const res = await fetch(`${ID_API}${path}`, { cache: 'no-store', headers: { cookie: h.get('cookie') ?? '', 'user-agent': h.get('user-agent') ?? '' } });
  if (res.status === 401 && opts.self) redirect(`/refresh?next=${encodeURIComponent(opts.self)}`);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) return { ok: false, status: res.status, error: body.error ?? `เกิดข้อผิดพลาด (${res.status})` };
  return { ok: true, data: body };
}
