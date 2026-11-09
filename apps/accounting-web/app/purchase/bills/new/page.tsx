// P2 บิลซื้อใหม่ — design/project/ScreenPurchaseBill.dc.html (Sidebar active="purchase") · ?po=<id ใบสั่งซื้อ> สร้าง AP จาก PO
import { Shell } from '../../../lib/shell';
import { BillForm } from '../../_lib/BillForm';
import { poReceived } from '../../_lib/data.ts';
import { getPDoc, periods, purchaseBase } from '../../_lib/server.ts';

export default async function NewBillPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const b = await purchaseBase();
  const po = sp.po ? await getPDoc(sp.po) : null;
  const [received, ps] = await Promise.all([po ? poReceived(po) : Promise.resolve([]), periods(b.ctx.period?.fiscal_year ?? 2569)]);
  return (
    <Shell active="purchase">
      <BillForm detail={null} po={po?.doc.doc_type === 'PO' ? po : null} poReceived={received} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} names={b.names} today={b.today} payable={null} periods={ps} />
    </Shell>
  );
}
