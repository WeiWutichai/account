// X8 ทีม Innovera และ Audit ของ Console ← design/project/ConsoleTeam.dc.html
import { css } from '@innovera/ui';
import { Shell } from '../Shell';
import { Card, DASH, Inert, Note, Row, ST, Stat, Stats, Tag, Title } from '../ui';
import { getAudit, getMe, getOverview, getSessionEmail, type AuditRow } from '../lib/data';
import { ddmmhm } from '../lib/format';

// ข้อความของ action ใน audit_console (packages/db/src/console.ts) — รูปแบบแถวตามแบบร่าง: "ผู้กระทำ · การกระทำ · บริษัท · รายละเอียด"
// TODO(Wei): แบบร่างมีตัวอย่างเฉพาะ "ขอ consent impersonate" / ปรับลิมิต / เปิด flag / รีเซ็ต 2FA — ข้อความของ action อื่นตั้งเอง
const ACTION: Record<string, string> = {
  'support.request_access': 'ขอ consent impersonate',
  'support.consent_granted': 'Owner อนุมัติ consent',
  'support.consent_denied': 'Owner ปฏิเสธ consent',
  'support.view': 'เข้าดู (อ่านอย่างเดียว)',
  'flag.set': 'ตั้ง flag',
};
function result(r: AuditRow, all: AuditRow[]): [string, string] {
  if (r.action === 'support.request_access') {
    const d = all.find((x) => x.consent_ref === r.consent_ref && (x.action === 'support.consent_granted' || x.action === 'support.consent_denied'));
    if (!d) return ['รอ', '#684e00'];
    return d.action === 'support.consent_granted' ? ['อนุมัติ', '#0e6027'] : ['ปฏิเสธ', '#a2191f'];
  }
  if (r.action === 'support.consent_denied') return ['ปฏิเสธ', '#a2191f'];
  return ['สำเร็จ', '#0e6027'];
}

export default async function TeamPage() {
  const [audit, me, o, email] = await Promise.all([getAudit(), getMe(), getOverview(), getSessionEmail()]);
  const since = Date.now() - 30 * 86_400_000;
  const recent = audit.filter((r) => r.company && new Date(r.at).getTime() >= since);
  const impersonate = new Set(recent.filter((r) => r.action === 'support.request_access').map((r) => r.consent_ref)).size;
  return (
    // TODO(backend): การอนุมัติ 2 คนยังไม่มีในระบบ → ป้าย/ตัวเลข "รออนุมัติคนที่ 2" เป็น "—"
    <Shell active="team" crumb="Innovera Console / ทีม Innovera และ Audit" status={<Tag tone="warning">{DASH} รายการรออนุมัติคนที่ 2</Tag>}>
      <div style={css(ST.content)}>
        <Title h1="ทีม Innovera และ Audit ของ Console" sub="ใครในทีมทำอะไรกับข้อมูลลูกค้าได้บ้าง และบันทึกทุกการกระทำ" />
        <Stats>
          {/* TODO(backend): แยกจำนวนตามบทบาท / hardware key ต้องมี GET staff */}
          <Stat label="ทีม Innovera" value={o.counts.staff} note={DASH} />
          <Stat label="ทุกคนใช้ hardware key" value={DASH} />
          <Stat label="การกระทำต่อข้อมูลลูกค้า 30 วัน" value={recent.length} note={`impersonate ${impersonate} · ปรับลิมิต ${DASH} · รีเซ็ต 2FA ${DASH}`} />
          <Stat label="รออนุมัติ 2 คน" value={DASH} note={DASH} />
        </Stats>
        {/* TODO(backend): ยังไม่มี GET /console/v1/staff (รายชื่อทีม บทบาท สิทธิ์ ความปลอดภัย ใช้ล่าสุด) และการแก้ไขสมาชิก — แสดงเฉพาะผู้ใช้ปัจจุบันจาก GET me */}
        <section style={css(ST.tableBox)}><table style={css(ST.table(1000))}>
          <thead><tr style={css(ST.theadRow)}>{['สมาชิกทีม', 'บทบาท Console', 'สิทธิ์สำคัญ', 'ความปลอดภัย', 'ใช้ล่าสุด', ''].map((h, i) => <th key={i} style={css(ST.th)}>{h}</th>)}</tr></thead>
          <tbody>
            <tr style={css(ST.tr)}>
              <td style={css(ST.td1)}><strong>{email ?? DASH}</strong><div style={css('font-size: 13px; color: #525252')}>{me.userId.slice(0, 8)}…</div></td>
              <td style={css(ST.td)}>{me.role}</td>
              <td style={css(ST.td)}>{DASH}</td>
              <td style={css(ST.td)}><Tag tone="success">2FA ✓</Tag></td>
              <td style={css(ST.td)}>ตอนนี้</td>
              <td style={css(ST.td)}></td>
            </tr>
          </tbody>
        </table></section>
        <div style={css(ST.grid2)}>
          <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
            <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}>
              <strong style={css('font-weight: 600')}>Audit ของ Console (ทุกการกระทำต่อข้อมูลลูกค้า)</strong>
              {/* TODO(backend): ส่งออกแบบลงนาม (hash chain) ยังไม่มี endpoint */}
              <Inert kind="ghostSm">ส่งออก (ลงนาม)</Inert>
            </div>
            <table aria-label="Audit ของ Console" style={css('width: 100%; border-collapse: collapse; font-size: 13px')}><tbody>
              {audit.map((r, i) => {
                const [label, color] = result(r, audit);
                const text = [r.display_name ?? (r.actor === 'customer_owner' ? 'Owner ลูกค้า' : DASH), ACTION[r.action] ?? r.action, r.company, r.reason].filter(Boolean).join(' · ');
                return (
                  <tr key={r.id} style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
                    <td style={css('height: 32px; padding: 0 16px; color: #525252; white-space: nowrap')}>{ddmmhm(r.at)}</td>
                    <td style={css('padding: 0 8px')}>{text}</td>
                    <td style={css(`padding: 0 16px; text-align: right; color: ${color}`)}>{label}</td>
                  </tr>
                );
              })}
              {!audit.length && <tr><td style={css('height: 32px; padding: 0 16px; color: #525252')}>{DASH}</td></tr>}
            </tbody></table>
          </section>
          <Card title="นโยบายทีม Innovera">
            <Row left="การยืนยันตัวตน" right="Innovera ID แยกจากลูกค้า · 2FA + hardware key บังคับ · เซสชัน 8 ชม." />
            <Row left="หลัก least privilege" right="ไม่มีบทบาทใดเห็นเอกสารลูกค้าโดยตรง · impersonate ต้อง consent" />
            <Row left="การกระทำที่ต้อง 2 คน" right="ลบ tenant · เปลี่ยนค่าอ้างอิงภาษี · ปิดองค์กร · เข้าถึง DB โดยตรง" />
            <Row left="การเข้าถึง DB โดยตรง" right="ผ่าน bastion + บันทึกคำสั่ง · ห้าม SELECT ตารางเอกสารลูกค้านอกเหตุฉุกเฉิน" />
            <Row left="ทบทวนสิทธิ์" right="ทุกไตรมาส · ผู้พ้นสภาพถูกถอดภายใน 1 ชม." />
            <Note>เอกสารนี้ใช้ประกอบ ISO 27001 ที่กำลังดำเนินการ</Note>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
