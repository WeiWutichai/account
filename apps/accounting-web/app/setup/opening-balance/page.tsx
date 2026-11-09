// A4 ยอดยกมา — design/project/ScreenOpeningBalance.dc.html (ขั้น 3 ของตัวช่วยตั้งค่าบริษัท · ไม่มี Sidebar ตามแบบร่าง)
import { css, href } from '@innovera/ui';
import { api, type Context } from '../../lib/api';
import { OpeningGrid, type Opening, type AccountLite } from './grid';

export default async function OpeningBalancePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  // ปีบัญชีของยอดยกมา: ระบุใน ?year หรือให้ API เลือกปีที่เริ่มใช้ระบบ (บริษัทใหม่จาก ScreenCompanyCreate)
  const [ctx, opening] = await Promise.all([api<Context>('/v1/context'), api<Opening & { year: number }>(`/v1/opening${sp.year ? `?year=${sp.year}` : ''}`)]);
  const year = opening.year;
  const accounts = await api<AccountLite[]>(`/v1/accounts?year=${year}&period=1`);
  return (
    <div style={css("min-height: 1000px; background: #f4f4f4; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; display: flex; flex-direction: column")}>
      <header style={css('height: 48px; background: #161616; color: #f4f4f4; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; font-size: 14px')}>
        <div style={css('display: flex; align-items: center; gap: 12px')}><span style={css('width: 24px; height: 24px; background: #0f62fe; display: inline-block')} /><span style={css('font-weight: 600')}>Innovera</span><span style={css('color: #a8a8a8')}>Accounting · ตั้งค่า {ctx.name}</span></div>
        <a href={href('companies')} style={css('color: #c6c6c6; text-decoration: none')}>ทำต่อทีหลัง</a>
      </header>
      <OpeningGrid year={year} opening={opening} accounts={accounts} />
    </div>
  );
}
