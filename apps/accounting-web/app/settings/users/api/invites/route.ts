// เชิญผู้ใช้/ผู้สอบบัญชี (ScreenUsers) → id-api POST /v1/invites · companyId บังคับเป็นบริษัทที่เลือกอยู่ (cookie inn_co)
import { companyId, forwardJson } from '../../../../lib/id';

export async function POST(req: Request): Promise<Response> {
  const co = await companyId();
  if (!co) return Response.json({ error: 'กรุณาเลือกบริษัท' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return forwardJson('POST', '/v1/invites', { ...body, companyId: co });
}
