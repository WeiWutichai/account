// ยืนยันอีเมล (ScreenSignup ขั้น 2 "ยืนยันอีเมล") — /verify-email
// TODO(Wei) T7: แบบร่างไม่มีหน้ายืนยันอีเมล → ใช้โครงการ์ดกรอกรหัสของ ScreenTwoFactor.dc.html + ข้อความของ ScreenSignup.dc.html
import { css } from '@innovera/ui';
import { safeNext } from '../lib/id';
import { IdPage, one, SignupSteps, T, withNext, type SearchParams } from '../lib/ui';
import { VerifyEmail } from './VerifyEmail';

export const metadata = { title: 'ยืนยันอีเมล — Innovera ID' };

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = one(sp.next);
  return (
    <IdPage self="/verify-email" maxWidth={960} right={<a href={withNext('/login', next)} style={css(T.headLink)}>ใช้บัญชีอื่น</a>}>
      <SignupSteps active={2} />
      <VerifyEmail next={next} dest={safeNext(next)} />
    </IdPage>
  );
}
