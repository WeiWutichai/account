// ใบแจ้งหนี้มัดจำ — TODO(Wei): ไม่มีแบบร่างฟอร์ม DP → ใช้รูปแบบ ScreenInvoice.dc.html (Sidebar active="deposit")
import { redirect } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { docHref } from '../../_lib/doc';
import { InvoiceForm } from '../../_lib/InvoiceForm';
import { accountNames, formBase, getDoc } from '../../_lib/server';

export default async function DepositPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail] = await Promise.all([formBase(), getDoc(id)]);
  if (detail.doc.doc_type !== 'DP') redirect(docHref(detail.doc));
  return (
    <Shell active="deposit">
      <InvoiceForm key={detail.doc.id} mode="DP" detail={detail} contacts={b.contacts} accounts={b.accounts} rules={b.rules} names={accountNames(b.accounts)} today={b.today} />
    </Shell>
  );
}
