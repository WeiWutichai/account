// F1 ใบวางบิลใหม่ — design/project/ScreenBilling.dc.html · ?contact= เลือกลูกค้า (โหลดใบค้างชำระ)
import { api } from '../../../lib/api';
import { Shell } from '../../../lib/shell';
import { today, type Contact } from '../../_shared/types';
import { billingData } from '../_data';
import { BillingScreen } from '../_screen';

export default async function BillingNewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const contacts = (await api<Contact[]>('/v1/contacts')).filter((c) => c.kind === 'customer' || c.kind === 'both');
  const contact = contacts.find((c) => c.id === sp.contact) ?? null;
  const { rows, calendar } = await billingData(contact?.id ?? null, null, today());
  return (
    <Shell active="bn">
      <BillingScreen key={contact?.id ?? 'none'} mode="new" today={today()} contacts={contacts} contact={contact} rows={rows} calendar={calendar} />
    </Shell>
  );
}
