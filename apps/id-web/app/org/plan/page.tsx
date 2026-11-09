// ScreenPlan.dc.html — แผนและการเรียกเก็บเงิน (/org/plan?id=…) · แสดงอย่างเดียว (ชำระเงิน/เปลี่ยนแผน = Phase 2)
import { Button, css } from '@innovera/ui';
import { dmy } from '../../lib/fmt';
import { ACCOUNTING_WEB } from '../../lib/id';
import { IdHeader, IdPage, one, T, type SearchParams } from '../../lib/ui';
import { loadOrg } from '../data';

export const metadata = { title: 'แผนและการเรียกเก็บเงิน — Innovera ID' };

const LBL = 'color: #525252; font-size: 13px';
const BIG = 'font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums';
const CARD = (current: boolean) => `background: #ffffff; border: ${current ? '2px solid #0f62fe' : '1px solid #e0e0e0'}; padding: 24px; display: flex; flex-direction: column; gap: 12px; font-size: 14px`;
const LIST = 'margin: 0; padding: 0 0 0 16px; color: #525252; display: flex; flex-direction: column; gap: 4px';
const PRICE = 'font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums';
const UNIT = 'font-size: 13px; color: #525252; font-weight: 400';
const TH = 'padding: 0 12px; font-weight: 400';

/** แผนเปรียบเทียบ — ข้อความตามแบบร่าง ("ราคาเป็นตัวอย่างสำหรับออกแบบ (ยังไม่สรุป)") · TODO(Wei)/Phase 2: ราคาและรายการจริงจากตาราง plan */
const PLANS = [
  { code: 'starter', name: 'Starter', who: 'เจ้าของทำเอง / สำนักงานบัญชีดูแล', price: '[x,xxx]', items: ['1 บริษัท · 2 ที่นั่ง', 'ขาย ซื้อ การเงิน ภาษี รายงานมาตรฐาน', 'e-Tax Invoice', 'เชื่อม 1 แอป Innovera'], action: 'ลดระดับ' },
  { code: 'business', name: 'Business', who: 'SME หลายบริษัท มีทีมบัญชี', price: '[x,xxx]', items: ['3 บริษัท · 10 ที่นั่ง (เพิ่มได้)', 'ทุกอย่างใน Starter + สูตรลงบัญชีกำหนดเอง, มิติ, รูปแบบงบ 18 คอลัมน์', 'สายอนุมัติ, เช็ค, เงินสดย่อย, กระทบยอดอัตโนมัติ', 'API / webhook ไม่จำกัดแอป', 'Audit log + มุมมองรวมกลุ่ม'], action: 'เพิ่มบริษัท / ที่นั่ง' },
  { code: 'enterprise', name: 'Enterprise', who: 'กลุ่มบริษัท / ต้องการแยกฐานข้อมูล', price: null, items: ['ฐานข้อมูลแยกต่อบริษัท (DB-per-tenant)', 'SSO (SAML) · นโยบายรหัสผ่าน · IP allowlist', 'SLA 99.9% · สำรองข้อมูลข้ามภูมิภาค', 'งบรวม (consolidation) หลายบริษัท', 'ผู้จัดการบัญชีลูกค้าเฉพาะ'], action: 'คุยกับทีมขาย' },
];

