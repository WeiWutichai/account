// proxy ฝั่ง client → accounting-api /console/v1 (same-origin · token จาก cookie ไม่ออกไปฝั่ง client)
import { cookies } from 'next/headers';
import { ACCOUNTING_API } from '../../../lib/console';

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const at = (await cookies()).get('inn_at')?.value;
  const url = new URL(req.url);
  const res = await fetch(`${ACCOUNTING_API}/console/v1/${path.join('/')}${url.search}`, {
    method: req.method, headers: { ...(at ? { authorization: `Bearer ${at}` } : {}), 'content-type': req.headers.get('content-type') ?? 'application/json' },
    ...(req.method === 'GET' ? {} : { body: await req.text() }),
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}
export { forward as GET, forward as POST };
