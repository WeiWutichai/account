// ตรวจ session ก่อนเข้าแต่ละหน้า (optimistic — accounting-api ตรวจจริงทุก request)
// ไม่มี access แต่มี refresh → ต่อ session ที่ id-web · ไม่มีทั้งคู่ → เข้าสู่ระบบ · ยังไม่เลือกบริษัท → /companies
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, DEV_HEADERS, loginUrl, refreshUrl } from './app/lib/session';

export function proxy(req: NextRequest) {
  if (DEV_HEADERS) return NextResponse.next();
  const url = req.nextUrl.href;
  if (!req.cookies.get(COOKIE.access)) {
    return NextResponse.redirect(req.cookies.get(COOKIE.refresh) ? refreshUrl(url) : loginUrl(url));
  }
  if (!req.cookies.get(COOKIE.company) && !req.nextUrl.pathname.startsWith('/companies')) return NextResponse.redirect(new URL('/companies', req.url));
  const h = new Headers(req.headers);
  h.set('x-pathname', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.next({ request: { headers: h } });
}

export const config = { matcher: ['/((?!api/|_next/|favicon.ico).*)'] };
