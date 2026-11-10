// P2 บิลซื้อ — design/project/ScreenPurchaseBill.dc.html (Sidebar active="purchase")
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { p2aData } from '../../../_p2a/server';
import { Shell } from '../../../lib/shell';
import { BillForm } from '../../_lib/BillForm';
import { getPDoc, periods, purchaseBase } from '../../_lib/server.ts';
import { type Payable, pHref } from '../../_lib/types.ts';

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail, p2a] = await Promise.all([purchaseBase(), getPDoc(id), p2aData()]);
  if (detail.doc.doc_type !== 'AP') redirect(pHref(detail.doc));
  // ภาษีหัก ณ ที่จ่ายเมื่อจ่ายของบิลค้างจ่าย = ตาม backend (whtForBill)
  const [pay, ps] = await Promise.all([
    detail.doc.status === 'posted' && detail.doc.contact_id ? api<Payable[]>(`/v1/payables?contact=${detail.doc.contact_id}`) : Promise.resolve([]),
    periods(Number(detail.doc.issue_date.slice(0, 4)) + 543),
  ]);
  return (
    <Shell active="purchase">
      <BillForm key={detail.doc.id} detail={detail} po={null} poReceived={[]} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} names={b.names} today={b.today} p2a={p2a}
        payable={pay.find((p) => p.id === id) ?? null} periods={ps} />
    </Shell>
  );
}
