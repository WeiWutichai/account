// ยกเลิกคำเชิญที่ค้างอยู่ (ScreenUsers แท็บ "คำเชิญค้างอยู่") → id-api DELETE /v1/invites/:id
import { forwardId } from '../../../../../lib/id';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return forwardId(req, `/v1/invites/${encodeURIComponent((await params).id)}`);
}
