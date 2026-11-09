// แก้สิทธิ์ (PUT) / เพิกถอนการเข้าถึงบริษัทนี้ (DELETE) — ScreenUserEdit · บริษัท = cookie inn_co (ไม่รับจาก client)
import { companyId, forwardId } from '../../../../../lib/id';

async function handle(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  const { uid } = await params;
  const co = await companyId();
  if (!co) return Response.json({ error: 'กรุณาเลือกบริษัท' }, { status: 400 });
  return forwardId(req, `/v1/companies/${encodeURIComponent(co)}/users/${encodeURIComponent(uid)}`);
}
export { handle as DELETE, handle as PUT };
