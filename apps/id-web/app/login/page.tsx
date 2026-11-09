// ScreenLogin.dc.html — เข้าสู่ระบบ (/login)
import { css } from '@innovera/ui';
import { safeNext } from '../lib/id';
import { one, type SearchParams } from '../lib/ui';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'เข้าสู่ระบบ — Innovera ID' };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = one(sp.next);
  return (
    <div style={css("display: flex; flex-wrap: wrap; min-height: 1000px; background: #f4f4f4; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6")}>
      <aside style={css('flex: 1 1 480px; background: #161616; color: #f4f4f4; padding: 48px 56px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box')}>
        <div style={css('font-size: 14px; display: flex; align-items: center; gap: 12px')}><span style={css('width: 32px; height: 32px; background: #0f62fe; display: inline-block')} /><span style={css('font-weight: 600')}>Innovera</span><span style={css('color: #a8a8a8')}>Accounting</span></div>
        <div style={css('display: flex; flex-direction: column; gap: 24px; max-width: 480px')}>
          <h2 style={css('margin: 0; font-size: 32px; line-height: 40px; font-weight: 600')}>ระบบบัญชีที่เป็นศูนย์กลางของทุกแอปในองค์กร</h2>
          <p style={css('margin: 0; color: #c6c6c6')}>บัญชีเดียว หลายบริษัท · เชื่อมกับ TMS และแอป Innovera อื่นในคลิกเดียว · ยื่นภาษีออนไลน์ได้ทุกแบบ · เทียบเท่าหรือดีกว่าโปรแกรมบัญชีเดสก์ท็อปที่คุณคุ้นเคย</p>
          <ul style={css('margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: #c6c6c6')}><li>— ใบกำกับภาษี e-Tax, ภ.พ.30, ภ.ง.ด.3/53, 50 ทวิ ครบ</li><li>— สูตรลงบัญชีกำหนดเองได้ทุกเอกสาร</li><li>— งบตามรูปแบบที่กำหนดเอง 18 คอลัมน์ แยกตามโครงการ / สาขา</li><li>— กระทบยอดธนาคาร จับคู่อัตโนมัติ</li></ul>
        </div>
        <div style={css('font-size: 13px; color: #8d8d8d')}>© Innovera · ข้อมูลเก็บในประเทศไทย · ISO 27001 (อยู่ระหว่างดำเนินการ)</div>
      </aside>
      <main style={css('flex: 1 1 480px; display: flex; align-items: center; justify-content: center; padding: 48px 32px; box-sizing: border-box')}>
        <LoginForm next={next} dest={safeNext(next)} />
      </main>
    </div>
  );
}
