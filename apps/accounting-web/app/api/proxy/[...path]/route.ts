// proxy ไป accounting-api (ฝั่ง client เรียกผ่านนี้ — ใส่ context บริษัทฝั่ง server) · TODO(M3): ส่ง session แทน header dev
import { COMPANY_ID } from '../../../lib/api';

const BASE = process.env.ACCOUNTING_API_URL ?? 'http://localhost:4000';

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const headers: Record<string, string> = { 'x-company-id': COMPANY_ID, 'x-role': 'accounting_manager' };
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const res = await fetch(`${BASE}/v1/${path.join('/')}${url.search}`, {
    method: req.method, headers, ...(req.method === 'GET' ? {} : { body: Buffer.from(await req.arrayBuffer()) }),
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json',
    ...(res.headers.get('content-disposition') ? { 'content-disposition': res.headers.get('content-disposition')! } : {}) } });
}
export { forward as GET, forward as POST, forward as PUT };
