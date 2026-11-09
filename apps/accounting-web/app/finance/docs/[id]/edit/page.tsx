// แก้ไขเอกสารที่ผ่านรายการแล้ว — design/project/ScreenDocEdit.dc.html
// TODO(Wei): แบบร่างเป็นตัวอย่างบิลซื้อ AP (ผู้ขาย · เลขผู้เสียภาษีผู้ขาย · เลขที่/วันที่ใบกำกับผู้ขาย · มิติ · บัญชีค่าใช้จ่าย) —
//   M4 ใช้กับเอกสารขาย ซึ่ง API แก้ได้เฉพาะ ที่อยู่ · อ้างอิง · วันครบกำหนด · หมายเหตุ (REFERENCE_FIELDS) จึงแสดงแถวตามช่องเหล่านี้
//   และแถว "ลูกค้า"/"ภาษีขาย" แทน "ผู้ขาย"/"ภาษีซื้อ" · แถว AP ทำใน M5 · การย้ายบัญชี (สร้าง JV โอนย้าย) ยังไม่มีในเอกสารขาย
// TODO(API): ชื่อผู้ทำในประวัติ — document_event เก็บแค่ user id (ชื่ออยู่ใน Innovera ID) จึงแสดง "—"
// TODO(Wei): แถว "ภ.พ.30 (ร่าง) ไม่เปลี่ยน · 116,069.36" — ยอด ภ.พ.30 มาใน M6 จึงแสดงแค่ "ไม่เปลี่ยน"
import { money, thaiDate, thaiMonth } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { api, type Context } from '../../../../lib/api';
import { Shell } from '../../../../lib/shell';
import { findDoc } from '../../../_shared/data';
import { cents } from '../../../_shared/num';
import { docNav, docTypeName, PERIOD_STATUS, shortStamp } from '../../../_shared/types';
import { EditForm } from './form';

const EVENT: Record<string, string> = {
  created: 'สร้าง', updated: 'แก้ร่าง', submitted: 'ส่งอนุมัติ', approved: 'อนุมัติ', rejected: 'ปฏิเสธ', posted: 'ผ่านรายการ', voided: 'ยกเลิก',
  reference_edited: 'แก้ข้อมูลอ้างอิง', sent: 'ส่งให้ลูกค้า', converted: 'แปลงเอกสาร',
};

export default async function DocEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await findDoc(id);
  if (!d || d.doc.status === 'draft') notFound();
  const ctx = await api<Context>('/v1/context');
  const nav = docNav(d.doc);
  const p = ctx.period;
  const paid = d.settlementsIn.filter((s) => !s.voided && s.doc_type === 'RV');
  const lastPaid = paid.map((s) => s.issue_date).sort().at(-1);
  const month = thaiMonth(Number(d.doc.issue_date.slice(5, 7)));
  const tax = cents(d.doc.vat) > 0n ? ` (ภาษีขาย ${money(d.doc.vat)})` : '';
  return (
    <Shell active={nav.active}>
      <EditForm
        doc={{ id, docNo: d.doc.doc_no ?? '', status: d.doc.status, title: `${d.doc.doc_no ?? ''} ${docTypeName(d.doc)}`, contact: d.contact ? `${d.contact.name} · ${d.contact.code}` : '—',
          total: d.doc.grand_total, taxNote: tax,
          state: `ผ่านรายการ ${thaiDate(d.doc.issue_date)}${lastPaid ? ` · รับชำระแล้ว ${lastPaid.slice(8, 10)}/${lastPaid.slice(5, 7)} (${paid.map((s) => s.doc_no).join(', ')})` : ''}`,
          fields: { address: d.doc.address, reference: d.doc.reference, due_date: d.doc.due_date, notes: d.doc.notes } }}
        nav={nav}
        impacts={[
          { label: `รายงานภาษีขาย ${month}`, value: 'ยอดไม่เปลี่ยน', tone: 'ok' },
          { label: `ภ.พ.30 ${month} (ร่าง)`, value: 'ไม่เปลี่ยน', tone: 'muted' },
          ...(p ? [{ label: `งวด ${p.period_no}/${p.fiscal_year}`, value: `${PERIOD_STATUS[p.status] ?? p.status} · ${p.status === 'hard_closed' ? 'แก้ไม่ได้' : 'แก้ได้'}`, tone: (p.status === 'hard_closed' ? 'bad' : 'ok') as 'ok' | 'bad' }] : []),
          { label: 'สิทธิ์ที่ต้องใช้', value: 'ผู้จัดการบัญชี', tone: 'muted' },
        ]}
        history={d.events.slice().reverse().map((e) => ({ when: shortStamp(e.at), what: EVENT[e.event] ?? e.event, who: '—' }))} />
    </Shell>
  );
}
