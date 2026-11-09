// รายการใบลดหนี้/ใบเพิ่มหนี้ — ไม่มีแบบร่างหน้ารายการ (ScreenCreditNote.dc.html มีแต่ฟอร์ม)
// TODO(Wei): ใช้รูปแบบ ScreenDocList.dc.html ไปก่อน · ขอแบบร่างรายการ CN/DN
import { ListPage } from '../_lib/listPage';

export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ListPage active="creditnote" types="CN,DN" title="ใบลดหนี้ / ใบเพิ่มหนี้" crumb="ขาย / ใบลดหนี้" createLabel="สร้างใบลดหนี้" createHref="/sales/credit-notes/new" {...(sp.tab ? { tab: sp.tab } : {})} />;
}
