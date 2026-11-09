// P4 ใบลดหนี้/ใบเพิ่มหนี้ที่ได้รับจากผู้ขาย — design/project/ScreenPurchaseCreditNote.dc.html (Sidebar active="purchasecn")
import { redirect } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { CreditNoteForm } from '../../_lib/CreditNoteForm';
import { billOptions } from '../../_lib/data.ts';
import { getPDoc, purchaseBase } from '../../_lib/server.ts';
import { pHref } from '../../_lib/types.ts';

export default async function PurchaseCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail, bills] = await Promise.all([purchaseBase(), getPDoc(id), billOptions()]);
  if (detail.doc.doc_type !== 'CNR' && detail.doc.doc_type !== 'DNR') redirect(pHref(detail.doc));
  const ref = detail.doc.ref_document_id ? await getPDoc(detail.doc.ref_document_id) : null;
  return (
    <Shell active="purchasecn">
      <CreditNoteForm key={detail.doc.id} detail={detail} refDetail={ref} bills={bills} vendors={b.vendors} whtTypes={b.whtTypes} names={b.names} today={b.today} initialKind={detail.doc.doc_type} />
    </Shell>
  );
}
