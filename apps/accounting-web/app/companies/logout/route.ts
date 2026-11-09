// ออกจากระบบ (ScreenCompanyPicker → "ออกจากระบบ") · POST จากฟอร์มบนหน้า (same-origin)
// เพิกถอน refresh token ที่ id-api แล้วล้าง cookie ของ session + บริษัทที่เลือก → หน้าเข้าสู่ระบบ (id-web)
// cookie inn_at/inn_rt ใช้ร่วมกันทั้ง host (dev: localhost) หรือ cookieDomain (production) — ส่ง Set-Cookie ของ id-api กลับไปตรงๆ
// TODO(id-web): ถ้า id-web มีหน้า/route ออกจากระบบของตัวเอง ให้ย้ายมาชี้ที่นั่นแทน
import { href } from '@innovera/ui';
import { cookies } from 'next/headers';
import { COOKIE, ID_API } from '../../lib/session';

export async function POST() {
  const jar = await cookies();
  const cookie = [COOKIE.access, COOKIE.refresh].map((n) => { const v = jar.get(n)?.value; return v ? `${n}=${v}` : null; }).filter(Boolean).join('; ');
  const out = new Headers({ location: href('login') });
  try {
    const res = await fetch(`${ID_API}/v1/auth/logout`, { method: 'POST', headers: cookie ? { cookie } : {}, cache: 'no-store' });
    for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  } catch {
    // id-api ไม่ตอบ — ยังล้าง cookie ฝั่งนี้ให้ (refresh token จะหมดอายุเอง)
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  for (const n of [COOKIE.access, COOKIE.refresh, COOKIE.company]) out.append('set-cookie', `${n}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  return new Response(null, { status: 303, headers: out });
}
