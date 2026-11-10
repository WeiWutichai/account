// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// รายละเอียดเอกสารสต็อก (Phase 2A INV) — GET /v1/inventory/documents/:id (บรรทัด + ความเคลื่อนไหว) + GET /v1/documents/:id (JV · ประวัติ · ผู้ขาย · PO)
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { Shell } from '../../../lib/shell';
import { findDoc } from '../../../finance/_shared/data';
import { today } from '../../../finance/_shared/types';
import type { Warehouse } from '../../_shared/ui';
import { StockDocScreen, type StockDoc } from './_screen';

const AT = new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

export default async function StockDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/u.test(id)) notFound();
  const detail = await findDoc(id);
  if (!detail || !['GR', 'GI', 'TRF', 'ADJ'].includes(detail.doc.doc_type)) notFound();
  const [inv, warehouses] = await Promise.all([api<StockDoc>(`/v1/inventory/documents/${id}`), api<Warehouse[]>('/v1/inventory/warehouses')]);
  return (
    <Shell active="stockdocs">
      <StockDocScreen today={today()} inv={inv} journal={detail.journal} contact={detail.contact ? `${detail.contact.code} · ${detail.contact.name}` : null}
        refDoc={detail.ref ? { id: detail.ref.id, docNo: detail.ref.doc_no ?? '' } : null}
        events={detail.events.map((e) => ({ at: AT.format(new Date(e.at)), event: e.event, actor: e.actor_name }))}
        warehouses={Object.fromEntries(warehouses.map((w) => [w.id, `${w.code} · ${w.name}`]))} err={sp.err ?? null} />
    </Shell>
  );
}
