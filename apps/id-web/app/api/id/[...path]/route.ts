// proxy ไป id-api (same-origin) · ส่ง cookie ไป–กลับ (Set-Cookie) · ส่ง IP จริงผ่าน x-forwarded-for (id-api trust proxy 1 ชั้น)
import { ID_API } from '../../../lib/id';

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const headers = new Headers();
  for (const k of ['content-type', 'cookie', 'user-agent']) { const v = req.headers.get(k); if (v) headers.set(k, v); }
  headers.set('x-forwarded-for', req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1');
  const res = await fetch(`${ID_API}/${path.join('/')}${url.search}`, {
    method: req.method, headers, redirect: 'manual', ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: await req.text() }),
  });
  const out = new Headers();
  out.set('content-type', res.headers.get('content-type') ?? 'application/json');
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: out });
}
export { forward as DELETE, forward as GET, forward as POST, forward as PUT };
