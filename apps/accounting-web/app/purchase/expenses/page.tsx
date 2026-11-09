// รายการค่าใช้จ่าย — ไม่มีแบบร่างหน้ารายการ (ScreenExpense.dc.html มีแต่ฟอร์ม)
// TODO(Wei): ใช้รูปแบบ ScreenPurchaseList.dc.html ไปก่อน · ขอแบบร่างรายการ EXP
import { PurchaseListPage } from '../_lib/listPage';

export default function ExpensesPage() {
  return <PurchaseListPage active="expense" types="EXP" variant={{ title: 'ค่าใช้จ่าย', crumb: 'ซื้อ / ค่าใช้จ่าย', create: { label: 'บันทึกค่าใช้จ่าย', href: '/purchase/expenses/new' }, bills: false }} />;
}
