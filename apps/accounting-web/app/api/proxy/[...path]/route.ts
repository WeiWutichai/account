// proxy ไป accounting-api สำหรับ fetch ฝั่ง client (same-origin) · ส่ง session/บริษัทจาก cookie
import { cookies } from 'next/headers';
import { ACCOUNTING_API, apiHeaders } from '../../../lib/session';

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const jar = await cookies();
  const headers: Record<string, string> = apiHeaders((n) => jar.get(n)?.value);
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const res = await fetch(`${ACCOUNTING_API}/v1/${path.join('/')}${url.search}`, {
    method: req.method, headers, ...(req.method === 'GET' ? {} : { body: Buffer.from(await req.arrayBuffer()) }),
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json',
    ...(res.headers.get('content-disposition') ? { 'content-disposition': res.headers.get('content-disposition')! } : {}) } });
}
export { forward as DELETE, forward as GET, forward as POST, forward as PUT };
