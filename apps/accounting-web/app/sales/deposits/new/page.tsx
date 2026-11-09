// ใบแจ้งหนี้มัดจำใหม่ — ScreenDeposit.dc.html ปุ่ม "+ ใบแจ้งหนี้มัดจำ"
// TODO(Wei): ไม่มีแบบร่างฟอร์ม DP → ใช้รูปแบบ ScreenInvoice.dc.html (Sidebar active="deposit")
import { Shell } from '../../../lib/shell';
import { InvoiceForm } from '../../_lib/InvoiceForm';
import { accountNames, formBase } from '../../_lib/server';

export default async function NewDepositPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const b = await formBase();
  return (
    <Shell active="deposit">
      <InvoiceForm mode="DP" detail={null} contacts={b.contacts} accounts={b.accounts} rules={b.rules} names={accountNames(b.accounts)} today={b.today} {...(sp.contact ? { presetContact: sp.contact } : {})} />
    </Shell>
  );
}
