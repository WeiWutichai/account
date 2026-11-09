// S7 เงินมัดจำ — design/project/ScreenDeposit.dc.html (Sidebar active="deposit")
// ?iv=<id ใบกำกับร่าง> = ใบกำกับที่จะตัดมัดจำในแผงล่าง
import { api, type Context } from '../../lib/api';
import { Shell } from '../../lib/shell';
import type { Account, DocDetail } from '../_lib/doc';
import { daysBetween, docNo } from '../_lib/doc';
import { DepositView, type DepositRow, type ApplyTarget } from '../_lib/DepositView';
import { divRound, fromCents, toCents } from '../_lib/num';
import { appToday, getDoc, listDocs } from '../_lib/server';

/** ยอดฐานก่อน VAT → รวม VAT ตามสัดส่วนของใบมัดจำ (แสดงผลเท่านั้น) */
const inclVat = (base: bigint, dp: DocDetail['doc']) => (toCents(dp.subtotal) === 0n ? base : divRound(base * toCents(dp.grand_total), toCents(dp.subtotal)));

export default async function DepositsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = appToday();
  const ctx = await api<Context>('/v1/context');
  const [dps, accounts, ivDrafts] = await Promise.all([
    listDocs('type=DP'),
    api<Account[]>(`/v1/accounts?year=${ctx.period?.fiscal_year ?? 2569}&period=${ctx.period?.period_no ?? 12}`),
    listDocs('type=IV&status=draft'),
  ]);
  const details = await Promise.all(dps.map((d) => getDoc(d.id)));
  const month = today.slice(0, 7);

  const rows: DepositRow[] = details.map((x) => {
    const dp = x.doc;
    const apps = x.settlementsOut.filter((s) => !s.voided);
    const appliedBase = apps.reduce((s, a) => s + toCents(a.applied), 0n);
    const total = toCents(dp.grand_total);
    const received = dp.status === 'posted' ? total : 0n;
    const applied = inclVat(appliedBase, dp);
    const remaining = dp.status === 'voided' ? 0n : total - applied;
    const age = daysBetween(dp.issue_date, today);
    const lastIv = [...apps].sort((a, b) => a.issue_date.localeCompare(b.issue_date)).pop();
    // TODO(Wei): ป้ายสถานะมัดจำตาม ScreenDeposit.dc.html — "ร่าง"/"ยกเลิก" ไม่มีในแบบร่าง
    const status = dp.status === 'voided' ? { kind: 'error' as const, text: 'ยกเลิก' }
      : dp.status === 'draft' ? { kind: 'info' as const, text: 'ร่าง' }
      : dp.status !== 'posted' ? { kind: 'warning' as const, text: 'แจ้งหนี้แล้ว รอรับเงิน' }
      : remaining <= 0n ? { kind: 'success' as const, text: `ตัดครบ${lastIv?.doc_no ? ` · ${lastIv.doc_no}` : ''}` }
      : age > 180 && appliedBase === 0n ? { kind: 'error' as const, text: `ค้าง ${age} วัน` }
      : appliedBase > 0n ? { kind: 'info' as const, text: 'รับแล้ว · ตัดบางส่วน' }
      : { kind: 'info' as const, text: 'รับแล้ว' };
    const refText = [x.ref ? docNo(x.ref) : x.doc.reference, x.lines.find((l) => l.line_type === 'item')?.description].filter(Boolean).join(' · ');
    return {
      id: dp.id, docNo: docNo(dp), date: dp.issue_date, contactId: dp.contact_id, contact: x.contact?.name ?? '—', ref: refText || '—', total: dp.grand_total,
      received: fromCents(received), applied: fromCents(applied), remaining: fromCents(remaining), status, posted: dp.status === 'posted', age,
      remainingBase: fromCents(toCents(dp.subtotal) - appliedBase), appliedThisMonth: fromCents(inclVat(apps.filter((a) => a.issue_date.startsWith(month)).reduce((s, a) => s + toCents(a.applied), 0n), dp)),
      ivThisMonth: apps.filter((a) => a.issue_date.startsWith(month)).map((a) => a.id), journal: x.journal, receivedNo: docNo(dp),
    };
  });

  const open = rows.filter((r) => r.posted && toCents(r.remaining) > 0n);
  const pending = rows.filter((r) => !r.posted && r.status.text !== 'ยกเลิก');
  const liability = accounts.find((a) => a.code === '2140100')?.balance ?? '0.00';
  const summary = {
    liability: fromCents(-toCents(liability)), openCount: open.length, openCustomers: new Set(open.map((r) => r.contactId)).size,
    pendingTotal: fromCents(pending.reduce((s, r) => s + toCents(r.total), 0n)), pendingCount: pending.length,
    appliedMonth: fromCents(rows.reduce((s, r) => s + toCents(r.appliedThisMonth), 0n)), appliedInvoices: new Set(rows.flatMap((r) => r.ivThisMonth)).size,
    stale: fromCents(open.filter((r) => r.age > 180).reduce((s, r) => s + toCents(r.remaining), 0n)),
  };

  // แผง "ตัดมัดจำในใบกำกับภาษี" — ใบกำกับร่างของลูกค้าที่มีมัดจำคงเหลือ
  const withDeposit = new Set(open.map((r) => r.contactId));
  const candidates = ivDrafts.filter((d) => d.contact_id && withDeposit.has(d.contact_id));
  const ivId = sp.iv ?? candidates[0]?.id;
  const target: ApplyTarget | null = ivId ? { detail: await getDoc(ivId) } : null;

  return (
    <Shell active="deposit">
      <DepositView rows={rows} summary={summary} candidates={candidates.map((c) => ({ id: c.id, label: `${docNo(c)} · ${c.contact_name ?? ''}` }))} target={target}
        names={Object.fromEntries(accounts.map((a) => [a.code, a.name]))} />
    </Shell>
  );
}
