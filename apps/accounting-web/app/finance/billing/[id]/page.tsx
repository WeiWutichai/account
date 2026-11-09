// F1 ใบวางบิล — ดูใบที่ออกแล้ว · design/project/ScreenBilling.dc.html
import { notFound } from 'next/navigation';
import { Shell } from '../../../lib/shell';
import { findDoc } from '../../_shared/data';
import { today } from '../../_shared/types';
import { billingData } from '../_data';
import { BillingScreen } from '../_screen';

export default async function BillingViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await findDoc(id);
  if (!d || d.doc.doc_type !== 'BN') notFound();
  const { self, rows, calendar } = await billingData(d.doc.contact_id, id, today());
  return (
    <Shell active="bn">
      <BillingScreen mode="view" today={today()} contacts={[]} contact={d.contact} rows={rows} calendar={calendar}
        view={{ id, docNo: d.doc.doc_no ?? '', issue: d.doc.issue_date, due: d.doc.due_date, sent: Boolean(d.doc.sent_at), total: d.doc.grand_total,
          received: self?.received ?? '0.00', receipts: self?.receipts.map((r) => r.doc_no) ?? [], outstanding: self?.outstanding ?? d.doc.grand_total }} />
    </Shell>
  );
}
