// F3 จ่ายชำระ — รอบจ่ายใหม่ · design/project/ScreenPayment.dc.html (บิลค้างจ่ายเรียงตามครบกำหนด → เลือก → PV 1 ใบต่อผู้ขาย → สายอนุมัติ)
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { today, type Account } from '../_shared/types';
import { payableRows } from './_data';
import { PaymentScreen } from './_screen';

export default async function PaymentRunPage() {
  const { year } = await currentPeriod();
  const [rows, accounts] = await Promise.all([payableRows(), api<Account[]>(`/v1/accounts?year=${year}&period=13`)]);
  return (
    <Shell active="payment">
      <PaymentScreen mode="new" today={today()} rows={rows} accountNames={Object.fromEntries(accounts.map((a) => [a.code, a.name]))} />
    </Shell>
  );
}
