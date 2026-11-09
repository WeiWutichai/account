// G4 ประวัติการใช้งาน — แปลงแถวจาก GET /v1/audit เป็นข้อความตามแบบร่าง ScreenAudit.dc.html (ใช้ทั้ง page.tsx และตอนส่งออก CSV ฝั่ง client)
import { thaiMonth } from '@innovera/ui';
import { bangkok } from '../../sales/_lib/doc.ts';
import type { AuditRow } from '../apps/_shared/hub.ts';

/** แถวต่อหน้า (GET /v1/audit?limit=) */
export const AUDIT_PAGE = 50;

export interface AuditItem {
  id: string; date: string; time: string; actor: string; actorBadge: string | null; label: string; tone: 'success' | 'warning' | 'error' | 'neutral' | 'info';
  target: string; detail: string; channel: string; ip: string; hash: string; prevHash: string;
}

const PSTATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };
type Tone = AuditItem['tone'];
/** ป้ายการกระทำตามแบบร่าง (ScreenAudit.dc.html) · ชนิดอื่นแสดงรหัสการกระทำ
 *  TODO(Wei): ป้ายของ period.close / support.* / flag.set / document.create (เว็บ) / document.submit / document.reject / document.approve / api_client.* / contact.* / product.* / cheque.* / company.settings ไม่มีในแบบร่าง
 *  TODO(backend): "เปลี่ยนสิทธิ์" (id-api แก้ company_membership) และ "เข้าสู่ระบบล้มเหลว" (public.login_event) ยังไม่ลง acct.audit_log */
const ACTION: Record<string, { label: string; tone: Tone }> = {
  'period.reopen': { label: 'เปิดงวดคืน', tone: 'error' },
  'period.close': { label: 'ปิดงวด', tone: 'neutral' },
  'journal.void': { label: 'ยกเลิกเอกสาร', tone: 'error' },
  'document.void': { label: 'ยกเลิกเอกสาร', tone: 'error' },
  'document.post': { label: 'ผ่านรายการ', tone: 'success' },
  'document.edit_posted': { label: 'แก้ไขเอกสารที่ผ่านแล้ว', tone: 'warning' },
  'document.edit_draft': { label: 'แก้ไขร่าง', tone: 'neutral' },
  'report.export': { label: 'ส่งออกรายงาน', tone: 'neutral' },
  'support.request_access': { label: 'Innovera ขอเข้าดูข้อมูล', tone: 'info' },
  'support.consent_granted': { label: 'อนุญาตให้ Innovera เข้าดู', tone: 'warning' },
  'support.consent_denied': { label: 'ปฏิเสธคำขอเข้าดู', tone: 'neutral' },
  'support.session_start': { label: 'Innovera เริ่มเข้าดู', tone: 'warning' },
  'support.view': { label: 'Innovera เปิดดูข้อมูล', tone: 'warning' },
  'support.session_end': { label: 'Innovera สิ้นสุดการเข้าดู', tone: 'neutral' },
  'support.cancel_access': { label: 'ยกเลิกคำขอเข้าดู', tone: 'neutral' },
  'flag.set': { label: 'เปลี่ยนการตั้งค่า', tone: 'neutral' },
};

const short = (id: string) => (/^[0-9a-f-]{36}$/u.test(id) ? `${id.slice(0, 8)}…` : id);
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const show = (k: string, v: unknown): string => (k === 'status' && typeof v === 'string' ? PSTATUS[v] ?? v : typeof v === 'string' ? v : JSON.stringify(v));
/** IP ที่ไม่ใช่เครือข่ายภายใน → "IP ภายนอก" (คำในแบบร่าง) · TODO(Wei/backend): "IP ต่างประเทศ" ต้องมีฐานข้อมูลตำแหน่ง IP */
const isPrivateIp = (ip: string) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/iu.test(ip);

function target(r: AuditRow): string {
  if (r.entity === 'period') { const [y, m] = r.entity_id.split('-').map(Number); return y && m ? `งวด ${thaiMonth(m)} ${y}` : r.entity_id; }
  if (r.entity === 'support_access') return `คำขอเข้าดูข้อมูล ${short(r.entity_id)}`;
  if (r.entity === 'document' && r.doc_no) return r.doc_no;
  if (r.entity === 'journal' && r.journal_no) return r.journal_no;
  if (r.entity === 'api_client' && r.client_name) return r.client_name;
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
/** ช่องทางจริงจาก audit_log.channel/ip (migration 0016) · แถวก่อนหน้านั้นไม่มีข้อมูล → "—" */
function channel(r: AuditRow, staff: boolean): string {
  if (staff) return 'Innovera Console';
  const ext = r.ip && !isPrivateIp(r.ip) ? ' · IP ภายนอก' : '';
  switch (r.channel) {
    case 'web': return `เว็บ${ext}`;
    case 'api': return `API · ${r.client_name ?? '—'}${ext}`;
    // TODO(Wei): ป้ายช่องทาง MCP ไม่มีในแบบร่าง (มีแค่ "API · OAuth app TMS")
    case 'mcp': return `MCP · ${r.client_name ?? '—'}${ext}`;
    case 'system': return 'ระบบ';
    default: return '—';
  }
}

export function toAuditItem(r: AuditRow): AuditItem {
  const external = r.channel === 'api' || r.channel === 'mcp';
  const meta = r.action === 'document.create' && external ? { label: 'สร้างเอกสาร (API)', tone: 'info' as Tone } : ACTION[r.action] ?? { label: r.action, tone: 'neutral' as Tone };
  const staff = r.action.startsWith('support.') && !r.action.startsWith('support.consent');
  const { date } = bangkok(r.at);
  const t = new Date(Date.parse(r.at) + 7 * 3_600_000).toISOString();
  return {
    id: r.id, date, time: `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 19)}`,
    // ผู้กระทำ: ชื่อจาก Innovera ID · client ภายนอก = ป้ายชื่อ client + "ระบบ" (แบบร่าง "[TMS] ระบบ")
    actor: r.actor_name ?? (r.actor_id ? (staff ? 'Innovera Support' : short(r.actor_id)) : 'ระบบ'),
    actorBadge: !r.actor_id && r.client_name ? r.client_name : null,
    label: meta.label, tone: meta.tone, target: target(r), detail: detail(r), channel: channel(r, staff), ip: r.ip ?? '', hash: r.hash ?? '', prevHash: r.prev_hash ?? '',
  };
}
