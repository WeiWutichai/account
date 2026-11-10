// S3 ใบกำกับภาษีใหม่ — design/project/ScreenInvoice.dc.html (Sidebar active="invoice") · ?contact=<id> เลือกลูกค้าไว้ก่อน
import { p2aData } from '../../../_p2a/server';
import { Shell } from '../../../lib/shell';
import { InvoiceForm } from '../../_lib/InvoiceForm';
import { accountNames, formBase } from '../../_lib/server';

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [b, p2a] = await Promise.all([formBase(), p2aData()]);
  return (
    <Shell active="invoice">
      <InvoiceForm mode="IV" detail={null} contacts={b.contacts} accounts={b.accounts} rules={b.rules} names={accountNames(b.accounts)} today={b.today} p2a={p2a} {...(sp.contact ? { presetContact: sp.contact } : {})} />
    </Shell>
  );
}
