// เพิกถอนสิทธิ์การเข้าถึง — design/project/ScreenRevoke.dc.html (Sidebar active="mcp")
// ไม่มี route id ใน packages/ui/src/routes.ts → ใช้ /settings/revoke?client=<api client id> | ?user=<user id>
// ?client → DELETE /v1/api-clients/:id (accounting-api) · ?user → DELETE /settings/users/api/users/:uid (route handler เดิม → id-api)
import { redirect } from 'next/navigation';
import { Shell } from '../../lib/shell';
import { appToday } from '../../sales/_lib/server';
import { loadUsers } from '../users/data';
import { type ApiClient, bkkDate, KIND_LABEL, lastUsed, type Webhooks } from '../apps/_shared/hub.ts';
import { load } from '../apps/_shared/server.ts';
import { RevokeView, type RevokeTarget } from './view';

export default async function RevokePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = appToday();
  let t: RevokeTarget | null = null;
  let error: string | null = null;

  if (sp.client) {
    const [clients, hooks] = await Promise.all([load<ApiClient[]>('/v1/api-clients'), load<Webhooks>('/v1/webhooks')]);
    if (!clients.ok) error = clients.error;
    const c = clients.ok ? clients.data.find((x) => x.id === sp.client) : undefined;
    if (c) {
      const eps = hooks.ok ? hooks.data.endpoints.filter((e) => e.api_client_id === c.id && e.active) : [];
      t = {
        mode: 'client', id: c.id, kindLabel: KIND_LABEL[c.kind], name: c.name,
        // TODO(backend): GET /v1/api-clients ไม่ส่ง created_by → ชื่อผู้อนุญาตไม่ได้ · สถิติการเรียก 7 วันไม่มี
        authorizedBy: `— · ${bkkDate(c.created_at)}`, lastUsed: `${lastUsed(c.last_used_at, today)} · — ครั้ง/7 วัน`,
        revoked: !!c.revoked_at, webhooks: eps.length,
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
          authorizedBy: '—', lastUsed: lastUsed(u.last_login_at, today), revoked: false, webhooks: 0,
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
