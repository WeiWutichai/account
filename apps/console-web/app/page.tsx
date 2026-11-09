// X1 ภาพรวมแพลตฟอร์ม ← design/project/ConsoleOverview.dc.html
// ตัวเลขทุกตัวมาจาก /console/v1 (overview · tenants · ops) — ค่าที่ยังไม่มีแหล่งข้อมูลแสดง "—" (ห้ามใช้ตัวเลขตัวอย่างจากแบบร่าง)
import { css } from '@innovera/ui';
import { Shell } from './Shell';
import { Card, DASH, Note, Row, ST, Stat, Stats, Tag, Title } from './ui';
import { getOps, getOverview, getTenants } from './lib/data';
import { count, longThaiDate } from './lib/format';
import { nearLimit, trialEndingSoon } from './lib/rules';

const WARN = '#684e00', BAD = '#a2191f', GREY = '#525252';

export default async function OverviewPage() {
  const [o, tenants, ops] = await Promise.all([getOverview(), getTenants(), getOps()]);
  const c = o.counts;
  const plans = (status: string) => o.plans.filter((p) => p.status === status).reduce((s, p) => s + p.n, 0);
  const trialSoon = tenants.filter((t) => trialEndingSoon(t)).length;
  const near = tenants.filter(nearLimit).length;
  const deadOrgs = new Set(ops.deadLetters.map((d) => d.company_id)).size;
  // TODO(backend): ยังไม่มีสัญญาณสุขภาพระบบ (API p95, คิวงาน, PgBouncer, e-Tax, สำรองข้อมูล) — นับเตือนได้เฉพาะ webhook dead-letter
  const warnings = c.dead_webhooks > 0 ? 1 : 0;
  return (
    <Shell active="overview" crumb="Innovera Console / ภาพรวมแพลตฟอร์ม"
      status={<Tag tone={warnings ? 'warning' : 'success'}>ทุกระบบปกติ · {warnings} เตือน</Tag>}>
      <div style={css(ST.content)}>
        <Title h1="ภาพรวมแพลตฟอร์ม" sub={`${longThaiDate(new Date())} · ข้อมูลรวมทุกองค์กร ไม่มีรายละเอียดธุรกรรมของลูกค้า (ดูได้เฉพาะผ่าน Support พร้อม consent)`} />
        <Stats>
          {/* TODO(backend): "+N เดือนนี้" ต้องมีจำนวนองค์กรสมัครใหม่ต่อเดือน */}
          <Stat label="องค์กรทั้งหมด" value={count(c.orgs)} note={`+${DASH} เดือนนี้`} />
          {/* TODO(Wei): แบบร่างเขียน "schema-per-company 318 · DB แยก 2" แต่ ADR-001 (Wei อนุมัติ 2026-11-09) = ตารางรวม + company_id + RLS → แสดงตาม ADR · จำนวน "DB แยก" ต้องมี company.db_dsn จาก backend */}
          <Stat label="บริษัท (tenants)" value={count(c.companies)} note={`ตารางรวม + RLS ${count(c.companies)} · DB แยก ${DASH}`} />
          {/* TODO(backend): ที่นั่ง active = ผู้ใช้สถานะ active ทั้งระบบ · MAU 7 วันยังไม่มี */}
          <Stat label="ที่นั่ง active" value={count(c.users)} note={`MAU 7 วัน ${DASH}`} />
          <Stat label="trial กำลังหมดใน 7 วัน" value={count(trialSoon)} color={trialSoon ? WARN : '#161616'} note={`${DASH} ยังไม่เคยสร้างเอกสาร`} />
          {/* Phase 2: ยอดค้างชำระมาจาก Subscription & billing */}
          <Stat label="past_due" value={count(plans('past_due'))} color={plans('past_due') ? BAD : '#161616'} note={`รวม ${DASH} บาท`} />
          {/* TODO(backend): เอกสาร/วัน เฉลี่ย 7 วัน และสัดส่วนผ่าน API — มีแค่จำนวนเอกสารเดือนนี้ (docs_month) */}
          <Stat label="เอกสาร/วัน (เฉลี่ย 7 วัน)" value={DASH} note={`ผ่าน API ${DASH}`} />
        </Stats>
        <div style={css(ST.grid2)}>
          <Card title="ต้องดูวันนี้">
            <Row left={<><a href="/ops" style={css(ST.link)}>Webhook ไป TMS ล้มเหลวซ้ำ</a> · {count(deadOrgs)} องค์กร</>} right={`${count(c.dead_webhooks)} รายการ · dead-letter`} color={c.dead_webhooks ? BAD : GREY} />
            {/* TODO(backend): e-Tax ยังไม่มีข้อมูลใน Console */}
            <Row left={<><a href="/ops" style={css(ST.link)}>e-Tax ส่งไม่ผ่าน</a> · {DASH}</>} right={`${DASH} ฉบับ · ${DASH} องค์กร`} color={GREY} />
            <Row left={<a href="/support" style={css(ST.link)}>Support ticket เปิดอยู่</a>} right={`${count(c.tickets_open)} · ${count(c.consent_pending)} รอ consent เข้าดู`} color={c.tickets_open ? WARN : GREY} />
            <Row left={<><a href="/tenants" style={css(ST.link)}>องค์กรใกล้ชนลิมิต</a> (ที่นั่ง/บริษัท ≥ 90%)</>} right={`${count(near)} · โอกาสอัปเกรด`} color={near ? WARN : GREY} />
            {/* TODO(backend): สถานะสำรองข้อมูล (PLAN M8: backup/restore ผ่าน UI) */}
            <Row left="สำรองข้อมูลคืนนี้" right={DASH} />
          </Card>
          {/* TODO(backend): สุขภาพระบบ 24 ชม. ทั้งกล่องยังไม่มีแหล่งข้อมูล ยกเว้นจำนวนเข้าสู่ระบบล้มเหลว (failed_logins_24h) */}
          <Card title="สุขภาพระบบ (24 ชม.)">
            <Row left="API p95" right={`${DASH} ms · error ${DASH}`} />
            <Row left="Posting Engine" right={`Dr=Cr fail ${DASH} · re-post ${DASH}`} />
            <Row left="คิวงาน (jobs)" right={`รอ ${DASH} · ช้าสุด ${DASH} วินาที`} />
            <Row left="PgBouncer" right={`pool ใช้ ${DASH} · ${DASH} wait`} />
            <Row left="Innovera ID (auth)" right={`login ${DASH} · ล้มเหลว ${count(c.failed_logins_24h)} ครั้ง · ล็อก ${DASH} บัญชี`} />
            <Row left="ใบรับรอง e-Tax ผู้ให้บริการ" right={`หมด ${DASH}`} />
            <Note>ดูรายละเอียดใน <a href="/ops" style={css(ST.link)}>Ops</a></Note>
          </Card>
          {/* Phase 2 (Subscription) + TODO(backend): สถิติการเติบโต/แอปที่เปิดใช้/NPS ยังไม่มีแหล่งข้อมูล */}
          <Card title="การเติบโต (30 วัน)">
            <Row left="สมัครใหม่" right={`${DASH} องค์กร · แปลงเป็นจ่าย ${DASH}`} />
            <Row left="ยกเลิก (churn)" right={`${DASH} องค์กร`} />
            <Row left="MRR" right={`${DASH} บาท`} />
            <Row left="แอปที่เปิดใช้" right={`บัญชี ${DASH} · TMS ${DASH} · ทั้งคู่ ${DASH}`} />
            <Row left="NPS ล่าสุด" right={DASH} />
            <Note>ตัวเลขการเงินแสดงเต็มเมื่อ Subscription (Phase 2) ใช้งาน</Note>
          </Card>
          {/* TODO(backend): ประกาศ/การปล่อยฟีเจอร์ — ต้องมีข้อมูลเวอร์ชันและขั้นการปล่อยของ flag (ดู ConsoleFlags) */}
          <Card title="ประกาศ / การปล่อยฟีเจอร์">
            <Row left="v1.4 — ทะเบียนทรัพย์สิน" right={DASH} />
            <Row left="MCP connector" right={<>beta {DASH} องค์กร · <a href="/flags" style={css(ST.link)}>ขยายเป็น {DASH}</a></>} />
            <Row left="สต็อก (v2)" right={DASH} />
            <Row left="แจ้งปิดปรับปรุง" right={DASH} />
          </Card>
        </div>
      </div>
    </Shell>
  );
}
