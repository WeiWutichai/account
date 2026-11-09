// เพิกถอนสิทธิ์การเข้าถึง — design/project/ScreenRevoke.dc.html (Sidebar active="mcp")
// ไม่มี route id ใน packages/ui/src/routes.ts → ใช้ /settings/revoke?client=<api client id> | ?user=<user id>
// ?client → DELETE /v1/api-clients/:id · POST …/read-only · POST …/suspend (accounting-api) · ?user → DELETE /settings/users/api/users/:uid (route handler เดิม → id-api)
import { money } from '@innovera/ui';
import { redirect } from 'next/navigation';
import { Shell } from '../../lib/shell';
import { TYPE_NAME as PTYPE_NAME } from '../../purchase/_lib/types.ts';
import { TYPE_NAME as STYPE_NAME } from '../../sales/_lib/doc.ts';
import { appToday } from '../../sales/_lib/server';
import { loadUsers } from '../users/data';
import { type ApiActivity, type ApiClient, bkkDate, KIND_LABEL, lastUsed, type Webhooks } from '../apps/_shared/hub.ts';
import { load } from '../apps/_shared/server.ts';
import { RevokeView, type RevokeTarget } from './view';

const TYPE_NAME: Record<string, string> = { ...STYPE_NAME, ...PTYPE_NAME };
const DRAFT_TOOLS = new Set(['create_draft_document', 'POST /ext/v1/documents', 'PUT /ext/v1/contacts']);

export default async function RevokePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = appToday();
  let t: RevokeTarget | null = null;
  let error: string | null = null;

  if (sp.client) {
    const [clients, hooks, act] = await Promise.all([load<ApiClient[]>('/v1/api-clients'), load<Webhooks>('/v1/webhooks'), load<ApiActivity>(`/v1/api-clients/${encodeURIComponent(sp.client)}/activity`)]);
    if (!clients.ok) error = clients.error;
    const c = clients.ok ? clients.data.find((x) => x.id === sp.client) : undefined;
    if (c) {
      const eps = hooks.ok ? hooks.data.endpoints.filter((e) => e.api_client_id === c.id && e.active) : [];
      const a = act.ok ? act.data : null;
      const sum = (f: (r: ApiActivity['last24h'][number]) => boolean) => (a ? a.last24h.filter(f).reduce((s, r) => s + r.n, 0) : null);
      const deniedTools = a ? [...new Set(a.last24h.filter((r) => r.status === 'denied').map((r) => r.tool))] : [];
      t = {
        mode: 'client', id: c.id, kindLabel: KIND_LABEL[c.kind], name: c.name,
        authorizedBy: `${c.created_by_name ?? '—'} · ${bkkDate(c.created_at)}`, lastUsed: `${lastUsed(c.last_used_at, today)} · ${c.calls_7d.toLocaleString('en-US')} ครั้ง/7 วัน`,
        revoked: !!c.revoked_at, suspended: c.status === 'suspended', webhooks: eps.length,
        drafts: (a?.drafts ?? []).map((d) => ({ id: d.id, label: `${d.doc_no ?? ''}${d.doc_no ? ' ' : ''}${TYPE_NAME[d.doc_type] ?? d.doc_type} (ร่าง) ${money(d.grand_total)}` })),
        contacts: a?.contacts ?? 0,
        activity: a ? { read: sum((r) => r.status === 'ok' && !DRAFT_TOOLS.has(r.tool)) ?? 0, draft: sum((r) => r.status === 'ok' && r.tool !== 'PUT /ext/v1/contacts' && DRAFT_TOOLS.has(r.tool)) ?? 0,
          denied: sum((r) => r.status === 'denied') ?? 0, deniedTools } : null,
        crumb: { label: 'การเชื่อมต่อ AI (MCP)', href: '/settings/mcp' }, back: '/settings/mcp', sidebar: 'mcp',
      };
    }
  } else if (sp.user) {
    try {
      const { data } = await loadUsers();
      const u = data.users.find((x) => x.id === sp.user);
      if (u) {
        const auditor = u.org_role === 'guest' || u.company_role === 'auditor';
        t = {
          mode: 'user', id: u.id, kindLabel: auditor ? 'ผู้สอบบัญชีภายนอก' : 'ผู้ใช้ในบริษัท', name: u.display_name,
          authorizedBy: '—', lastUsed: lastUsed(u.last_login_at, today), revoked: false, suspended: false, webhooks: 0, drafts: [], contacts: 0, activity: null,
          // TODO(Wei): แบบร่าง breadcrumb/Sidebar เป็นของ MCP เท่านั้น — กรณีผู้ใช้ใช้ "ผู้ใช้และสิทธิ์" แทน
          crumb: { label: 'ผู้ใช้และสิทธิ์', href: '/settings/users' }, back: '/settings/users', sidebar: 'users',
        };
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'digest' in e) throw e;
      error = e instanceof Error ? e.message : String(e);
    }
  } else {
    redirect('/settings/mcp');
  }
  return (
    <Shell active={t?.sidebar ?? 'mcp'}>
      <RevokeView target={t} error={error ?? (t ? null : 'ไม่พบรายการที่จะเพิกถอน')} />
    </Shell>
  );
}
