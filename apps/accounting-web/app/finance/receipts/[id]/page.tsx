// F2 รับชำระ — ดูใบรับชำระที่ลงบัญชีแล้ว · design/project/ScreenReceipt.dc.html
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { Shell } from '../../../lib/shell';
import { detailCache, findDoc, listDocs } from '../../_shared/data';
import { cents, fromCents } from '../../_shared/num';
import { ReceiptScreen, type Row } from '../_screen';

export default async function ReceiptViewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = detailCache();
  const d = await findDoc(id);
  if (!d || d.doc.doc_type !== 'RV') notFound();
  const cid = d.doc.contact_id ?? '';
  const [docs, bns] = await Promise.all([listDocs({ type: 'IV,DN', contact: cid }), listDocs({ type: 'BN', contact: cid })]);
  const current = new Map(docs.map((x) => [x.id, x]));
  const settled = d.settlementsOut.slice().sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date));
  const descOf = async (docId: string) => (await detail(docId)).lines.find((l) => l.description)?.description ?? null;

  // ยอดค้างก่อนรับชำระใบนี้ = ค้างปัจจุบัน + ที่ใบนี้ตัด (ถ้ายังไม่ถูกยกเลิก) · คงเหลือ = ค้างปัจจุบัน
  const rows: Row[] = await Promise.all(settled.map(async (s) => {
    const now = current.get(s.id)?.outstanding ?? '0.00';
    const before = s.voided ? cents(now) : cents(now) + cents(s.applied) + cents(s.wht);
    return {
      id: s.id, docNo: s.doc_no, due: s.due_date, outstanding: fromCents(before), grandTotal: s.grand_total, vat: s.vat, taxMode: null,
      desc: cents(s.wht) > 0n ? await descOf(s.id) : null, vatDueBefore: '0.00', checked: true, applied: s.applied, wht: s.wht, whtBase: s.wht_base, remaining: s.voided ? null : now,
    };
  }));
  const others: Row[] = docs.filter((x) => x.status === 'posted' && cents(x.outstanding) > 0n && !settled.some((s) => s.id === x.id))
    .sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date))
    .map((x) => ({ id: x.id, docNo: x.doc_no ?? '', due: x.due_date, outstanding: x.outstanding ?? '0.00', grandTotal: x.grand_total, vat: x.vat, taxMode: x.tax_mode, desc: null, vatDueBefore: '0.00', checked: false, applied: '', wht: '0.00', whtBase: null, remaining: x.outstanding }));

  // ใบวางบิลที่อ้างอิง: ref ของใบรับชำระ หรือใบวางบิลก่อนวันรับเงินที่มีใบที่ตัดรอบนี้มากที่สุด
  let billingNo: string | null = d.ref?.doc_type === 'BN' ? d.ref.doc_no : null;
  if (!billingNo) {
    let best = 0;
    for (const bn of bns.filter((b) => b.issue_date <= d.doc.issue_date && b.status !== 'voided')) {
      const hit = (await detail(bn.id)).billing.filter((it) => settled.some((s) => s.id === it.id)).length;
      if (hit > best) { best = hit; billingNo = bn.doc_no; }
    }
  }
  const voidJournalNo = d.doc.void_journal_id ? (await api<{ journal_no: string }>(`/v1/journals/${d.doc.void_journal_id}`)).journal_no : null;
  let warnings: string[] = [];
  try { warnings = sp.w ? (JSON.parse(sp.w) as string[]).filter((x) => typeof x === 'string') : []; } catch { warnings = []; }

  return (
    <Shell active="receipt">
      <ReceiptScreen mode="view" today={d.doc.issue_date} contacts={[]} accounts={[]} rows={[...rows, ...others]} warnings={warnings}
        view={{ doc: d.doc, contactLabel: d.contact ? `${d.contact.code} · ${d.contact.name}` : '', journal: d.journal, billingNo, voidJournalNo, cheque: d.cheques?.[0] ?? null }} />
    </Shell>
  );
}
