// G3 แอปที่เชื่อมต่อ — design/project/ScreenApps.dc.html (Sidebar active="apps")
// ข้อมูล: GET /v1/api-clients · GET /v1/webhooks (accounting-api hub.controller.ts)
import { css } from '@innovera/ui';
import { Shell } from '../../lib/shell';
import { appToday } from '../../sales/_lib/server';
import { type ApiClient, bkkDate, lastUsed, type Webhooks } from './_shared/hub.ts';
import { load } from './_shared/server.ts';
import { AppsView, type AppsData, type ExtRow } from './view';

export default async function AppsPage() {
  const today = appToday();
  const [clients, hooks] = await Promise.all([load<ApiClient[]>('/v1/api-clients'), load<Webhooks>('/v1/webhooks')]);
  const error = !clients.ok ? clients.error : !hooks.ok ? hooks.error : null;
  const cs = clients.ok ? clients.data : [];
  const wh = hooks.ok ? hooks.data : { endpoints: [], deliveries: [] };

  const tms = cs.filter((c) => c.kind === 'tms' && !c.revoked_at);
  const tmsIds = new Set(tms.map((c) => c.id));
  const tmsEps = new Set(wh.endpoints.filter((e) => e.api_client_id && tmsIds.has(e.api_client_id)).map((e) => e.id));
  const since = Date.now() - 24 * 3_600_000; // 24 ชม. นับจากเวลาจริง (ไม่ใช้ APP_TODAY)
  const tmsDel = wh.deliveries.filter((d) => tmsEps.has(d.endpoint_id));
  const tmsDel24 = tmsDel.filter((d) => Date.parse(d.created_at) >= since);
  const tmsDead = tmsDel.filter((d) => d.status === 'dead');

  const rows: ExtRow[] = [
    ...cs.filter((c) => c.kind === 'custom').map((c): ExtRow => ({
      id: c.id, name: c.name, type: 'API key', scopes: c.scopes.join(' · '), lastUsed: lastUsed(c.last_used_at, today),
      status: c.revoked_at ? { tone: 'error', text: 'เพิกถอนแล้ว' } : { tone: 'success', text: 'ใช้งาน' }, muted: !!c.revoked_at, deadIds: [],
    })),
    ...wh.endpoints.filter((e) => !tmsEps.has(e.id)).map((e): ExtRow => {
      const dels = wh.deliveries.filter((d) => d.endpoint_id === e.id);
      const dead = dels.filter((d) => d.status === 'dead');
      const sent = dels.filter((d) => d.sent_at).map((d) => d.sent_at!).sort().at(-1) ?? null;
      return {
        id: e.id, name: `Webhook → ${e.url}`, type: 'Webhook ออก', scopes: e.events.join(' · '), lastUsed: lastUsed(sent, today),
        status: !e.active ? { tone: 'neutral', text: 'ปิดอยู่' } : dead.length ? { tone: 'warning', text: `${dead.length} ฉบับล้มเหลว` } : { tone: 'success', text: 'ใช้งาน' },
        muted: !e.active, deadIds: dead.map((d) => d.id),
      };
    }),
  ];

  const data: AppsData = {
    error,
    tms: {
      connected: tms[0] ? `เชื่อมต่อแล้ว ${bkkDate(tms[0].created_at)} · องค์กรเดียวกัน` : null,
      status: !tms.length ? { tone: 'neutral', text: 'ปิดอยู่' } : tmsDead.length ? { tone: 'warning', text: `${tmsDead.length} ฉบับล้มเหลว` } : { tone: 'success', text: 'ทำงานปกติ' },
      // TODO(Wei): ข้อความเมื่อมีที่ล้มเหลว ไม่มีในแบบร่าง (มีแค่ "12 · สำเร็จทั้งหมด") — ใช้รูป "ล้มเหลว n" จากแถวบน
      hooks24: tms.length ? `${tmsDel24.length} · ${tmsDel24.some((d) => d.status === 'dead') ? `ล้มเหลว ${tmsDel24.filter((d) => d.status === 'dead').length}` : 'สำเร็จทั้งหมด'}` : '—',
      deadIds: tmsDead.map((d) => d.id),
      notify: tmsEps.size > 0,
    },
    rows,
  };
  return (
    <Shell active="apps">
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ตั้งค่า / แอปที่เชื่อมต่อ</span><a href="/settings/mcp" style={css('text-decoration: none')}>เอกสาร API สำหรับนักพัฒนา</a>
      </header>
      <AppsView data={data} />
    </Shell>
  );
}
