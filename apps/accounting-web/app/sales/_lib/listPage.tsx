// หน้ารายการเอกสารขาย (server) — ScreenDocList.dc.html · ใช้ร่วม ใบกำกับภาษี / ใบเสนอราคา / ใบลดหนี้
import { api, type Context } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { DocList } from './DocList';
import type { DocDetail } from './doc.ts';
import { toCents } from './num.ts';
import { appToday, listDocs } from './server.ts';

const PSTATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };

export async function ListPage({ active, types, title, crumb, createLabel, createHref, tab }: {
  active: string; types: string; title: string; crumb: string; createLabel: string; createHref: string; tab?: string;
}) {
  const [ctx, rows] = await Promise.all([api<Context>('/v1/context'), listDocs(`type=${types}`)]);
  // "รับบางส่วน 27/11" — วันที่รับชำระล่าสุดของใบที่รับบางส่วน
  const partial = rows.filter((r) => r.status === 'posted' && toCents(r.outstanding) > 0n && toCents(r.outstanding) < toCents(r.grand_total)).slice(0, 50);
  const details = await Promise.all(partial.map((r) => api<DocDetail>(`/v1/documents/${r.id}`)));
  const lastReceipt: Record<string, string> = {};
  for (const d of details) {
    const rv = d.settlementsIn.filter((s) => s.doc_type === 'RV' && !s.voided).map((s) => s.issue_date).sort();
    if (rv.length) lastReceipt[d.doc.id] = rv[rv.length - 1]!;
  }
  const p = ctx.period;
  const tabs = ['all', 'draft', 'pending', 'outstanding', 'overdue', 'paid'] as const;
  const initialTab = tabs.find((t) => t === tab) ?? 'all';
  return (
    <Shell active={active}>
      <DocList rows={rows} today={appToday()} periodLabel={p ? `งวด ${p.period_no}/${p.fiscal_year} ${PSTATUS[p.status] ?? p.status}` : 'ยังไม่มีงวดบัญชี'}
        title={title} crumb={crumb} createLabel={createLabel} createHref={createHref} lastReceipt={lastReceipt} initialTab={initialTab} />
    </Shell>
  );
}
