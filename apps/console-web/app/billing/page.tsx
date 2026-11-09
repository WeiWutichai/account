// X3 Subscription & billing ← design/project/ConsoleBilling.dc.html — Phase 2 (docs/page-map.md · Wei อนุมัติ 2026-11-09)
// TODO(Phase 2): ทั้งหน้าแสดงตามแบบร่างแต่กดไม่ได้ · ตัวเลขเป็น "—" (ไม่แสดงตัวเลขตัวอย่างจากแบบร่าง)
// TODO(backend): กล่อง "ปรับ subscription ด้วยมือ (v1 ใช้จริง)" ต้องมี endpoint ปรับแผน/สถานะ/ลิมิต + audit + แจ้ง Owner — ยังไม่มีใน /console/v1
import { css } from '@innovera/ui';
import { Shell } from '../Shell';
import { B, Card, DASH, Inert, Note, P2, Row, ST, Stat, Stats, Tabs, Title } from '../ui';

const PLANS: [string, string, string, string, string][] = [
  ['Starter', '[x,xxx] (รายปีลด 2 เดือน)', '1 · 2', '— · [xxx]/ที่นั่ง', 'ขาย ซื้อ การเงิน ภาษี รายงานมาตรฐาน e-Tax · 1 แอปเชื่อมต่อ'],
  ['Business', '[x,xxx]', '3 · 10', '[x,xxx] · [xxx]', 'สูตรลงบัญชี มิติ รูปแบบงบ สายอนุมัติ เช็ค เงินสดย่อย API ไม่จำกัด Audit'],
  ['Business — สำนักงานบัญชี', '[x,xxx] + [xxx]/บริษัทลูกค้า', '25 · 15', '[xxx] · [xxx]', 'Business + มุมมองรวมกลุ่ม + สิทธิ์ผู้ทำบัญชีข้ามบริษัท'],
  ['Enterprise', 'สัญญา', 'ไม่จำกัด', 'ตามสัญญา', 'DB แยก SSO SLA 99.9% งบรวม ผู้ดูแลเฉพาะ'],
  ['Add-on: TMS Pro', '[x,xxx]/องค์กร', '—', 'ที่นั่งนับรวมกับบัญชี', 'เปิดแอป TMS · ใบแจ้งหนี้เดียวกัน (one platform)'],
];
const input = (label: string) => <label style={css(ST.label)}>{label}<input disabled value="" style={css(ST.input)} /></label>;

