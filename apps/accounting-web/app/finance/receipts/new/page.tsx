// F2 รับชำระใหม่ — design/project/ScreenReceipt.dc.html · ?contact= เลือกลูกค้า · ?billing= อ้างอิงใบวางบิล (เลือกใบในใบวางบิลให้)
import { p2aData } from '../../../_p2a/server';
import { Shell, currentPeriod } from '../../../lib/shell';
import { api } from '../../../lib/api';
import { findDoc } from '../../_shared/data';
import { today, type Account, type Contact } from '../../_shared/types';
import { ReceiptScreen, type Row } from '../_screen';

export default async function ReceiptNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { year } = await currentPeriod();
  const [contacts, accounts, bn, p2a] = await Promise.all([
    api<Contact[]>('/v1/contacts'),
    api<Account[]>(`/v1/accounts?year=${year}&period=13`),
    sp.billing ? findDoc(sp.billing) : Promise.resolve(null), p2aData(),
  ]);
  const billing = bn?.doc.doc_type === 'BN' ? bn : null;
  const contactId = billing?.doc.contact_id ?? sp.contact ?? null;
  // ใบที่อยู่ในใบวางบิล → ติ๊กไว้ก่อน (โหลดยอดค้างจริงฝั่ง client)
  const pre: Row[] = (billing?.billing ?? []).map((b) => ({ id: b.id, docNo: b.doc_no, due: b.due_date, outstanding: '0.00', grandTotal: b.grand_total, vat: '0.00', taxMode: null, desc: null, vatDueBefore: '0.00', checked: true, applied: '', wht: '0.00', whtBase: null, remaining: null }));
  return (
    <Shell active="receipt">
      <ReceiptScreen mode="new" today={today()} p2a={p2a} contacts={contacts.filter((c) => c.kind === 'customer' || c.kind === 'both')} accounts={accounts} rows={pre}
        initial={{ contactId, billingId: billing?.doc.id ?? null, billingNo: billing?.doc.doc_no ?? null }} />
    </Shell>
  );
}
