// S4 ใบเสนอราคา / ใบสั่งขาย — design/project/ScreenQuote.dc.html (Sidebar active="quote")
import { redirect } from 'next/navigation';
import { p2aData } from '../../../_p2a/server';
import { Shell } from '../../../lib/shell';
import { docHref } from '../../_lib/doc';
import { QuoteForm } from '../../_lib/QuoteForm';
import { formBase, getDoc, quoteExtras } from '../../_lib/server';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail, extras, p2a] = await Promise.all([formBase(), getDoc(id), quoteExtras(), p2aData()]);
  if (detail.doc.doc_type !== 'QO' && detail.doc.doc_type !== 'SO') redirect(docHref(detail.doc));
  return (
    <Shell active="quote">
      <QuoteForm key={detail.doc.id} detail={detail} contacts={b.contacts} extras={extras} today={b.today} p2a={p2a} docType={detail.doc.doc_type} />
    </Shell>
  );
}
