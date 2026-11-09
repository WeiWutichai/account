// สร้างบริษัท (ScreenCompanyCreate) — client POST มาที่นี่ (same-origin) → id-api POST /v1/companies พร้อม bearer จาก cookie
import { forwardId } from '../../../lib/id';

export const POST = (req: Request): Promise<Response> => forwardId(req, '/v1/companies');
