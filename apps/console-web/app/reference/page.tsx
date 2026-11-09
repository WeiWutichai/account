// X6 ข้อมูลอ้างอิงกลาง ← design/project/ConsoleReference.dc.html
// TODO(backend): ยังไม่มีตาราง/endpoint ข้อมูลอ้างอิงกลางแบบมีเวอร์ชัน — แสดงโครงตามแบบร่าง ค่าเป็น "—" (ห้ามแสดงค่าตัวอย่างจากแบบร่างเหมือนค่าจริง)
// TODO(Wei): แถว "ประเภทเงินได้ฟรีแลนซ์พัฒนาซอฟต์แวร์" ในแบบร่างเขียน "ค่าตั้งต้น ม.40(2) 3%" แต่ CLAUDE.md (รอผู้สอบบัญชี) ระบุค่าตั้งต้นชั่วคราว = หักคงที่ 3% โดยประเภทเงินได้ 40(2)/40(8) ยังไม่ตัดสิน — Console ไม่ตัดสินแทน
import { css } from '@innovera/ui';
import { Shell } from '../Shell';
import { Card, DASH, Inert, Note, Row, ST, Tabs, Tag, Title } from '../ui';

const ITEMS = [
  'อัตราภาษีมูลค่าเพิ่ม',
  'อัตราหัก ณ ที่จ่ายมาตรฐาน',
  'ประเภทเงินได้ฟรีแลนซ์พัฒนาซอฟต์แวร์',
  'กำหนดยื่นแบบ (กระดาษ / ออนไลน์)',
  'วันหยุดราชการ (เลื่อนกำหนดยื่น)',
  'อัตราค่าเสื่อมราคาสูงสุดทางภาษี',
  'รูปแบบไฟล์ RD Prep / e-Filing',
  'ธนาคารและรูปแบบไฟล์โอน/statement',
];

export default function ReferencePage() {
  return (
    <Shell active="reference" crumb="Innovera Console / ข้อมูลอ้างอิงกลาง" status={<Tag tone="warning">{DASH} รายการรอตรวจ/ยืนยัน</Tag>}>
      <div style={css(ST.content)}>
        <Title h1="ข้อมูลอ้างอิงกลาง" sub="อัตราภาษี ปฏิทินยื่นแบบ ผังบัญชี/สูตร/แบบพิมพ์แม่แบบ — แก้ครั้งเดียวมีผลทุก tenant แบบมีเวอร์ชัน" />
        {/* TODO(Wei): เนื้อหาแท็บอื่นไม่มีในแบบร่าง · จำนวนในวงเล็บรอข้อมูลจริง */}
        <Tabs selected={0} tabs={['ภาษีและปฏิทินยื่นแบบ', `ผังบัญชีแม่แบบ (${DASH})`, `สูตรลงบัญชีแม่แบบ (${DASH})`, `แบบพิมพ์มาตรฐาน (${DASH})`, 'ธนาคาร / รูปแบบไฟล์']} />
        <section style={css(ST.tableBox)}><table style={css(ST.table(1100))}>
          <thead><tr style={css(ST.theadRow)}>{['รายการ', 'ค่าปัจจุบัน', 'มีผล', 'แหล่งอ้างอิง', 'สถานะ', ''].map((h, i) => <th key={i} style={css(ST.th)}>{h}</th>)}</tr></thead>
          <tbody>
            {ITEMS.map((x) => (
              <tr key={x} style={css(ST.tr)}>
                <td style={css(ST.td1)}>{x}</td><td style={css(ST.td)}>{DASH}</td><td style={css(ST.td)}>{DASH}</td><td style={css(ST.td)}>{DASH}</td><td style={css(ST.td)}>{DASH}</td>
                <td style={css(ST.td)}><Inert kind="ghostSm">แก้ไข</Inert></td>
              </tr>
            ))}
          </tbody>
        </table></section>
        <div style={css(ST.grid2)}>
          <Card title="การเปลี่ยนค่าอ้างอิงกลาง">
            <Row left="ผล" right="ทุก tenant ได้ค่าใหม่ตามวันที่มีผล · ค่าเดิมคงอยู่สำหรับเอกสารย้อนหลัง (versioned)" />
            <Row left="ก่อนเปลี่ยน" right="ต้องมีแหล่งอ้างอิง + ผู้สอบบัญชีที่ปรึกษารับรอง + ผู้อนุมัติ 2 คน" />
            <Row left="แจ้งลูกค้า" right="ประกาศในคิวหน้าแรก ≥ 7 วันก่อนมีผล · เว้นกรณีกฎหมายมีผลทันที" />
            <Row left="ลูกค้า override ได้ไหม" right={'ได้เฉพาะค่าที่ระบุว่า "ปรับต่อบริษัทได้" (เช่น อัตราหักเฉพาะคู่ค้า) · อัตรา VAT/กำหนดยื่น ไม่ได้'} />
          </Card>
          <Card title="แม่แบบที่แจกให้ tenant">
            <Row left="ผังบัญชี" right={`บริการ/ขนส่ง (${DASH}) · ซื้อมาขายไป (${DASH}) · DBD มาตรฐาน · เปล่า`} />
            <Row left="สูตรลงบัญชี" right={`${DASH} สูตร ครอบคลุมทุกประเภทเอกสาร · tenant คัดลอกไปแก้ได้`} />
            <Row left="รูปแบบงบ" right={`งบกำไรขาดทุน/ฐานะการเงิน ตาม DBD · ${DASH} แม่แบบวิเคราะห์`} />
            <Row left="แบบพิมพ์" right="D1–D15 · tenant ใส่โลโก้/ข้อความท้ายเอง" />
            <Note>เวอร์ชันแม่แบบบันทึกไว้ — tenant ที่คัดลอกไปแล้วจะได้รับแจ้งเมื่อมีเวอร์ชันใหม่ ไม่ถูกเขียนทับ</Note>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
