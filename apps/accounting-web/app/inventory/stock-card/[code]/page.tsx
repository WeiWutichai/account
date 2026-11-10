// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// สต็อกการ์ดต่อสินค้า (Phase 2A INV) — GET /v1/inventory/stock-card/:code?from=&to=&warehouse= · ยกมา · รายการ · คงเหลือสะสม · ต้นทุนถัวเฉลี่ย
import { api } from '../../../lib/api';
import { Shell } from '../../../lib/shell';
import { today } from '../../../finance/_shared/types';
import type { ProductRow, Warehouse } from '../../_shared/ui';
import { StockCardScreen, type StockCard } from './_screen';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export default async function StockCardPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const code = decodeURIComponent((await params).code);
  const sp = await searchParams;
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : today();
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : `${to.slice(0, 7)}-01`;
  const warehouse = sp.warehouse ?? '';
  const [card, warehouses, products] = await Promise.all([
    api<StockCard>(`/v1/inventory/stock-card/${encodeURIComponent(code)}?from=${from}&to=${to}${warehouse ? `&warehouse=${encodeURIComponent(warehouse)}` : ''}`),
    api<Warehouse[]>('/v1/inventory/warehouses'),
    api<{ rows: ProductRow[] }>('/v1/master/products'),
  ]);
  return (
    <Shell active="inventory">
      <StockCardScreen card={card} from={from} to={to} warehouse={warehouse} warehouses={warehouses}
        products={products.rows.filter((p) => p.track_stock).map((p) => ({ code: p.code, name: p.name }))} />
    </Shell>
  );
}
