// B1 ผังบัญชี — design/project/ScreenCOA.dc.html
import { S, TopBar, css } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { CoaView, type AccountRow } from './view';

export default async function AccountsPage() {
  const { year, period } = await currentPeriod();
  const rows = await api<AccountRow[]>(`/v1/accounts?year=${year}&period=${period}`);
  return (
    <Shell active="coa">
      <TopBar crumb="บัญชี / ผังบัญชี" right={<span style={css('color: #525252')}>{rows.length} บัญชี · template ธุรกิจบริการ</span>} />
      <div style={css(S.content)}>
        <CoaView rows={rows} periodLabel={`${period}/${year}`} year={year} period={period} />
        <p style={css(S.note)}>บัญชีที่มีรายการแล้วเปลี่ยนประเภทไม่ได้และลบไม่ได้ ทำได้เพียงปิดใช้ · บัญชีคุม (ลูกหนี้/เจ้าหนี้) เลือกลงรายวันตรงๆ ไม่ได้ ต้องผ่านเอกสารที่ระบุคู่ค้า</p>
      </div>
    </Shell>
  );
}
