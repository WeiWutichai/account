// G4 ประวัติการใช้งาน (Audit log) — design/project/ScreenAudit.dc.html (Sidebar active="audit")
// ข้อมูล: GET /v1/audit (แบ่งหน้า + ตัวกรองฝั่ง server · ชื่อผู้กระทำ/ช่องทาง/IP จาก API) · GET /v1/audit/verify (ตรวจ hash chain ทั้งบริษัท)
// ตัวกรองอยู่ใน URL (?q &type &actor &from &to &important=0 &page) เพื่อให้นับ "จาก N เหตุการณ์" ได้จริง
import { Shell } from '../../lib/shell';
import { appToday } from '../../sales/_lib/server';
import type { AuditPage as AuditData, AuditVerify } from '../apps/_shared/hub.ts';
import { load } from '../apps/_shared/server.ts';
import { AUDIT_PAGE, toAuditItem } from './format';
import { AuditView } from './view';

const ISO = /^\d{4}-\d{2}-\d{2}$/u;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = appToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const mm = String(m).padStart(2, '0');
  const from = sp.from && ISO.test(sp.from) ? sp.from : `${y}-${mm}-01`;
  const to = sp.to && ISO.test(sp.to) ? sp.to : `${y}-${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const important = sp.important !== '0';
  const qs = new URLSearchParams({ limit: String(AUDIT_PAGE), offset: String(page * AUDIT_PAGE), from, to, ...(important ? { important: '1' } : {}),
    ...(sp.type ? { category: sp.type } : {}), ...(sp.actor ? { actor: sp.actor } : {}), ...(sp.q ? { q: sp.q } : {}) });
  const [res, verify] = await Promise.all([load<AuditData>(`/v1/audit?${qs}`), load<AuditVerify>('/v1/audit/verify')]);
  return (
    <Shell active="audit">
      <AuditView items={res.ok ? res.data.rows.map(toAuditItem) : []} count={res.ok ? res.data.count : 0} actors={res.ok ? res.data.actors : []} page={page}
        filters={{ q: sp.q ?? '', type: sp.type ?? '', actor: sp.actor ?? '', from, to, important }}
        verify={verify.ok ? verify.data : null} error={!res.ok ? res.error : !verify.ok ? verify.error : null} />
    </Shell>
  );
}
