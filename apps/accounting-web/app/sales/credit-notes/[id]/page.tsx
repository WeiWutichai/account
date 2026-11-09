// S5 ใบลดหนี้ / ใบเพิ่มหนี้ — design/project/ScreenCreditNote.dc.html (Sidebar active="creditnote")
import { redirect } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { CreditNoteForm } from '../../_lib/CreditNoteForm';
import { docHref } from '../../_lib/doc';
import { accountNames, formBase, getDoc, listDocs } from '../../_lib/server';

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail, invoices] = await Promise.all([formBase(), getDoc(id), listDocs('type=IV&status=posted')]);
  if (detail.doc.doc_type !== 'CN' && detail.doc.doc_type !== 'DN') redirect(docHref(detail.doc));
  const ref = detail.doc.ref_document_id ? await getDoc(detail.doc.ref_document_id) : null;
  return (
    <Shell active="creditnote">
      <CreditNoteForm key={detail.doc.id} detail={detail} refDetail={ref} invoices={invoices} names={accountNames(b.accounts)} today={b.today} kind={detail.doc.doc_type} noRef={!detail.doc.ref_document_id} />
    </Shell>
  );
}
