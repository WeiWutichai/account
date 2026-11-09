// S3 ใบกำกับภาษีใหม่ — design/project/ScreenInvoice.dc.html (Sidebar active="invoice") · ?contact=<id> เลือกลูกค้าไว้ก่อน
import { Shell } from '../../../lib/shell';
import { InvoiceForm } from '../../_lib/InvoiceForm';
import { accountNames, formBase } from '../../_lib/server';

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const b = await formBase();
  return (
    <Shell active="invoice">
      <InvoiceForm mode="IV" detail={null} contacts={b.contacts} accounts={b.accounts} rules={b.rules} names={accountNames(b.accounts)} today={b.today} {...(sp.contact ? { presetContact: sp.contact } : {})} />
    </Shell>
  );
}
