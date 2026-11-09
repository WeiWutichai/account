// S2 รายการใบกำกับภาษี — design/project/ScreenDocList.dc.html (Sidebar active="invoice")
import { ListPage } from '../_lib/listPage';

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ListPage active="invoice" types="IV" title="ใบกำกับภาษี / ใบแจ้งหนี้" crumb="ขาย / ใบกำกับภาษี" createLabel="สร้างใบกำกับภาษี" createHref="/sales/invoices/new" {...(sp.tab ? { tab: sp.tab } : {})} />;
}
