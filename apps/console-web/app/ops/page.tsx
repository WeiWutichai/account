// X7 Ops — งานค้าง สำรองข้อมูล ฐานข้อมูล ← design/project/ConsoleOps.dc.html
// ทีม Innovera เห็นสถานะงานและข้อผิดพลาดทางเทคนิค ไม่เห็นเนื้อหาเอกสารของลูกค้า (GET ops ไม่คืน payload)
import { css } from '@innovera/ui';
import { Shell } from '../Shell';
import { Card, DASH, Inert, Row, ST, Stat, Stats, Tabs, Tag, Title } from '../ui';
import { getOps } from '../lib/data';
import { count, ddmmhm, shortId } from '../lib/format';

export default async function OpsPage() {
  const ops = await getOps();
  const dead = ops.webhooks.dead ?? 0;
  const queue = (ops.webhooks.pending ?? 0) + ops.emailQueue;
  return (
    <Shell active="ops" crumb="Innovera Console / Ops / งานค้าง" status={<Tag tone={dead ? 'error' : 'success'}>{dead} งานล้มเหลว · {DASH} ใบรับรองใกล้หมด</Tag>}>
      <div style={css(ST.content)}>
        <Title h1="Ops — งานค้าง สำรองข้อมูล ฐานข้อมูล" sub="ทีม Innovera เห็นสถานะงานและข้อผิดพลาดทางเทคนิค ไม่เห็นเนื้อหาเอกสารของลูกค้า" />
        <Stats>
          {/* TODO(backend): e-Tax ยังไม่มีคิวใน Console */}
          <Stat label="งานล้มเหลวรอจัดการ" value={count(dead)} color={dead ? '#a2191f' : '#161616'} note={`webhook ${count(dead)} · e-Tax ${DASH}`} />
          {/* TODO(backend): คิว BullMQ ยังไม่อยู่ใน GET ops — นับ webhook รอส่ง + อีเมลรอส่ง */}
          <Stat label="คิวงานรอ" value={count(queue)} note="ปกติ < 5,000" />
          {/* TODO(backend): สำรองข้อมูล / พื้นที่ cluster / uptime (PLAN M8: เครื่องมือ backup/restore ผ่าน UI) ยังไม่มี endpoint */}
          <Stat label="สำรองข้อมูลคืนนี้" value={DASH} note={DASH} />
          <Stat label="พื้นที่ cluster A" value={DASH} note={DASH} />
          <Stat label="uptime 30 วัน" value={DASH} note="SLA Enterprise 99.9%" />
        </Stats>
        {/* TODO(Wei): เนื้อหาแท็บอื่นไม่มีในแบบร่าง (มีเป็นกล่องสรุปด้านล่างแทน) */}
        <Tabs selected={0} tabs={[`งานล้มเหลว / dead-letter (${dead})`, 'สำรองและกู้คืน', 'ฐานข้อมูลและ tenant', 'สถานะบริการภายนอก', 'ประกาศปิดปรับปรุง']} />
        <section style={css(ST.tableBox)}><table style={css(ST.table(1100))}>
          <thead><tr style={css(ST.theadRow)}>{['เวลา', 'องค์กร', 'งาน', 'ข้อผิดพลาด (ไม่มี payload ลูกค้า)', 'พยายาม', ''].map((h, i) => <th key={i} style={css(ST.th)}>{h}</th>)}</tr></thead>
          <tbody>
            {ops.deadLetters.map((d, i) => (
              <tr key={i} style={css(ST.tr)}>
                <td style={css(ST.td1)}>{ddmmhm(d.created_at)}</td>
                {/* TODO(backend): deadLetters คืนแค่ company_id — ต้องมีชื่อองค์กร/บริษัท และจำนวนครั้งที่พยายาม */}
                <td style={css(ST.td)}>{shortId(d.company_id)}</td>
                <td style={css(ST.td)}>webhook · {d.event}</td>
                <td style={css(ST.td)}>{d.last_error ?? DASH}</td>
                <td style={css(ST.td)}>{DASH} · dead-letter</td>
                {/* TODO(backend): ยังไม่มี endpoint ส่งซ้ำ / แจ้งลูกค้า */}
                <td style={css(ST.td)}><Inert kind="secondarySm">ส่งซ้ำ</Inert> <Inert kind="ghostSm">แจ้งลูกค้า</Inert></td>
              </tr>
            ))}
            {!ops.deadLetters.length && <tr style={css(ST.tr)}><td colSpan={6} style={css(ST.td1)}>{DASH}</td></tr>}
          </tbody>
        </table></section>
        <div style={css(ST.grid2)}>
          {/* TODO(Wei): แบบร่างเขียน "316 schema" (schema-per-company) แต่ ADR-001 = ตารางรวม + RLS · TODO(backend): ข้อมูล cluster/DB แยก/การย้าย/ลบ tenant ยังไม่มี */}
          <Card title="ฐานข้อมูลและ tenant">
            <Row left="Cluster A (shared)" right={`${DASH} · PgBouncer transaction mode · ${DASH}`} />
            <Row left="Cluster B (dedicated)" right={`${DASH} DB`} />
            <Row left="ย้าย tenant → DB แยก" right={<>ขั้นตอน: snapshot → replay WAL → สลับ <code>company.db_dsn</code> → ตรวจ → หยุดชั่วคราว &lt; 2 นาที</>} />
            <Row left={<Inert kind="ghostSm">เริ่มย้าย {DASH} (ตามคำขอ)</Inert>} />
            <Row left="ลบ tenant ที่ปิดเกิน 90 วัน" right={`${DASH} รอ · ต้อง 2 คนอนุมัติ`} />
          </Card>
          {/* TODO(backend): ผลสำรอง/ทดสอบกู้คืนจริง · ปุ่มทดสอบกู้คืนยังไม่มี endpoint */}
          <Card title="สำรองและกู้คืน">
            <Row left="รายวัน 02:00" right="ทุก schema · เก็บ 30 วัน · เข้ารหัส · ต่างภูมิภาค (Enterprise)" />
            <Row left="PITR" right="ย้อนได้ 7 วัน ระดับ cluster" />
            <Row left="กู้คืนรายบริษัท" right={`ไปยัง schema ชั่วคราวให้ลูกค้าตรวจก่อนสลับ · ทดสอบล่าสุด ${DASH}`} />
            <Row left={<Inert kind="ghostSm">ทดสอบกู้คืนสุ่ม 1 tenant</Inert>} right="รายเดือน" />
          </Card>
          {/* TODO(backend): สถานะบริการภายนอกยังไม่มีแหล่งข้อมูล */}
          <Card title="บริการภายนอก">
            <Row left="ผู้ให้บริการ e-Tax A" right={`ใบรับรองหมด ${DASH}`} />
            <Row left="Open API ธนาคาร A / B" right={DASH} />
            <Row left="อีเมล (transactional)" right={`ส่ง ${DASH} · bounce ${DASH}`} />
            <Row left="Innovera ID (auth)" right={DASH} />
            <Row left="LiteLLM / AI (MCP)" right={DASH} />
          </Card>
        </div>
      </div>
    </Shell>
  );
}
