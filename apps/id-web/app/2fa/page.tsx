// ScreenTwoFactor.dc.html — ยืนยันตัวตน 2 ชั้น (/2fa?stage=mfa) และ "ครั้งแรก / เปิดใช้งาน" ตั้งค่า 2FA (/2fa?stage=setup)
// TODO(Wei): แบบร่างวางสองการ์ดคู่กัน (grid 2 คอลัมน์) เพื่อแสดงทั้งสองสถานะ — ในระบบแสดงทีละการ์ดตามขั้นที่ id-api ตอบ (mfa | setup) กึ่งกลางหน้า
import { css } from '@innovera/ui';
import { safeNext } from '../lib/id';
import { IdPage, one, T, withNext, type SearchParams } from '../lib/ui';
import { MfaCard, SetupCard } from './TwoFactor';

export const metadata = { title: 'ยืนยันตัวตน 2 ชั้น — Innovera ID' };

export default async function TwoFactorPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = one(sp.next);
  const stage = one(sp.stage) === 'setup' ? 'setup' : 'mfa';
  return (
    <IdPage self="/2fa" maxWidth={980} right={<a href={withNext('/login', next)} style={css(T.headLink)}>ใช้บัญชีอื่น</a>}>
      {stage === 'setup' ? <SetupCard next={next} dest={safeNext(next)} /> : <MfaCard next={next} dest={safeNext(next)} trustDefault={one(sp.trust) !== '0'} />}
    </IdPage>
  );
}
