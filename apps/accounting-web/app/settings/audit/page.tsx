// G4 ประวัติการใช้งาน (Audit log) — design/project/ScreenAudit.dc.html (Sidebar active="audit")
// ข้อมูล: GET /v1/audit (200 ล่าสุด) · GET /v1/audit/verify (ตรวจ hash chain ทั้งบริษัท) · ชื่อผู้กระทำจาก Innovera ID
import { thaiMonth } from '@innovera/ui';
import { Shell } from '../../lib/shell';
import { bangkok } from '../../sales/_lib/doc.ts';
import { appToday } from '../../sales/_lib/server';
import type { AuditRow, AuditVerify } from '../apps/_shared/hub.ts';
import { load, userNames } from '../apps/_shared/server.ts';
import { AuditView, type AuditItem } from './view';

const PSTATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };
type Tone = AuditItem['tone'];
/** ป้ายการกระทำที่ backend บันทึกจริง (เปิดงวดคืน/ยกเลิกเอกสาร = คำในแบบร่าง) · TODO(backend): ยังไม่บันทึก audit ของ ผ่านรายการ/แก้ไขร่าง/แก้ไขเอกสารที่ผ่านแล้ว/สร้างเอกสาร (API)/เปลี่ยนสิทธิ์/ส่งออกรายงาน/เข้าสู่ระบบล้มเหลว/สร้าง-เพิกถอน API key · TODO(Wei): ป้ายของ period.close / support.* / flag.set ไม่มีในแบบร่าง (ScreenAudit.dc.html) */
const ACTION: Record<string, { label: string; tone: Tone; cat: string; important: boolean }> = {
  'period.reopen': { label: 'เปิดงวดคืน', tone: 'error', cat: 'period', important: true },
  'period.close': { label: 'ปิดงวด', tone: 'neutral', cat: 'period', important: true },
  'journal.void': { label: 'ยกเลิกเอกสาร', tone: 'error', cat: 'journal', important: true },
  'support.request_access': { label: 'Innovera ขอเข้าดูข้อมูล', tone: 'info', cat: 'user', important: true },
  'support.consent_granted': { label: 'อนุญาตให้ Innovera เข้าดู', tone: 'warning', cat: 'user', important: true },
  'support.consent_denied': { label: 'ปฏิเสธคำขอเข้าดู', tone: 'neutral', cat: 'user', important: true },
  'support.session_start': { label: 'Innovera เริ่มเข้าดู', tone: 'warning', cat: 'user', important: true },
  'support.view': { label: 'Innovera เปิดดูข้อมูล', tone: 'warning', cat: 'user', important: false },
  'support.session_end': { label: 'Innovera สิ้นสุดการเข้าดู', tone: 'neutral', cat: 'user', important: true },
  'support.cancel_access': { label: 'ยกเลิกคำขอเข้าดู', tone: 'neutral', cat: 'user', important: true },
  'flag.set': { label: 'เปลี่ยนการตั้งค่า', tone: 'neutral', cat: 'settings', important: true },
};
const CAT_BY_PREFIX: Record<string, string> = { document: 'document', journal: 'journal', period: 'period', user: 'user', role: 'user', support: 'user', settings: 'settings', flag: 'settings', api_client: 'api', webhook: 'api', login: 'login' };

const short = (id: string) => (/^[0-9a-f-]{36}$/u.test(id) ? `${id.slice(0, 8)}…` : id);
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const show = (k: string, v: unknown): string => (k === 'status' && typeof v === 'string' ? PSTATUS[v] ?? v : typeof v === 'string' ? v : JSON.stringify(v));

function target(r: AuditRow): string {
  if (r.entity === 'period') { const [y, m] = r.entity_id.split('-').map(Number); return y && m ? `งวด ${thaiMonth(m)} ${y}` : r.entity_id; }
  if (r.entity === 'support_access') return `คำขอเข้าดูข้อมูล ${short(r.entity_id)}`;
  return `${r.entity} ${short(r.entity_id)}`;
}
/** "ปิดอ่อน → เปิด · เหตุผล: "…"" (รูปแบบคอลัมน์ "รายละเอียด (เดิม → ใหม่)" ในแบบร่าง) */
function detail(r: AuditRow): string {
  const b = asObj(r.before) ?? {};
  const a = asObj(r.after) ?? {};
  const parts: string[] = [];
  const reason = a.reason ?? b.reason;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => k !== 'reason' && k !== 'approve');
  for (const k of keys) {
    if (JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
    const from = k in b ? show(k, b[k]) : '—';
    const to = k in a ? show(k, a[k]) : '—';
    parts.push(k === 'status' ? `${from} → ${to}` : `${k}: ${from} → ${to}`);
  }
  if (typeof reason === 'string' && reason) parts.push(`เหตุผล: "${reason}"`);
  return parts.join(' · ') || '—';
}

export default async function AuditPage() {
  const [rows, verify, names] = await Promise.all([load<AuditRow[]>('/v1/audit'), load<AuditVerify>('/v1/audit/verify'), userNames()]);
  const items: AuditItem[] = (rows.ok ? rows.data : []).map((r) => {
    const meta = ACTION[r.action] ?? { label: r.action, tone: 'neutral' as Tone, cat: CAT_BY_PREFIX[r.action.split('.')[0] ?? ''] ?? 'other', important: true };
    const staff = r.action.startsWith('support.') && !r.action.startsWith('support.consent');
    const { date } = bangkok(r.at);
    const t = new Date(Date.parse(r.at) + 7 * 3_600_000).toISOString();
    return {
      id: r.id, date, time: `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 19)}`,
      actor: r.actor_id === null ? 'ระบบ' : names[r.actor_id] ?? (staff ? 'Innovera Support' : short(r.actor_id)),
      label: meta.label, tone: meta.tone, cat: meta.cat, important: meta.important, target: target(r), detail: detail(r),
      // TODO(backend): audit_log ยังไม่เก็บช่องทาง/IP/2FA (Spec FR-PF-03 ต้องมี IP) → อนุมานจากชนิดการกระทำ
      channel: staff ? 'Innovera Console' : 'เว็บ', hash: r.hash ?? '', prevHash: r.prev_hash ?? '',
    };
  });
  const today = appToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return (
    <Shell active="audit">
      <AuditView items={items} verify={verify.ok ? verify.data : null} error={!rows.ok ? rows.error : !verify.ok ? verify.error : null} defaultRange={`01/${mm}/${y + 543} – ${last}/${mm}/${y + 543}`} />
    </Shell>
  );
}