export default function BillingPage() {
  return (
    <Shell active="billing" crumb="Innovera Console / Subscription & billing" status={<P2 />}>
      <div style={css(ST.content)}>
        <Title h1="Subscription & billing" sub="แผน ราคา สถานะการสมัคร ใบแจ้งหนี้ของ Innovera ที่ออกให้ลูกค้า และการปรับลิมิตด้วยมือ" />
        <section style={css('border: 1px dashed #a56eff; padding: 12px 16px; font-size: 13px; color: #525252; display: flex; flex-direction: column; gap: 4px')}>
          <span><P2>Phase 2 · Subscription</P2> <strong style={css('color: #161616')}>หน้านี้ทั้งหน้าคือ Phase 2</strong></span>
          <span>v1 ไม่เก็บเงินในระบบ — ทุกองค์กรใหม่เป็น trial 30 วัน แล้วทีม Innovera ตั้งสถานะ active/แผน/ลิมิตให้ด้วยมือจากหน้านี้ (manual billing) · Phase 2 ผูกเกตเวย์ (Omise / 2C2P — ยังไม่เลือก), ออกใบกำกับภาษีอัตโนมัติ, dunning อัตโนมัติ</span>
        </section>
        <Stats>
          <Stat label="MRR" value={DASH} note="บาท" />
          <Stat label="ARR" value={DASH} note="บาท" />
          <Stat label="ใบแจ้งหนี้เดือนนี้" value={DASH} note={`ชำระแล้ว ${DASH} · ค้าง ${DASH} · รอออก ${DASH}`} />
          <Stat label="trial → paid (90 วัน)" value={DASH} note={`${DASH} / ${DASH}`} />
          <Stat label="churn (เดือน)" value={DASH} note={`${DASH} องค์กร`} />
        </Stats>
        <Tabs selected={0} tabs={['แผนและราคา', `Subscriptions (${DASH})`, 'ใบแจ้งหนี้ / ใบกำกับภาษี', 'ค้างชำระ (dunning)', 'โปรโมชัน / เครดิต']} />
        {/* ราคาในแบบร่างเป็นตัวยึดตำแหน่ง [x,xxx] อยู่แล้ว · ลิมิตของแผนตามแบบร่าง (Business 3 · 10 ตรงกับ public.plan) */}
        <section style={css(ST.tableBox)}><table style={css(ST.table(1100))}>
          <thead><tr style={css(ST.theadRow)}>{['แผน', 'ราคา/บริษัท/เดือน', 'รวมบริษัท · ที่นั่ง', 'บริษัทเพิ่ม · ที่นั่งเพิ่ม', 'ฟีเจอร์หลัก', 'องค์กรที่ใช้', ''].map((h, i) => <th key={i} style={css(ST.th)}>{h}</th>)}</tr></thead>
          <tbody>
            {PLANS.map(([name, price, inc, extra, feat]) => (
              <tr key={name} style={css(ST.tr)}>
                <td style={css(ST.td1)}><strong>{name}</strong></td><td style={css(ST.td)}>{price}</td><td style={css(ST.td)}>{inc}</td><td style={css(ST.td)}>{extra}</td><td style={css(ST.td)}>{feat}</td>
                <td style={css(ST.td)}>{DASH}</td><td style={css(ST.td)}><Inert kind="ghostSm">แก้ไข</Inert></td>
              </tr>
            ))}
          </tbody>
        </table></section>
        <div style={css(ST.grid2)}>
          <Card title="ปรับ subscription ด้วยมือ (v1 ใช้จริง)">
            {input('องค์กร')}
            <div style={css('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px')}>
              <label style={css(ST.label)}>แผน<select disabled style={css(ST.input)}><option>Business</option><option>Starter</option><option>Enterprise</option></select></label>
              <label style={css(ST.label)}>สถานะ<select disabled style={css(ST.input)}><option>active</option><option>trialing</option><option>past_due</option><option>suspended</option><option>canceled</option></select></label>
              {input('ต่ออายุ')}{input('ลิมิตบริษัท')}{input('ลิมิตที่นั่ง')}{input('ส่วนลด')}
            </div>
            {input('เหตุผล (บันทึก Audit · แจ้ง Owner ลูกค้า)')}
            <div style={css('display: flex; justify-content: flex-end; gap: 8px')}>
              <Inert kind="secondary">ยกเลิก</Inert>
              <button type="button" disabled style={css(B.primary)}>บันทึกและออกใบแจ้งหนี้เพิ่ม</button>
            </div>
          </Card>
          <div style={css('display: flex; flex-direction: column; gap: 16px')}>
            <Card title="ค้างชำระ · dunning">
              <Row left={DASH} />
              <Note>กำหนด: วันที่ 0 แจ้ง · 7 เตือน · 14 อ่านอย่างเดียว · 30 ระงับ · 120 ลบ (แจ้งล่วงหน้า 30 วัน)</Note>
            </Card>
            <Card title="เกตเวย์และใบกำกับภาษี">
              <Row left="เกตเวย์" right={<>Omise / 2C2P — <span style={css('color: #684e00')}>รอตัดสินใจ</span></>} />
              <Row left="ใบกำกับภาษีให้ลูกค้า" right="ออกจากระบบบัญชีของ Innovera เอง (dogfood) · e-Tax" />
              <Row left="สกุลเงิน" right="THB เท่านั้น · รายปี/รายเดือน" />
              <Row left="ภาษีหัก ณ ที่จ่ายจากลูกค้า" right="ลูกค้านิติบุคคลหัก 3% — รองรับอัปโหลด 50 ทวิ" />
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