export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const id = one((await searchParams).id);
  const self = id ? `/org/plan?id=${encodeURIComponent(id)}` : '/org/plan';
  const r = await loadOrg(id, self);
  const back = <a href={`${ACCOUNTING_WEB}/companies`} style={css(T.headLink)}>← กลับ</a>;
  if (!r.ok) return <IdPage self={self} maxWidth={1040} footer={false} header={<IdHeader brand="Innovera" tagline="Accounting" right={back} />}><p role="alert" style={css(T.error)}>{r.error}</p></IdPage>;
  const o = r.data;
  const sub = o.subscription;
  const full = sub?.companyLimit != null && o.companies.length >= sub.companyLimit;

  return (
    <IdPage self={self} maxWidth={1040} footer={false} header={<IdHeader brand="Innovera" tagline={`Accounting · องค์กร ${o.org.name}`} right={back} />}>
      <div><h1 style={css(T.h1)}>แผนและการเรียกเก็บเงิน</h1><span style={css(T.sub)}>ระดับองค์กร · คิดตามจำนวนบริษัทและที่นั่ง · แอป Innovera อื่นที่องค์กรใช้แสดงในใบแจ้งหนี้เดียวกัน (one platform)</span></div>
      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; font-size: 14px')}>
        {/* TODO(Wei)/Phase 2: รอบบิล (รายปี/รายเดือน) ยังไม่มีในข้อมูล subscription — ใช้ข้อความตามแบบร่าง */}
        <div><span style={css(LBL)}>แผนปัจจุบัน</span><div style={css('font-size: 20px; font-weight: 600')}>{sub?.planName ?? '—'}</div><span style={css('color: #525252')}>{sub?.renewsAt ? `ต่ออายุรายปี · ${dmy(sub.renewsAt)}` : '—'}</span></div>
        <div><span style={css(LBL)}>บริษัท</span><div style={css(BIG)}>{o.companies.length} / {sub?.companyLimit ?? '—'}</div>{full && <span style={css('color: #684e00')}>เต็ม — บริษัทที่ {(sub?.companyLimit ?? 0) + 1} คิดเพิ่ม</span>}</div>
        <div><span style={css(LBL)}>ที่นั่งผู้ใช้</span><div style={css(BIG)}>{o.seats.used} / {sub?.seatLimit ?? '—'}</div><span style={css('color: #525252')}>ผู้สอบบัญชีไม่นับ</span></div>
        {/* TODO(Wei): ยังไม่มีตัวนับเอกสาร/เดือนรวมทุกบริษัท (ข้อมูลอยู่ในตารางบัญชีแยกบริษัท · id-api อ่านไม่ได้) */}
        <div><span style={css(LBL)}>เอกสาร/เดือน (API รวม)</span><div style={css(BIG)}>—</div><span style={css('color: #525252')}>ไม่จำกัด</span></div>
        {/* TODO(Phase 2): วิธีชำระ (ผูกบัตร) — ยังไม่มีข้อมูล */}
        <div><span style={css(LBL)}>วิธีชำระ</span><div style={css('font-size: 16px; font-weight: 600')}>—</div><span style={css('color: #525252')}><a href={self} style={css(T.link)}>เปลี่ยน</a> · ใบกำกับภาษีออกในนาม {o.org.name}</span></div>
      </section>
      <div style={css(T.sub)}>เปรียบเทียบแผน — ราคาเป็นตัวอย่างสำหรับออกแบบ (ยังไม่สรุป)</div>
      <section style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px')}>
        {PLANS.map((p) => {
          const current = sub?.plan === p.code;
          return (
            <div key={p.code} style={css(CARD(current))}>
              <div>{current
                ? <div style={css('font-weight: 600; font-size: 16px; display: flex; justify-content: space-between')}>{p.name} <span style={css('font-size: 12px; background: #0f62fe; color: #ffffff; padding: 0 8px; border-radius: 4px; height: 20px; display: inline-flex; align-items: center')}>ปัจจุบัน</span></div>
                : <div style={css('font-weight: 600; font-size: 16px')}>{p.name}</div>}<div style={css('color: #525252; font-size: 13px')}>{p.who}</div></div>
              {p.price ? <div style={css(PRICE)}>{p.price} <span style={css(UNIT)}>บาท/บริษัท/เดือน</span></div> : <div style={css('font-size: 24px; font-weight: 600')}>ติดต่อ</div>}
              <ul style={css(LIST)}>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
              {/* TODO(Phase 2): เปลี่ยนแผน/ซื้อเพิ่ม — แสดงตามแบบร่าง ยังไม่ทำงาน */}
              <Button kind="secondary" size={36} extra="margin-top: auto">{p.action}</Button>
            </div>
          );
        })}
      </section>
      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; overflow-x: auto')}>
        <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>ประวัติใบแจ้งหนี้</strong><a href={`${ACCOUNTING_WEB}/settings/documents`} style={css('font-size: 14px; text-decoration: none')}>ตั้งค่าใบกำกับภาษี / ที่อยู่ออกบิล</a></div>
        <table style={css('width: 100%; min-width: 720px; border-collapse: collapse; font-size: 14px; line-height: 20px')}><thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>วันที่</th><th style={css(TH)}>เลขที่</th><th style={css(TH)}>รายการ</th><th style={css(`${TH}; text-align: right`)}>จำนวนเงิน</th><th style={css(TH)}>สถานะ</th><th style={css(TH)}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>ใบกำกับ</span></th></tr></thead>
          {/* TODO(Phase 2): ใบแจ้งหนี้ของ Innovera (billing) ยังไม่มีใน v1 — ไม่มีแถว */}
          <tbody />
        </table>
      </section>
      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 13px; color: #525252')}>เมื่อหมดอายุหรือค้างชำระ: ระบบเข้าโหมดอ่านอย่างเดียว 30 วัน (ยังส่งออกข้อมูล/ยื่นภาษีได้) จากนั้นระงับ และเก็บข้อมูลอีก 90 วันก่อนลบถาวร · ยกเลิกเมื่อไหร่ก็ได้ ส่งออกข้อมูลทั้งหมดเป็น Excel/CSV + PDF เอกสารทุกใบ</section>
    </IdPage>
  );
}
