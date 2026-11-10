// ต่อ session: ใช้ refresh token (cookie inn_rt) ขอ access ใหม่แล้วกลับไปหน้าเดิม · ไม่สำเร็จ → หน้าเข้าสู่ระบบ
import { NextResponse } from 'next/server';
import { ID_API, safeNext } from '../lib/id';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const res = await fetch(`${ID_API}/v1/auth/refresh`, {
    method: 'POST', headers: { cookie: req.headers.get('cookie') ?? '', 'user-agent': req.headers.get('user-agent') ?? '', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '127.0.0.1' },
  });
  // next อาจเป็น path ภายใน id-web (เช่น /me) → ทำเป็น URL เต็มก่อน redirect
  // production อยู่หลัง reverse proxy → req.url เป็นที่อยู่ภายใน · ใช้ PUBLIC_WEB_URL (https://id.<DOMAIN>) เป็นฐาน
  const base = process.env.PUBLIC_WEB_URL || req.url;
  const target = res.ok ? new URL(next, base).href : new URL(`/login?next=${encodeURIComponent(next)}`, base).href;
  const r = NextResponse.redirect(target);
  for (const c of res.headers.getSetCookie()) r.headers.append('set-cookie', c);
  return r;
}
