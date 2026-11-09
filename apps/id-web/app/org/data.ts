// ข้อมูลองค์กรจาก id-api (GET /v1/orgs/:id) — ใช้ร่วม ScreenOrgMembers / ScreenPlan
import 'server-only';
import { idGet, type Got } from '../lib/server';

export interface OrgOverview {
  org: { id: string; name: string; policy: { require_2fa: boolean; session_hours: number } };
  myRole: string;
  subscription: { plan: string; planName: string; status: string; renewsAt: string | null; trialEndsAt: string | null; companyLimit: number | null; seatLimit: number | null } | null;
  companies: { id: string; name_th: string }[];
  seats: { used: number; pending: number };
  members: { id: string; email: string; display_name: string; mfa_enabled: boolean; last_login_at: string | null; org_role: string; expires_at: string | null; companies: (string | null)[] }[];
  invites: { id: string; email: string; role: string; company_id: string | null; kind: 'member' | 'auditor'; org_role: string; created_at: string; expires_at: string; access_until: string | null }[];
}
interface MyOrg { id: string; name: string; org_role: string }

/** องค์กรที่จะแสดง: ?id=… หรือองค์กรแรกที่ผู้ใช้เป็นสมาชิก (ไม่ใช่ Guest) */
export async function loadOrg(id: string | null, self: string): Promise<{ me: { id: string; email: string } } & Got<OrgOverview>> {
  const me = await idGet<{ user: { id: string; email: string } }>('/v1/me', { self });
  if (!me.ok) return { me: { id: '', email: '' }, ...me };
  let orgId = id;
  if (!orgId) {
    const mine = await idGet<MyOrg[]>('/v1/orgs', { self });
    if (!mine.ok) return { me: me.data.user, ...mine };
    orgId = mine.data.find((o) => o.org_role !== 'guest')?.id ?? null;
    // TODO(Wei): แบบร่างไม่มีสถานะ "ยังไม่มีองค์กร" (ผู้สมัครใหม่ที่ยังไม่สร้างบริษัทแรก)
    if (!orgId) return { me: me.data.user, ok: false, status: 404, error: 'ยังไม่มีองค์กร — สร้างบริษัทแรกก่อน' };
  }
  const r = await idGet<OrgOverview>(`/v1/orgs/${encodeURIComponent(orgId)}`, { self });
  return { me: me.data.user, ...r };
}
