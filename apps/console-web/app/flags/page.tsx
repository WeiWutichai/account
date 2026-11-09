// X5 แอปและ feature flags ← design/project/ConsoleFlags.dc.html
import { css } from '@innovera/ui';
import { Shell } from '../Shell';
import { Card, DASH, Note, Row, ST, Tag, Title } from '../ui';
import { getFlags, getMe, getOverview } from '../lib/data';
import { FlagsTable } from './FlagsTable';

export default async function FlagsPage() {
  const [flags, me, o] = await Promise.all([getFlags(), getMe(), getOverview()]);
  return (
    // TODO(backend): ขั้นการปล่อย (canary/beta/%) ไม่มีในตาราง feature_flag — ป้าย "N flag กำลังขยาย" แสดง "—"
    <Shell active="flags" crumb="Innovera Console / แอปและ feature flags" status={<Tag tone="info">{DASH} flag กำลังขยาย</Tag>}>
      <div style={css(ST.content)}>
        <Title h1="แอปและ feature flags" sub="เปิด/ปิดความสามารถต่อองค์กรหรือทั้งระบบ ปล่อยเป็นขั้น และย้อนกลับได้ทันที" />
        <FlagsTable flags={flags} orgs={o.counts.orgs} canEdit={me.role === 'engineer' || me.role === 'admin'} />
        <div style={css(ST.grid2)}>
          {/* TODO(backend): เวอร์ชันแอปและจำนวนองค์กรที่เปิดแต่ละแอป (entitlement) ยังไม่มีใน API */}
          <Card title="แอปในแพลตฟอร์ม (เปิด/ปิดต่อองค์กร)">
            <Row left={<><strong>ระบบบัญชี AccountSystem</strong> · {DASH}</>} right={`${DASH} องค์กร · แอปหลัก (hub)`} />
            <Row left={<><strong>TMS</strong> · {DASH}</>} right={`${DASH} องค์กร · เชื่อมบัญชีด้วย OAuth คลิกเดียว`} />
            <Row left={<strong>HR / Payroll</strong>} right="แผนงาน 2570 · จะส่ง JV เงินเดือนเข้าบัญชี" />
            <Row left={<strong>CRM</strong>} right="แนวคิด · ซิงก์คู่ค้าตามเลขผู้เสียภาษี" />
            <Note>การเปิดแอปต่อองค์กรผูกกับ entitlement ของแผน (Phase 2 คิดราคาต่อแอปในใบแจ้งหนี้เดียว)</Note>
          </Card>
          <Card title="กฎการปล่อยฟีเจอร์">
            <Row left="ลำดับ" right="internal → canary (≤5 องค์กรที่ยินยอม) → beta (รายชื่อ) → % → 100%" />
            <Row left="ย้อนกลับ" right="ปิด flag ได้ทันทีทุกขั้น · ไม่ต้อง deploy" />
            <Row left="ฟีเจอร์ที่กระทบบัญชี/ภาษี" right="ต้องผ่านผู้สอบบัญชีที่ปรึกษาก่อน beta" />
            <Row left="แจ้งลูกค้า" right="ประกาศในคิวหน้าแรก + เอกสารช่วยเหลือ ก่อนปล่อย ≥ 7 วัน" />
          </Card>
        </div>
      </div>
    </Shell>
  );
}
