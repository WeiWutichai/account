// S5 ใบลดหนี้/เพิ่มหนี้ใหม่ — design/project/ScreenCreditNote.dc.html (Sidebar active="creditnote")
// ?ref=<id ใบกำกับ> · ?type=DN · ?noref=1 (CN ลอย)
import { Shell } from '../../../lib/shell';
import { CreditNoteForm } from '../../_lib/CreditNoteForm';
import { accountNames, formBase, getDoc, listDocs } from '../../_lib/server';

export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [b, invoices, ref] = await Promise.all([formBase(), listDocs('type=IV&status=posted'), sp.ref ? getDoc(sp.ref) : Promise.resolve(null)]);
  return (
    <Shell active="creditnote">
      <CreditNoteForm detail={null} refDetail={ref} invoices={invoices} names={accountNames(b.accounts)} today={b.today} kind={sp.type === 'DN' ? 'DN' : 'CN'} noRef={sp.noref === '1'} />
    </Shell>
  );
}
