// M7 hub — ชนิดข้อมูล/ป้าย/สไตล์ที่ใช้ร่วมกันของ ScreenApps · ScreenMcp · ScreenAudit · ScreenRevoke (ใช้ได้ทั้ง server และ client)
// ที่มา: accounting-api /v1 (apps/accounting-api/src/hub.controller.ts · packages/db/src/hub.ts)
import { thaiDate } from '@innovera/ui';
import { bangkok, whenText } from '../../../sales/_lib/doc.ts';

export interface ApiClient {
  id: string; name: string; kind: 'tms' | 'mcp' | 'custom'; key_prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null;
  created_by: string | null; created_by_name: string | null; revoked_by_name: string | null; revoke_reason: string | null;
  status: 'active' | 'suspended'; suspended_until: string | null; calls_7d: number; denied_7d: number; drafts_pending: number;
}
/** GET /v1/api-clients/activity · /v1/api-clients/:id/activity */
export interface ApiActivity {
  recent: { id: string; client_id: string; client_name: string | null; at: string; kind: 'api' | 'mcp'; tool: string; status: 'ok' | 'denied' | 'error'; detail: string | null;
    document_id: string | null; doc_no: string | null; doc_type: string | null; doc_status: string | null; grand_total: string | null }[];
  drafts: { id: string; doc_type: string; doc_no: string | null; status: string; grand_total: string; issue_date: string; created_by_client: string }[];
  contacts: number;
  last24h: { tool: string; status: 'ok' | 'denied' | 'error'; n: number }[];
}
export interface WebhookEndpoint { id: string; url: string; events: string[]; active: boolean; api_client_id: string | null; created_at: string }
export interface WebhookDelivery { id: string; endpoint_id: string; event: string; status: 'pending' | 'sent' | 'dead'; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; next_attempt_at: string | null }
export interface Webhooks { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[] }
export interface AuditRow {
  id: string; at: string; actor_id: string | null; actor_name: string | null; action: string; entity: string; entity_id: string; before: unknown; after: unknown; hash: string | null; prev_hash: string | null;
  channel: 'web' | 'api' | 'mcp' | 'system' | null; ip: string | null; api_client_id: string | null; client_name: string | null; client_kind: string | null; doc_no: string | null; journal_no: string | null;
}
/** GET /v1/audit (แบ่งหน้าฝั่ง server) */
export interface AuditPage { rows: AuditRow[]; count: number; limit: number; offset: number; actors: { id: string; name: string }[] }
export interface AuditVerify { ok: boolean; rows: number; brokenAt: string | null }

/** scope ที่ออกให้ได้ (packages/db/src/hub.ts API_SCOPES — CHECK ใน DB) · ไม่มี post/pay/periods/users/settings */
export const ALLOWED_SCOPES = ['documents:read', 'documents:draft', 'contacts:read', 'contacts:draft', 'ledger:read', 'reports:read', 'tax:read', 'schema:read', 'webhooks:manage'] as const;
export const WEBHOOK_EVENTS = ['document.posted', 'document.voided', 'payment.received', 'payment.paid', 'period.closed'] as const;

/** ชนิดของ client — ป้ายจากแบบร่าง (ScreenMcp "MCP client" · ScreenApps "API key") · TODO(Wei): ป้าย "TMS" ไม่มีในแบบร่าง (ScreenApps.dc.html แสดง TMS เป็นการ์ดแยก) */
export const KIND_LABEL: Record<ApiClient['kind'], string> = { mcp: 'MCP client', custom: 'API key', tms: 'TMS' };

/** "วันนี้ 10:12" · "เมื่อวาน 22:40" · ไม่งั้น "03/11/2569" (ScreenMcp.dc.html คอลัมน์ ใช้ล่าสุด) */
export function lastUsed(ts: string | null, today: string): string {
  if (!ts) return '—';
  const w = whenText(ts, today);
  return w.startsWith('วันนี้') || w.startsWith('เมื่อวาน') ? w : thaiDate(bangkok(ts).date);
}
export const bkkDate = (ts: string): string => thaiDate(bangkok(ts).date);

export const BTN = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer';
export const BTN32 = `${BTN}; height: 32px; padding: 0 12px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d`;
export const BTN32P = `${BTN}; height: 32px; padding: 0 12px; background: #0f62fe; color: #ffffff; border: 1px solid #0f62fe`;
export const BTN_OFF = 'background: #e0e0e0; color: #6f6f6f; border: 1px solid #e0e0e0; cursor: not-allowed';
export const TAG = 'display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; font-size: 13px; font-weight: 500; white-space: nowrap';
export const TAG_TONE = { success: 'background: #defbe6; color: #0e6027', warning: 'background: #fcf4d6; color: #684e00', error: 'background: #fff1f1; color: #a2191f', neutral: 'background: #e0e0e0; color: #161616', info: 'background: #edf5ff; color: #0043ce' } as const;
export const DOT = 'width: 8px; height: 8px; border-radius: 999px; background: currentColor';
export const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';
export const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
export const LINK_BTN = 'text-decoration: none; color: #0f62fe; background: none; border: 0; padding: 0; font: inherit; cursor: pointer';
export const SR_ONLY = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
/** fetch ฝั่ง client ผ่าน /api/proxy (รองรับ DELETE — sales/_lib/client.ts มีแค่ GET/POST/PUT) หรือ route handler อื่นใน accounting-web */
export async function send<T>(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string | string[] };
    if (!res.ok) return { ok: false, error: j.error ?? (Array.isArray(j.message) ? j.message.join(', ') : j.message) ?? `ผิดพลาด (${res.status})` };
    return { ok: true, data: j };
  } catch {
    return { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' };
  }
}
