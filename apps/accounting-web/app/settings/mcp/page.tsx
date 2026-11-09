// G6 การเชื่อมต่อ MCP / OAuth client — design/project/ScreenMcp.dc.html (Sidebar active="mcp")
// ข้อมูล: GET /v1/api-clients (ทุกชนิด · ผู้อนุญาต/ผู้เพิกถอน/สถิติ 7 วัน) · GET /v1/api-clients/activity ("ล่าสุดจาก client") · v1 ใช้ API key ต่อบริษัท แทน OAuth 2.1 + PKCE — TODO(Wei) T14
import { css, money, thaiDate } from '@innovera/ui';
import { ACCOUNTING_API } from '../../lib/session';
import { Shell } from '../../lib/shell';
import { bangkok, whenText } from '../../sales/_lib/doc.ts';
import { appToday } from '../../sales/_lib/server';
import { type ApiActivity, type ApiClient, bkkDate, KIND_LABEL, lastUsed } from '../apps/_shared/hub.ts';
import { load } from '../apps/_shared/server.ts';
import { McpView, type McpCall, type McpRow } from './view';

/** "10:12" (วันนี้) · "เมื่อวาน" · "03/11/2569" (ScreenMcp "ล่าสุดจาก client") */
function callTime(ts: string, today: string): string {
  const w = whenText(ts, today);
  if (w.startsWith('วันนี้')) return w.slice(7);
  if (w.startsWith('เมื่อวาน')) return 'เมื่อวาน';
  return thaiDate(bangkok(ts).date);
}

export default async function McpPage() {
  const today = appToday();
  const [clients, activity] = await Promise.all([load<ApiClient[]>('/v1/api-clients'), load<ApiActivity>('/v1/api-clients/activity')]);
  const cs = clients.ok ? clients.data : [];
  const rows: McpRow[] = cs.map((c) => ({
    id: c.id, name: c.name, clientId: `${c.key_prefix}…`, kind: KIND_LABEL[c.kind], scopes: c.scopes, lastUsed: lastUsed(c.last_used_at, today),
    authorizedBy: c.created_by_name ?? '—', suspended: c.status === 'suspended',
    revoked: c.revoked_at ? `เพิกถอน ${bkkDate(c.revoked_at)}${c.revoked_by_name ? ` โดย ${c.revoked_by_name}` : ''}${c.revoke_reason ? ` · เหตุผล: ${c.revoke_reason}` : ''}` : null,
  }));
  const calls: McpCall[] = (activity.ok ? activity.data.recent : []).slice(0, 4).map((r) => {
    const doc = r.document_id && r.tool === 'create_draft_document' && r.doc_type ? ` → ${r.doc_no ?? r.doc_type} (ร่าง)${r.grand_total && Number(r.grand_total) ? ` ${money(r.grand_total)}` : ''}` : '';
    return {
      id: r.id, when: callTime(r.at, today), text: `${r.client_name ?? '—'} · ${r.tool}${doc}`,
      status: r.status === 'denied' ? 'denied' : r.status === 'error' ? 'error' : r.doc_status === 'draft' && r.tool === 'create_draft_document' ? 'review' : 'ok',
    };
  });
  const live = cs.filter((c) => !c.revoked_at);
  const stats = { calls: live.reduce((s, c) => s + c.calls_7d, 0), denied: live.reduce((s, c) => s + c.denied_7d, 0), drafts: activity.ok ? activity.data.drafts.length : null };
  // TODO(Wei): แบบร่างแสดงโดเมน https://mcp.[product].innovera.co.th/<บริษัท> — ตอนนี้ใช้ origin ของ accounting-api (ตั้ง ACCOUNTING_API_URL ใน production) · คีย์ผูกบริษัทอยู่แล้วจึงไม่มี id บริษัทใน URL
  const endpoint = `${ACCOUNTING_API}/ext/v1/mcp`;
  return (
    <Shell active="mcp">
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ตั้งค่า / การเชื่อมต่อ MCP / OAuth client</span><a href="/settings/mcp#scopes" style={css('text-decoration: none')}>เอกสาร MCP server ของระบบบัญชี</a>
      </header>
      <McpView rows={rows} calls={calls} stats={stats} endpoint={endpoint} active={live.filter((c) => c.status === 'active').length}
        error={!clients.ok ? clients.error : !activity.ok ? activity.error : null} />
    </Shell>
  );
}
