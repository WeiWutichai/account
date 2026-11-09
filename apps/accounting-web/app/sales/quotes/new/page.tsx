// S4 ใบเสนอราคาใหม่ — design/project/ScreenQuote.dc.html (Sidebar active="quote") · ?type=SO = ใบสั่งขาย · ?contact=<id>
import { Shell } from '../../../lib/shell';
import { QuoteForm } from '../../_lib/QuoteForm';
import { formBase, quoteExtras } from '../../_lib/server';

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [b, extras] = await Promise.all([formBase(), quoteExtras()]);
  return (
    <Shell active="quote">
      <QuoteForm detail={null} contacts={b.contacts} extras={extras} today={b.today} docType={sp.type === 'SO' ? 'SO' : 'QO'} {...(sp.contact ? { presetContact: sp.contact } : {})} />
    </Shell>
  );
}
