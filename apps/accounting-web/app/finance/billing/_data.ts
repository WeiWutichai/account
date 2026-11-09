// ข้อมูลหน้าใบวางบิล (ScreenBilling.dc.html) — ยอดรับแล้ว/ค้างคำนวณจากการตัดยอดจริงของใบที่วางบิล
import 'server-only';
import { money } from '@innovera/ui';
import { billingSummaries, detailCache, listDocs, type BillingSummary } from '../_shared/data';
import { cents } from '../_shared/num';
import { weekday, type DocRow } from '../_shared/types';
import type { BillRow, CalendarRow } from './_screen';

export async function billingData(contactId: string | null, thisId: string | null, today: string) {
  const detail = detailCache();
  const [allBns, invoices] = await Promise.all([listDocs({ type: 'BN' }), contactId ? listDocs({ type: 'IV,DN', contact: contactId }) : Promise.resolve([] as DocRow[])]);
  const bns = allBns.filter((b) => b.status !== 'voided');
  const allInvoices = new Map((await listDocs({ type: 'IV,DN', status: 'posted' })).map((x) => [x.id, x]));
  const sums = await billingSummaries(bns, allInvoices, detail);
  const self = thisId ? sums.find((s) => s.row.id === thisId) ?? null : null;
  const inv = new Map(invoices.map((x) => [x.id, x]));

  // ใบนี้อยู่ในใบวางบิลอื่นใบไหน
  const otherBn = (id: string): BillingSummary | undefined => sums.find((s) => s.row.id !== thisId && s.row.contact_id === contactId && s.items.some((it) => it.id === id));
  const refOf = async (id: string, billedHere: boolean): Promise<string> => {
    const o = billedHere ? undefined : otherBn(id);
    const d = await detail(id);
    if (o) {
      const paid = d.settlementsIn.filter((s) => !s.voided && s.doc_type === 'RV').map((s) => s.issue_date).sort().at(-1);
      return `วางบิลแล้ว ${o.row.doc_no ?? ''}${paid ? ` · รับชำระ ${paid.slice(8, 10)}/${paid.slice(5, 7)}` : ''}`;
    }
    return d.doc.reference ?? d.lines.find((l) => l.description)?.description ?? '';
  };
  const toRow = async (id: string, checked: boolean): Promise<BillRow | null> => {
    const x = inv.get(id) ?? allInvoices.get(id);
    if (!x) return null;
    return { id, docNo: x.doc_no ?? '', issue: x.issue_date, due: x.due_date, ref: await refOf(id, checked), total: x.grand_total, outstanding: x.outstanding ?? '0.00', checked };
  };
  const billed = self ? self.items.map((it) => it.id) : [];
  const open = invoices.filter((x) => x.status === 'posted' && cents(x.outstanding) > 0n && !billed.includes(x.id))
    .sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date)).map((x) => x.id);
  const rows = (await Promise.all([...billed.map((id) => toRow(id, true)), ...open.map((id) => toRow(id, false))])).filter((r): r is BillRow => r !== null);

  // ปฏิทินนัดรับเงิน: ใบวางบิลที่มีวันนัด เรียงตามวันนัด
  const calendar: CalendarRow[] = sums.filter((s) => s.row.due_date).sort((a, b) => a.row.due_date!.localeCompare(b.row.due_date!)).map((s) => {
    const due = s.row.due_date!;
    const who = `${s.row.contact_name ?? ''} · ${s.row.doc_no ?? ''}`;
    const rvs = s.receipts.map((r) => r.doc_no).join(', ');
    if (cents(s.outstanding) === 0n) return { due, weekday: weekday(due), text: `${who} · รับแล้ว${rvs ? ` (${rvs})` : ''}`, amount: s.received, tone: 'ok' };
    if (cents(s.received) > 0n) return { due, weekday: weekday(due), text: `${who} · รับบางส่วน ${money(s.received).replace(/\.00$/u, '')} · ค้าง`, amount: s.outstanding, tone: 'part' };
    return { due, weekday: weekday(due), text: `${who} · ยังไม่ได้รับ`, amount: s.outstanding, tone: due < today ? 'late' : 'none' };
  });
  return { self, rows, calendar };
}
