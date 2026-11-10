// F3 จ่ายชำระ — รอบจ่ายใหม่ · design/project/ScreenPayment.dc.html (บิลค้างจ่ายเรียงตามครบกำหนด → เลือก → PV 1 ใบต่อผู้ขาย → สายอนุมัติ)
import { api } from '../../lib/api';
import { p2aData } from '../../_p2a/server';
import { currentPeriod, Shell } from '../../lib/shell';
import { today, type Account } from '../_shared/types';
import { approvalSettings, payableRows } from './_data';
import { PaymentScreen } from './_screen';

export default async function PaymentRunPage() {
  const { year } = await currentPeriod();
  const [rows, accounts, limits, p2a] = await Promise.all([payableRows(), api<Account[]>(`/v1/accounts?year=${year}&period=13`), approvalSettings(), p2aData()]);
  return (
    <Shell active="payment">
      <PaymentScreen mode="new" today={today()} p2a={p2a} rows={rows} l2Limit={limits.payment.l2Limit} accountNames={Object.fromEntries(accounts.map((a) => [a.code, a.name]))} />
    </Shell>
  );
}
