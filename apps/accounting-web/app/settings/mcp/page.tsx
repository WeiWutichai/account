// G6 การเชื่อมต่อ MCP / OAuth client — design/project/ScreenMcp.dc.html (Sidebar active="mcp")
// ข้อมูล: GET /v1/api-clients (ทุกชนิด) · v1 ใช้ API key ต่อบริษัท แทน OAuth 2.1 + PKCE — TODO(Wei) T14
import { css } from '@innovera/ui';
import { ACCOUNTING_API } from '../../lib/session';
import { Shell } from '../../lib/shell';
import { appToday } from '../../sales/_lib/server';
import { type ApiClient, bkkDate, KIND_LABEL, lastUsed } from '../apps/_shared/hub.ts';
import { load } from '../apps/_shared/server.ts';
import { McpView, type McpRow } from './view';

export default async function McpPage() {
  const today = appToday();
  const clients = await load<ApiClient[]>('/v1/api-clients');
  const cs = clients.ok ? clients.data : [];
  const rows: McpRow[] = cs.map((c) => ({
    id: c.id, name: c.name, clientId: `${c.key_prefix}…`, kind: KIND_LABEL[c.kind], scopes: c.scopes, lastUsed: lastUsed(c.last_used_at, today),
    revoked: c.revoked_at ? `เพิกถอน ${bkkDate(c.revoked_at)}` : null,
  }));
  // TODO(Wei): แบบร่างแสดงโดเมน https://mcp.[product].innovera.co.th/<บริษัท> — ตอนนี้ใช้ origin ของ accounting-api (ตั้ง ACCOUNTING_API_URL ใน production) · คีย์ผูกบริษัทอยู่แล้วจึงไม่มี id บริษัทใน URL
  const endpoint = `${ACCOUNTING_API}/ext/v1/mcp`;
  return (
    <Shell active="mcp">
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ตั้งค่า / การเชื่อมต่อ MCP / OAuth client</span><a href="/settings/mcp#scopes" style={css('text-decoration: none')}>เอกสาร MCP server ของระบบบัญชี</a>
      </header>
      <McpView rows={rows} endpoint={endpoint} active={cs.filter((c) => !c.revoked_at).length} error={clients.ok ? null : clients.error} />
    </Shell>
  );
}
