// P0 ใบขอซื้อ / ใบสั่งซื้อใหม่ — design/project/ScreenPurchaseOrder.dc.html (Sidebar active="po") · ?pr=<id ใบขอซื้อ> สร้าง PO จาก PR · ?type=PR
import { Shell } from '../../../lib/shell';
import { OrderForm } from '../../_lib/OrderForm';
import { getPDoc, purchaseBase } from '../../_lib/server.ts';

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [b, pr] = await Promise.all([purchaseBase(), sp.pr ? getPDoc(sp.pr) : Promise.resolve(null)]);
  return (
    <Shell active="po">
      <OrderForm detail={null} pr={pr?.doc.doc_type === 'PR' ? pr : null} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} today={b.today} received={[]} initialKind={sp.type === 'PR' ? 'PR' : 'PO'} />
    </Shell>
  );
}
