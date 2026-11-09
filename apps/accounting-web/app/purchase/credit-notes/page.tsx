// รายการใบลดหนี้/ใบเพิ่มหนี้ที่ได้รับจากผู้ขาย — ไม่มีแบบร่างหน้ารายการ (ScreenPurchaseCreditNote.dc.html มีแต่ฟอร์ม)
// TODO(Wei): ใช้รูปแบบ ScreenPurchaseList.dc.html ไปก่อน · ขอแบบร่างรายการ CNR/DNR
import { PurchaseListPage } from '../_lib/listPage';

export default function PurchaseCreditNotesPage() {
  return <PurchaseListPage active="purchasecn" types="CNR,DNR" variant={{ title: 'ใบลดหนี้ / ใบเพิ่มหนี้ (ซื้อ)', crumb: 'ซื้อ / ใบลดหนี้ (รับจากผู้ขาย)', create: { label: 'บันทึกใบลดหนี้', href: '/purchase/credit-notes/new' }, bills: false }} />;
}
