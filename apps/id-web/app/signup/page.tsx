// ScreenSignup.dc.html — สมัครใช้งาน (/signup) · มาจากคำเชิญ: ?email=…&next=/invite/<token> → ล็อกช่องอีเมล (ScreenInviteAccept "กรณีอื่นของลิงก์คำเชิญ")
import { css } from '@innovera/ui';
import { safeNext } from '../lib/id';
import { IdPage, one, Phase2, SignupSteps, T, withNext, type SearchParams } from '../lib/ui';
import { SignupForm } from './SignupForm';

export const metadata = { title: 'สมัครใช้งาน — Innovera ID' };

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = one(sp.next);
  return (
    <IdPage self="/signup" maxWidth={960} right={<a href={withNext('/login', next)} style={css(T.headLink)}>เข้าสู่ระบบ</a>}>
      <SignupSteps active={1} />
      <SignupForm next={next} dest={safeNext(next)} lockedEmail={one(sp.email)} />
      <section style={css(T.phase2Box)}>
        <span><Phase2>Phase 2 · Subscription</Phase2> <strong style={css('color: #161616')}>ขั้นที่ 4 &quot;เลือกแผน&quot;</strong></span>
        <span>v1 ข้ามขั้นนี้ — ทุกองค์กรใหม่ได้ trial 30 วัน แผน Business อัตโนมัติ · Phase 2 จะเปิดเลือกแผน/จำนวนบริษัท/ที่นั่ง และผูกบัตรที่ขั้นนี้ · ฟิลด์ที่เตรียมไว้ใน data model: <code>subscription.status (trialing/active/past_due/canceled)</code>, <code>trial_ends_at</code>, <code>plan_id</code>, <code>seat_limit</code>, <code>company_limit</code></span>
      </section>
    </IdPage>
  );
}
