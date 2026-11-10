// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// เอกสารสต็อก GR/GI/TRF/ADJ (Phase 2A INV) — ไม่มีไฟล์ .dc.html · ข้อมูลจาก GET /v1/inventory/documents + ข้อมูลประกอบฟอร์มสร้างเอกสาร
import { ButtonLink, css, href, S, TopBar } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { today, type Account, type Contact, type DocRow } from '../../finance/_shared/types';
import { TempBanner, type InvStatus, type ProductRow, type ProductUnit, type Warehouse } from '../_shared/ui';
import { StockDocsScreen, type StockDocRow } from './_screen';

const TYPES = ['GR', 'GI', 'TRF', 'ADJ'];

export default async function StockDocsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = await api<InvStatus>('/v1/inventory/status');
  if (!status.enabled) {
    return (
      <Shell active="stockdocs">
        <TopBar crumb="โมดูลเพิ่มเติม / เอกสารสต็อก" />
        <div style={css(S.content)}>
          <TempBanner />
          <h1 style={css(S.h1)}>รับ / เบิก / โอน / ตรวจนับ</h1>
          <p style={css('margin: 0')}>โมดูลสินค้าคงคลังยังไม่เปิดใช้สำหรับบริษัทนี้</p>
          <div><ButtonLink href={href('modules')} kind="primary">ไปหน้าเปิดโมดูล</ButtonLink></div>
        </div>
      </Shell>
    );
  }
  const type = TYPES.includes(sp.type ?? '') ? sp.type! : '';
  const { year } = await currentPeriod();
  const [docs, warehouses, products, units, contacts, pos, accounts] = await Promise.all([
    api<StockDocRow[]>(`/v1/inventory/documents${type ? `?type=${type}` : ''}`),
    api<Warehouse[]>('/v1/inventory/warehouses'),
    api<{ rows: ProductRow[] }>('/v1/master/products'),
    api<ProductUnit[]>('/v1/inventory/product-units'),
    api<Contact[]>('/v1/contacts'),
    api<DocRow[]>('/v1/documents?type=PO&status=approved'),
    api<Account[]>(`/v1/accounts?year=${year}&period=13`),
  ]);
  return (
    <Shell active="stockdocs">
      <StockDocsScreen today={today()} type={type} openNew={sp.new === '1'} docs={docs} warehouses={warehouses.filter((w) => w.active)}
        products={products.rows.filter((p) => p.track_stock).map((p) => ({ code: p.code, name: p.name, unit: p.unit }))}
        units={units} vendors={contacts.filter((c) => c.kind !== 'customer').map((c) => ({ id: c.id, code: c.code, name: c.name }))}
        pos={pos.map((d) => ({ id: d.id, docNo: d.doc_no ?? '', contactId: d.contact_id, contactName: d.contact_name ?? '', date: d.issue_date }))}
        accounts={accounts.filter((a) => a.code.startsWith('5')).map((a) => ({ code: a.code, name: a.name }))} />
    </Shell>
  );
}
