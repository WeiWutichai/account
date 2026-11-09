// P3 ค่าใช้จ่ายใหม่ — design/project/ScreenExpense.dc.html (Sidebar active="expense")
import { Shell } from '../../../lib/shell';
import { ExpenseForm } from '../../_lib/ExpenseForm';
import { purchaseBase } from '../../_lib/server.ts';

export default async function NewExpensePage() {
  const b = await purchaseBase();
  return (
    <Shell active="expense">
      <ExpenseForm detail={null} vendors={b.vendors} accounts={b.accounts} whtTypes={b.whtTypes} names={b.names} today={b.today} />
    </Shell>
  );
}
