// ยกเลิก / กลับรายการเอกสาร — design/project/ScreenDocVoid.dc.html (ใช้กับ IV, RV, CN/DN, DP, BN … ตามที่แบบร่างระบุ)
// TODO(Wei): แถว "ส่งให้ลูกค้าแล้ว … · ระบบจะส่งแจ้งยกเลิก" — ยังไม่มีระบบส่งแจ้งยกเลิก จึงแสดงแค่วันที่ส่ง
// TODO(M3/Wei): "ต้องยืนยันด้วยรหัส 2FA เมื่อกดยกเลิก" — ยังไม่มี step-up 2FA ใน accounting-web (Innovera ID) · ตอนนี้ยืนยันด้วยปุ่มอย่างเดียว
import { href } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { api, type Context } from '../../../../lib/api';
import { Shell } from '../../../../lib/shell';
import { detailCache, findDoc, listDocs } from '../../../_shared/data';
import { cents, fromCents } from '../../../_shared/num';
import { docNav, docTypeName, shortStamp, today } from '../../../_shared/types';
import { VoidForm, type VoidCheck } from './form';

export default async function DocVoidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await findDoc(id);
  if (!d || d.doc.status === 'draft') notFound();
  const ctx = await api<Context>('/v1/context');
  const nav = docNav(d.doc);
  const p = ctx.period;
  const isInvoice = ['IV', 'DN'].includes(d.doc.doc_type);

  const checks: VoidCheck[] = [];
  if (p) {
    const ok = p.status !== 'hard_closed';
    checks.push({ label: `งวด ${p.period_no}/${p.fiscal_year}`, value: `${p.status === 'open' ? 'เปิด' : p.status === 'soft_closed' ? 'ปิดอ่อน' : 'ปิดแข็ง'} · ${ok ? 'ยกเลิกได้' : 'ยกเลิกไม่ได้'}`, tone: ok ? 'ok' : 'bad' });
  }
  if (d.doc.doc_type === 'IV') {
    const taxIssued = d.doc.tax_mode === 'immediate' || d.settlementsIn.some((s) => !s.voided && cents(s.vat_due) > 0n);
    checks.push({ label: 'ใบกำกับภาษี', value: taxIssued ? 'ออกแล้ว' : 'ยังไม่ออก (ออกเมื่อรับเงิน)', tone: taxIssued ? 'warn' : 'ok' });
  }
  if (isInvoice) {
    const act = d.settlementsIn.filter((s) => !s.voided && s.doc_type === 'RV');
    const paid = act.reduce((s, x) => s + cents(x.applied) + cents(x.wht), 0n);
    checks.push({ label: 'รับชำระแล้ว', value: act.length ? `${fromCents(paid)} · ${act.map((s) => s.doc_no).join(', ')}` : '0.00 · ไม่มี RV อ้างอิง', tone: act.length ? 'bad' : 'ok', money: true });
    if (d.doc.contact_id) {
      const detail = detailCache();
      const bns = (await listDocs({ type: 'BN', contact: d.doc.contact_id })).filter((b) => b.status !== 'voided');
      const inBn: string[] = [];
      for (const b of bns) if ((await detail(b.id)).billing.some((it) => it.id === id)) inBn.push(b.doc_no ?? '');
      if (inBn.length) checks.push({ label: 'อยู่ในใบวางบิล', value: `${inBn.join(', ')} · จะถอดออกให้`, tone: 'warn' });
    }
  }
  if (d.doc.sent_at) checks.push({ label: 'ส่งให้ลูกค้าแล้ว', value: `อีเมล ${shortStamp(d.doc.sent_at).slice(0, 5)}`, tone: 'warn' });
  checks.push({ label: 'มาจากแอปเชื่อมต่อ', value: d.doc.external_source ? `${d.doc.external_source} · จะแจ้ง document.voided` : 'ไม่ · (ถ้ามาจาก TMS จะแจ้ง document.voided)', tone: 'muted' });

  return (
    <Shell active={nav.active}>
      <VoidForm
        doc={{ id, docNo: d.doc.doc_no ?? '', docType: d.doc.doc_type, typeName: docTypeName(d.doc), status: d.doc.status, voidReason: d.doc.void_reason,
          contact: d.contact?.name ?? '—', total: d.doc.grand_total, issue: d.doc.issue_date, period: p ? `งวด ${p.period_no}/${p.fiscal_year} ${p.status === 'open' ? 'เปิด' : p.status === 'soft_closed' ? 'ปิดอ่อน' : 'ปิดแข็ง'}` : '' }}
        nav={nav} checks={checks} journal={d.journal} today={today()} canCredit={d.doc.doc_type === 'IV'}
        creditHref={`${href('creditnote')}/new?ref=${id}`} />
    </Shell>
  );
}
