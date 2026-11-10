// P3 ค่าใช้จ่ายใหม่ — design/project/ScreenExpense.dc.html (Sidebar active="expense")
import { p2aData } from '../../../_p2a/server';
import { Shell } from '../../../lib/shell';
import { ExpenseForm } from '../../_lib/ExpenseForm';
import { purchaseBase } from '../../_lib/server.ts';

export default async function NewExpensePage() {
  const [b, p2a] = await Promise.all([purchaseBase(), p2aData()]);
  return (
    <Shell active="expense">
      <ExpenseForm detail={null} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} names={b.names} today={b.today} p2a={p2a} />
    </Shell>
  );
}
