// P1 รายการบิลซื้อ — design/project/ScreenPurchaseList.dc.html (Sidebar active="purchase") · แบบร่างรวมบิลซื้อและใบสั่งซื้อ
import { PurchaseListPage } from '../_lib/listPage';

export default function BillsPage() {
  return <PurchaseListPage active="purchase" types="AP,PO" variant={{ title: 'บิลซื้อ / ใบสั่งซื้อ', crumb: 'ซื้อ / บิลซื้อ', create: { label: 'บันทึกบิลซื้อ', href: '/purchase/bills/new' }, bills: true }} />;
}
