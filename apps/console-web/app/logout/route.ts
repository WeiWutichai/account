// ออกจากระบบ (ConsoleNav → ไอคอน "ออกจากระบบ") · POST จากฟอร์มในเมนู (same-origin)
// เพิกถอน refresh token ที่ id-api แล้วล้าง cookie session → หน้าเข้าสู่ระบบ (id-web) · แบบเดียวกับ accounting-web/app/companies/logout
import { cookies } from 'next/headers';
import { ID_WEB } from '../lib/console';

const ID_API = process.env.ID_API_URL ?? 'http://localhost:4100';

export async function POST() {
  const jar = await cookies();
  const cookie = ['inn_at', 'inn_rt'].map((n) => { const v = jar.get(n)?.value; return v ? `${n}=${v}` : null; }).filter(Boolean).join('; ');
  const out = new Headers({ location: `${ID_WEB}/login` });
  try {
    const res = await fetch(`${ID_API}/v1/auth/logout`, { method: 'POST', headers: cookie ? { cookie } : {}, cache: 'no-store' });
    for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  } catch {
    // id-api ไม่ตอบ — ยังล้าง cookie ฝั่งนี้ให้
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  for (const n of ['inn_at', 'inn_rt']) out.append('set-cookie', `${n}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  return new Response(null, { status: 303, headers: out });
}
