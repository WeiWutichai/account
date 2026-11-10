// P3 ค่าใช้จ่าย — design/project/ScreenExpense.dc.html (Sidebar active="expense")
import { redirect } from 'next/navigation';
import { p2aData } from '../../../_p2a/server';
import { Shell } from '../../../lib/shell';
import { ExpenseForm } from '../../_lib/ExpenseForm';
import { getPDoc, purchaseBase } from '../../_lib/server.ts';
import { pHref } from '../../_lib/types.ts';

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail, p2a] = await Promise.all([purchaseBase(), getPDoc(id), p2aData()]);
  if (detail.doc.doc_type !== 'EXP') redirect(pHref(detail.doc));
  return (
    <Shell active="expense">
      <ExpenseForm key={detail.doc.id} detail={detail} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} names={b.names} today={b.today} p2a={p2a} />
    </Shell>
  );
}
