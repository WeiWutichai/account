// S3 ใบกำกับภาษี — design/project/ScreenInvoice.dc.html (Sidebar active="invoice")
import { redirect } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { docHref } from '../../_lib/doc';
import { InvoiceForm } from '../../_lib/InvoiceForm';
import { accountNames, formBase, getDoc } from '../../_lib/server';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail] = await Promise.all([formBase(), getDoc(id)]);
  if (detail.doc.doc_type !== 'IV') redirect(docHref(detail.doc));
  return (
    <Shell active="invoice">
      <InvoiceForm key={detail.doc.id} mode="IV" detail={detail} contacts={b.contacts} accounts={b.accounts} rules={b.rules} names={accountNames(b.accounts)} today={b.today} />
    </Shell>
  );
}
