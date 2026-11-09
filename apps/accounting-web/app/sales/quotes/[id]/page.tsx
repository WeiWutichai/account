// S4 ใบเสนอราคา / ใบสั่งขาย — design/project/ScreenQuote.dc.html (Sidebar active="quote")
import { redirect } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { docHref } from '../../_lib/doc';
import { QuoteForm } from '../../_lib/QuoteForm';
import { formBase, getDoc } from '../../_lib/server';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, detail] = await Promise.all([formBase(), getDoc(id)]);
  if (detail.doc.doc_type !== 'QO' && detail.doc.doc_type !== 'SO') redirect(docHref(detail.doc));
  return (
    <Shell active="quote">
      <QuoteForm key={detail.doc.id} detail={detail} contacts={b.contacts} today={b.today} docType={detail.doc.doc_type} />
    </Shell>
  );
}
