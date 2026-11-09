// แก้ไขเอกสารที่ผ่านรายการแล้ว — design/project/ScreenDocEdit.dc.html
// บิลซื้อ AP / ค่าใช้จ่าย EXP = ตามแบบร่าง (purchase-form.tsx: เลขผู้เสียภาษีผู้ขาย · เลขที่/วันที่ใบกำกับผู้ขาย · มิติ · ย้ายบัญชีค่าใช้จ่ายด้วย JV)
// TODO(Wei): เอกสารขาย — แบบร่างไม่มีตัวอย่าง จึงใช้ช่องที่ API แก้ได้ (REFERENCE_FIELDS: ที่อยู่ · อ้างอิง · วันครบกำหนด · หมายเหตุ) และแถว "ลูกค้า"/"ภาษีขาย"
// ชื่อผู้ทำในประวัติ = events[].actor_name (Innovera ID) · ไม่มีผู้ใช้ (API/ระบบ) → "—"
// TODO(Wei): แถว "ภ.พ.30 (ร่าง) ไม่เปลี่ยน · 116,069.36" — ยอด ภ.พ.30 มาใน M6 จึงแสดงแค่ "ไม่เปลี่ยน"
import { money, thaiDate, thaiMonth } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { api, type Context } from '../../../../lib/api';
import { Shell } from '../../../../lib/shell';
import { findDoc } from '../../../_shared/data';
import { cents } from '../../../_shared/num';
import { docNav, docTypeName, PERIOD_STATUS, shortStamp } from '../../../_shared/types';
import { EditForm } from './form';
import { PurchaseEditForm } from './purchase-form';

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
  const periodRow = p ? { label: `งวด ${p.period_no}/${p.fiscal_year}`, value: `${PERIOD_STATUS[p.status] ?? p.status} · ${p.status === 'hard_closed' ? 'แก้ไม่ได้' : 'แก้ได้'}`, tone: (p.status === 'hard_closed' ? 'bad' : 'ok') as 'ok' | 'bad' } : null;
  const history = d.events.slice().reverse().map((e) => ({ when: shortStamp(e.at), what: EVENT[e.event] ?? e.event, who: e.actor_name ?? '—' }));
  if (['AP', 'EXP'].includes(d.doc.doc_type)) {
    const x = d.doc as typeof d.doc & { vendor_ref: string | null; vendor_invoice_date: string | null; party_tax_id: string | null; project_code: string | null };
    const ls = d.lines as unknown as { id: string; line_no: number; line_type: string; description: string | null; account_code: string | null; amount: string }[];
    const ym = d.doc.issue_date.slice(0, 7);
    const [accounts, vat] = await Promise.all([api<{ code: string; name: string; type: string; is_control: boolean }[]>(`/v1/accounts?year=${Number(ym.slice(0, 4)) + 543}&period=13`), api<{ pp30: { netPayable: string } }>(`/v1/tax/vat?month=${ym}`)]);
    const paidOut = d.settlementsIn.filter((s) => !s.voided && s.doc_type === 'PV');
    const lastPay = paidOut.map((s) => s.issue_date).sort().at(-1);
    return (
      <Shell active={nav.active}>
        <PurchaseEditForm
          doc={{ id, docNo: d.doc.doc_no ?? '', status: d.doc.status, title: `${d.doc.doc_no ?? ''} ${docTypeName(d.doc)}`, contact: d.contact ? `${d.contact.name} · ${d.contact.code}` : '—',
            total: d.doc.grand_total, taxNote: cents(d.doc.vat) > 0n ? ` (ภาษีซื้อ ${money(d.doc.vat)})` : '',
            state: `ผ่านรายการ ${thaiDate(d.doc.issue_date)}${lastPay ? ` · จ่ายแล้ว ${lastPay.slice(8, 10)}/${lastPay.slice(5, 7)} (${paidOut.map((s) => s.doc_no).join(', ')})` : ''}`,
            taxId: x.party_tax_id ?? (d.contact as { tax_id?: string | null } | null)?.tax_id ?? null, vendorRef: x.vendor_ref, vendorInvoiceDate: x.vendor_invoice_date, projectCode: x.project_code }}
          lines={ls.filter((l) => l.line_type === 'item' && l.account_code).map((l) => ({ id: l.id, no: l.line_no, description: l.description ?? '', account: l.account_code!, amount: l.amount }))}
          accounts={accounts.filter((a) => !a.is_control && (a.type === 'expense' || (a.type === 'asset' && /^15[1-4]/u.test(a.code)))).map((a) => ({ code: a.code, name: a.name }))}
          nav={nav} month={month} pp30={vat.pp30.netPayable} period={periodRow} history={history} />
      </Shell>
    );
  }
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
        history={d.events.slice().reverse().map((e) => ({ when: shortStamp(e.at), what: EVENT[e.event] ?? e.event, who: e.actor_name ?? '—' }))} />
    </Shell>
  );
}
