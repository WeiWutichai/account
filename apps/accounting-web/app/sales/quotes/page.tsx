// รายการใบเสนอราคา/ใบสั่งขาย — ไม่มีแบบร่างหน้ารายการ (ScreenQuote.dc.html มีแต่ฟอร์ม)
// TODO(Wei): ใช้รูปแบบ ScreenDocList.dc.html ไปก่อน · ขอแบบร่างรายการ QO/SO
import { ListPage } from '../_lib/listPage';

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ListPage active="quote" types="QO,SO" title="ใบเสนอราคา / ใบสั่งขาย" crumb="ขาย / ใบเสนอราคา" createLabel="สร้างใบเสนอราคา" createHref="/sales/quotes/new" {...(sp.tab ? { tab: sp.tab } : {})} />;
}
