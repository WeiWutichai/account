// ScreenOrgMembers.dc.html — องค์กรและสมาชิก (/org?id=…)
import { ButtonLink, css } from '@innovera/ui';
import { dmy } from '../lib/fmt';
import { ACCOUNTING_WEB } from '../lib/id';
import { IdPage, one, Phase2, T, type SearchParams } from '../lib/ui';
import { loadOrg } from './data';
import { OrgTabs } from './OrgMembers';

export const metadata = { title: 'องค์กรและสมาชิก — Innovera ID' };

const STAT_LABEL = 'color: #525252; font-size: 13px';
const ROLE_ROW = 'display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-top: 1px solid #e0e0e0';
const ROLE_NOTE = 'color: #525252; text-align: right';

export default async function OrgPage({ searchParams }: { searchParams: SearchParams }) {
  const id = one((await searchParams).id);
  const self = id ? `/org?id=${encodeURIComponent(id)}` : '/org';
  const r = await loadOrg(id, self);
  if (!r.ok) return <IdPage self={self} maxWidth={1280}><p role="alert" style={css(T.error)}>{r.error}</p></IdPage>;
  const o = r.data;
  const sub = o.subscription;
  const seatLimit = sub?.seatLimit ?? null;
  const pct = seatLimit ? Math.min(100, Math.round((o.seats.used / seatLimit) * 100)) : 0;
  const full = sub?.companyLimit != null && o.companies.length >= sub.companyLimit;
  const right = <span style={css(T.headRight)}>{o.org.name} · <a href="/me" style={css(T.headLink)}>บัญชีของฉัน</a> · <a href={`${ACCOUNTING_WEB}/companies`} style={css(T.headLink)}>เลือกบริษัท</a></span>;
  // TODO(Wei): ฟอร์มเชิญไม่อยู่ในแบบร่างนี้ (คำเชิญผูกกับบริษัท) → ไปหน้า "ผู้ใช้และสิทธิ์" ของบริษัท (ScreenUsers) ที่มีปุ่มเชิญ
  const inviteHref = `${ACCOUNTING_WEB}/settings/users`;

  return (
    <IdPage self={self} maxWidth={1280} right={right}>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px')}><div><h1 style={css(T.h1)}>องค์กร {o.org.name} — สมาชิกและการเข้าถึง</h1><span style={css(T.sub)}>ระดับองค์กร: ใครอยู่ในองค์กร เข้าถึงบริษัทไหน · สิทธิ์ละเอียดรายบริษัทแก้ที่ &quot;ผู้ใช้และสิทธิ์&quot; ของบริษัทนั้น</span></div>
        <div style={css('display: flex; gap: 8px')}><ButtonLink href={inviteHref} kind="secondary">เชิญผู้สอบบัญชี (ไม่นับที่นั่ง)</ButtonLink><ButtonLink href={inviteHref} kind="primary">+ เชิญสมาชิก</ButtonLink></div></div>
      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px 24px; font-size: 14px')}>
        <div><span style={css(STAT_LABEL)}>ที่นั่งที่ใช้</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{o.seats.used} <span style={css('font-size: 14px; font-weight: 400; color: #525252')}>/ {seatLimit ?? '—'}</span></div><div style={css('height: 4px; background: #e0e0e0; margin-top: 4px')}><div style={css(`width: ${pct}%; height: 4px; background: #0f62fe`)} /></div><span style={css(T.sub)}>{o.seats.pending > 0 ? `+${o.seats.pending} รอตอบรับ · ` : ''}ผู้สอบบัญชีไม่นับ</span></div>
        <div><span style={css(STAT_LABEL)}>บริษัทในองค์กร</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{o.companies.length} <span style={css('font-size: 14px; font-weight: 400; color: #525252')}>/ {sub?.companyLimit ?? '—'}</span></div>{full && <span style={css('font-size: 13px; color: #684e00')}>เต็ม — บริษัทถัดไปคิดเพิ่ม</span>}</div>
        {/* TODO(Wei)/M7: ยังไม่มีข้อมูลแอปต่อองค์กร (เปิด/ปิดแอปเป็น Phase 2) — v1 มีระบบบัญชีแอปเดียว · แบบร่างแสดง "ระบบบัญชี · TMS" */}
        <div><span style={css(STAT_LABEL)}>แอปที่เปิดใช้</span><div style={css('font-size: 16px; font-weight: 600')}>ระบบบัญชี</div><span style={css(T.sub)}>ที่นั่งนับรวมทุกแอป (1 คน = 1 ที่นั่ง)</span></div>
        <div><span style={css(STAT_LABEL)}>การสมัครใช้งาน</span><div style={css('font-size: 16px; font-weight: 600')}>{sub ? `${sub.planName} · ${sub.status}` : '—'}</div><span style={css(T.sub)}>{sub?.renewsAt ? `ต่ออายุ ${dmy(sub.renewsAt)} · ` : ''}<a href={`/org/plan?id=${o.org.id}`} style={css(T.link)}>แผนและบิล</a></span></div>
        {/* TODO(Wei): แบบร่างมีแต่กรณี "2FA บังคับ" */}
        <div><span style={css(STAT_LABEL)}>นโยบายความปลอดภัย</span><div style={css('font-size: 16px; font-weight: 600')}>{o.org.policy.require_2fa ? '2FA บังคับ' : '2FA ไม่บังคับ'} · เซสชัน {o.org.policy.session_hours} ชม.</div><span style={css(T.sub)}>SSO (SAML): <span style={css('color: #684e00')}>Enterprise เท่านั้น</span></span></div>
      </section>
      <OrgTabs org={o} meId={r.me.id} accountingWeb={ACCOUNTING_WEB} />
      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px; align-items: start')}>
        <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>บทบาทระดับองค์กร (แยกจากบทบาทในบริษัท)</strong>
          <div style={css(ROLE_ROW)}><span><strong>Owner</strong></span><span style={css(ROLE_NOTE)}>ทุกอย่าง · สร้าง/ปิดบริษัท · โอนความเป็นเจ้าของ · ต้องมีอย่างน้อย 1 คน</span></div>
          <div style={css(ROLE_ROW)}><span><strong>Admin</strong></span><span style={css(ROLE_NOTE)}>เชิญ/ถอดสมาชิก · กำหนดสิทธิ์รายบริษัท · นโยบายความปลอดภัย</span></div>
          <div style={css(ROLE_ROW)}><span><strong>Billing admin</strong> <Phase2 /></span><span style={css(ROLE_NOTE)}>แผน · วิธีชำระ · ใบแจ้งหนี้ · ที่นั่ง — ไม่เห็นข้อมูลบัญชีของบริษัท</span></div>
          <div style={css(ROLE_ROW)}><span><strong>Member</strong></span><span style={css(ROLE_NOTE)}>เข้าได้เฉพาะบริษัทที่ได้รับมอบหมาย ตามบทบาทในบริษัท</span></div>
          <div style={css(ROLE_ROW)}><span><strong>Guest</strong></span><span style={css(ROLE_NOTE)}>ภายนอก (ผู้สอบบัญชี/ที่ปรึกษา) · มีวันหมดอายุ · ไม่นับที่นั่ง</span></div>
        </section>
        <section style={css('border: 1px dashed #a56eff; background: #ffffff; padding: 16px 24px; font-size: 13px; color: #525252; display: flex; flex-direction: column; gap: 8px')}><span><Phase2>Phase 2 · Subscription</Phase2> <strong style={css('color: #161616; font-size: 14px')}>จุดเชื่อมที่เตรียมไว้ใน v1</strong></span>
          <span>· <strong style={css('color: #161616')}>ที่นั่ง (seat)</strong>: 1 Innovera ID ที่ active ในองค์กร = 1 ที่นั่ง นับรวมทุกแอป · Guest ไม่นับ · คำเชิญที่รอตอบรับจองที่นั่งไว้</span>
          <span>· <strong style={css('color: #161616')}>Entitlement</strong>: ทุกหน้าถาม <code>org.entitlements</code> (company_limit, seat_limit, features[]) ก่อนทำ — v1 คืนค่าจากแผน Business คงที่ · Phase 2 ดึงจากตาราง subscription</span>
          <span>· <strong style={css('color: #161616')}>สถานะการสมัคร</strong> trialing → active → past_due → suspended → canceled · past_due = อ่านอย่างเดียว 30 วัน (ยังส่งออก/ยื่นภาษีได้)</span>
          <span>· <strong style={css('color: #161616')}>เหตุการณ์</strong> seat.limit_reached, trial.ending(7d), subscription.past_due → แจ้ง Owner/Billing admin ทางอีเมล + คิวหน้าแรก</span>
          <span>· <strong style={css('color: #161616')}>แอปต่อองค์กร</strong>: เปิด/ปิดแอป (ระบบบัญชี, TMS, …) ต่อองค์กร ราคาต่อแอป รวมใบแจ้งหนี้เดียว (one platform)</span>
        </section>
      </div>
    </IdPage>
  );
}
