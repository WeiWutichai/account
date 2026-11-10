// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// สินค้าคงคลัง (Phase 2A INV · docs/technical-plan-P2A.md "INV") — ไม่มีไฟล์ .dc.html · Wei สั่งให้ใช้งานได้ก่อน
// ข้อมูลจาก /v1/inventory/{status,warehouses,valuation,reorder,section87/:month,product-units} + /v1/master/products
import { ButtonLink, css, href, S, TopBar } from '@innovera/ui';
import { api } from '../lib/api';
import { Shell } from '../lib/shell';
import { today } from '../finance/_shared/types';
import { INV_TABS, TempBanner, type InvStatus, type ProductRow, type ProductUnit, type Warehouse } from './_shared/ui';
import { InventoryScreen, type Reorder, type Section87, type Valuation } from './_screen';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/u;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = await api<InvStatus>('/v1/inventory/status');
  if (!status.enabled) {
    return (
      <Shell active="inventory">
        <TopBar crumb="โมดูลเพิ่มเติม / สินค้าคงคลัง" />
        <div style={css(S.content)}>
          <TempBanner />
          <h1 style={css(S.h1)}>สินค้าคงคลัง</h1>
          <p style={css('margin: 0; font-size: 15px')}>โมดูลสินค้าคงคลังยังไม่เปิดใช้สำหรับบริษัทนี้</p>
          <p style={css(S.note)}>เปิดโมดูลได้ที่หน้า “เปิดโมดูล และค่าตั้งที่รอยืนยัน” — เมื่อเปิดแล้วระบบจะสร้างบัญชีของโมดูล (1200100 · 2130100 · 5020100 · 5020900) และคลังสินค้าหลัก</p>
          <div><ButtonLink href={href('modules')} kind="primary">ไปหน้าเปิดโมดูล</ButtonLink></div>
        </div>
      </Shell>
    );
  }
  const tab = INV_TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'balances';
  const asOf = sp.asOf && DATE_RE.test(sp.asOf) ? sp.asOf : today();
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : today().slice(0, 7);
  const wq = sp.warehouse ? `&warehouse=${encodeURIComponent(sp.warehouse)}` : '';
  const [warehouses, valuation, products, units, reorder, s87] = await Promise.all([
    api<Warehouse[]>('/v1/inventory/warehouses'),
    api<Valuation>(`/v1/inventory/valuation?asOf=${asOf}${wq}`),
    api<{ rows: ProductRow[] }>('/v1/master/products'),
    api<ProductUnit[]>('/v1/inventory/product-units'),
    api<Reorder[]>('/v1/inventory/reorder'),
    tab === 'section87' ? api<Section87>(`/v1/inventory/section87/${month}${wq.replace('&', '?')}`) : Promise.resolve(null),
  ]);
  return (
    <Shell active="inventory">
      <InventoryScreen tab={tab} status={status} asOf={asOf} month={month} warehouse={sp.warehouse ?? ''} warehouses={warehouses} valuation={valuation}
        products={products.rows} units={units} reorder={reorder} section87={s87} />
    </Shell>
  );
}
