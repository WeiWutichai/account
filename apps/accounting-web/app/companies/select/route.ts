// เลือกบริษัท (ScreenCompanyPicker → การ์ดบริษัท) · ตรวจ membership ที่ id-api ก่อนตั้ง cookie inn_co
// บริษัทที่ยังตั้งค่าไม่เสร็จ → ไปขั้นที่ค้าง (ขั้น 3 = ยอดยกมา)
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE, ID_API, loginUrl } from '../../lib/session';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const jar = await cookies();
  const at = jar.get(COOKIE.access)?.value;
  if (!at) return NextResponse.redirect(loginUrl(url.href));
  const res = await fetch(`${ID_API}/v1/companies`, { headers: { authorization: `Bearer ${at}` }, cache: 'no-store' });
  if (!res.ok) return NextResponse.redirect(loginUrl(url.href));
  const list = (await res.json()) as { id: string; setup_done: boolean; setup_step: number }[];
  const c = list.find((x) => x.id === id);
  if (!c) return NextResponse.redirect(new URL('/companies', req.url));
  const next = !c.setup_done && c.setup_step === 3 ? '/setup/opening-balance' : (url.searchParams.get('next') ?? '/');
  const r = NextResponse.redirect(new URL(next, req.url));
  r.cookies.set(COOKIE.company, id, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 400 * 86_400 });
  return r;
}
