// หน้ารายการเอกสารซื้อ (server) — ScreenPurchaseList.dc.html · ใช้ร่วม บิลซื้อ / ใบสั่งซื้อ / ค่าใช้จ่าย / ใบลดหนี้ซื้อ
import { api, type Context } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { listRows } from './data.ts';
import { PurchaseList, type ListVariant } from './PurchaseList';
import { appToday } from './server.ts';

const PSTATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };

export async function PurchaseListPage({ active, types, variant }: { active: string; types: string; variant: ListVariant }) {
  const [ctx, rows] = await Promise.all([api<Context>('/v1/context'), listRows(types)]);
  const p = ctx.period;
  return (
    <Shell active={active}>
      <PurchaseList rows={rows} today={appToday()} periodLabel={p ? `งวด ${p.period_no}/${p.fiscal_year} ${PSTATUS[p.status] ?? p.status}` : 'ยังไม่มีงวดบัญชี'} variant={variant} />
    </Shell>
  );
}
