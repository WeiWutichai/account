// P4 ใบลดหนี้/ใบเพิ่มหนี้ซื้อใหม่ — design/project/ScreenPurchaseCreditNote.dc.html (Sidebar active="purchasecn") · ?ref=<id บิลซื้อ> · ?type=DNR
import { Shell } from '../../../lib/shell';
import { CreditNoteForm } from '../../_lib/CreditNoteForm';
import { billOptions } from '../../_lib/data.ts';
import { getPDoc, purchaseBase } from '../../_lib/server.ts';

export default async function NewPurchaseCreditNotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [b, bills, ref] = await Promise.all([purchaseBase(), billOptions(), sp.ref ? getPDoc(sp.ref) : Promise.resolve(null)]);
  return (
    <Shell active="purchasecn">
      <CreditNoteForm detail={null} refDetail={ref?.doc.doc_type === 'AP' ? ref : null} bills={bills} vendors={b.vendors} whtTypes={b.whtTypes} names={b.names} today={b.today} initialKind={sp.type === 'DNR' ? 'DNR' : 'CNR'} />
    </Shell>
  );
}
