// ข้อมูลจาก accounting-api /console/v1 (server) · ชนิดตาม packages/db/src/console.ts · cache() = เรียกครั้งเดียวต่อ request แม้หลายส่วนของหน้าใช้ร่วม
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { consoleApi } from './console';

export type StaffRole = 'support' | 'engineer' | 'billing' | 'ops' | 'admin';
export interface Me { userId: string; role: StaffRole }
export interface Overview {
  counts: { orgs: number; companies: number; users: number; staff: number; tickets_open: number; consent_pending: number; access_active: number; docs_month: number; dead_webhooks: number; failed_logins_24h: number };
  plans: { plan_code: string; status: string; n: number }[];
}
export interface Tenant {
  id: string; name: string; created_at: string; plan_code: string | null; status: string | null; renews_at: string | null; trial_ends_at: string | null;
  company_limit: number | null; seat_limit: number | null; companies: number; seats: number; last_active: string | null;
}
export interface Ops { schemaVersion: string | null; webhooks: Record<string, number>; emailQueue: number; deadLetters: { company_id: string; event: string; last_error: string | null; created_at: string }[] }
export interface Ticket { id: string; number: number; subject: string; status: string; updated_at: string; company_id: string | null; org_name: string; assignee_name: string | null }
export interface Flag { key: string; scope: 'global' | 'org' | 'company'; target_id: string | null; value: unknown; updated_by: string | null; updated_at: string }
export interface AuditRow { id: string; at: string; actor: string; action: string; reason: string | null; consent_ref: string | null; display_name: string | null; company: string | null }

export const getMe = cache(() => consoleApi<Me>('me'));
export const getOverview = cache(() => consoleApi<Overview>('overview'));
export const getTenants = cache(() => consoleApi<Tenant[]>('tenants'));
export const getOps = cache(() => consoleApi<Ops>('ops'));
export const getTickets = cache(() => consoleApi<Ticket[]>('tickets'));
export const getFlags = cache(() => consoleApi<Flag[]>('flags'));
export const getAudit = cache(() => consoleApi<AuditRow[]>('audit'));

/** อีเมลของผู้ใช้จาก access token (แสดงผลเท่านั้น — accounting-api ตรวจลายเซ็นจริงทุก request) */
export const getSessionEmail = cache(async (): Promise<string | null> => {
  const at = (await cookies()).get('inn_at')?.value;
  const part = at?.split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
});
