// ScreenPasswordReset.dc.html — ลืมรหัสผ่าน (ขั้น 1–2: /password/reset) · ตั้งรหัสผ่านใหม่ (ขั้น 3: /password/reset?token=… จากลิงก์ในอีเมล)
// TODO(Wei): แบบร่างวางสามการ์ดเรียงกัน (grid 3 คอลัมน์) เพื่อแสดงทุกขั้น — ในระบบแสดงทีละขั้น กึ่งกลางหน้า
import { css } from '@innovera/ui';
import { safeNext } from '../../lib/id';
import { IdPage, one, T, withNext, type SearchParams } from '../../lib/ui';
import { ForgotPassword, NewPassword } from './PasswordReset';

export const metadata = { title: 'ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่ — Innovera ID' };

export default async function PasswordResetPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = one(sp.next);
  const token = one(sp.token);
  return (
    <IdPage self="/password/reset" maxWidth={1280} right={<a href={withNext('/login', next)} style={css(T.headLink)}>เข้าสู่ระบบ</a>}>
      {token ? <NewPassword token={token} next={next} dest={safeNext(next)} /> : <ForgotPassword next={next} />}
    </IdPage>
  );
}
