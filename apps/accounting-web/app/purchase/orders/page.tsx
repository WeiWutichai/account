// รายการใบขอซื้อ/ใบสั่งซื้อ — ไม่มีแบบร่างหน้ารายการ (ScreenPurchaseOrder.dc.html มีแต่ฟอร์ม)
// TODO(Wei): ใช้รูปแบบ ScreenPurchaseList.dc.html ไปก่อน · ขอแบบร่างรายการ PR/PO
import { PurchaseListPage } from '../_lib/listPage';

export default function OrdersPage() {
  return <PurchaseListPage active="po" types="PR,PO" variant={{ title: 'ใบขอซื้อ / ใบสั่งซื้อ', crumb: 'ซื้อ / ใบสั่งซื้อ', create: { label: 'สร้างใบสั่งซื้อ', href: '/purchase/orders/new' }, bills: false }} />;
}
