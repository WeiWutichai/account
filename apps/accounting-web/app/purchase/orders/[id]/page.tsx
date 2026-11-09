// P0 ใบขอซื้อ / ใบสั่งซื้อ — design/project/ScreenPurchaseOrder.dc.html (Sidebar active="po")
import { redirect } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { poReceived } from '../../_lib/data.ts';
import { OrderForm } from '../../_lib/OrderForm';
import { getPDoc, purchaseBase } from '../../_lib/server.ts';
import { pHref } from '../../_lib/types.ts';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail] = await Promise.all([purchaseBase(), getPDoc(id)]);
  if (detail.doc.doc_type !== 'PO' && detail.doc.doc_type !== 'PR') redirect(pHref(detail.doc));
  const [pr, received] = await Promise.all([
    detail.ref?.doc_type === 'PR' ? getPDoc(detail.ref.id) : Promise.resolve(null),
    detail.doc.doc_type === 'PO' ? poReceived(detail) : Promise.resolve([]),
  ]);
  return (
    <Shell active="po">
      <OrderForm key={detail.doc.id} detail={detail} pr={pr} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} today={b.today} received={received} initialKind={detail.doc.doc_type} />
    </Shell>
  );
}
