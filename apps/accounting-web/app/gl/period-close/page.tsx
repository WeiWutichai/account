// B5 ปิดงวดบัญชี — design/project/ScreenPeriodClose.dc.html (Sidebar active="close")
import { href, money, thaiMonth } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { fromCents, toCents } from '../../sales/_lib/num';
import { PeriodCloseScreen, type Check, type PeriodRow } from './_screen';

interface Period { period_no: number; status: 'open' | 'soft_closed' | 'hard_closed'; closed_at: string | null; draftJournals: number; pendingDocuments: number }
interface TbLine { account: string; debit: string; credit: string; balance: string }
interface Statements { pl: { revenue: TbLine[]; expense: TbLine[]; totalRevenue: string; totalExpense: string; profit: string }; bs: { assets: TbLine[]; liabilities: TbLine[]; equity: TbLine[] } }
/** จำนวนรายการ statement (ไม่ใช่ยอดเงิน) */
type Count = number;
interface Recon { diff: string; total: Count }
interface Aging { gl: { diff: string } }
interface AuditRow { at: string; action: string; entity_id: string; after: unknown }

const pad = (n: number) => String(n).padStart(2, '0');
const cents = toCents;
const money2 = fromCents;

export default async function PeriodClosePage() {
  const { year, period: current } = await currentPeriod();
  const y = year - 543;
  const end = (n: number) => `${y}-${pad(n)}-${pad(new Date(Date.UTC(y, n, 0)).getUTCDate())}`;
  const upTo = Array.from({ length: current }, (_, i) => i + 1);
  const [periods, accounts, assets, audit, arAging, apAging, ...stmts] = await Promise.all([
    api<Period[]>(`/v1/periods?year=${year}`),
    api<{ code: string; name: string }[]>(`/v1/accounts?year=${year}&period=${current}`),
    api<{ expense: string }[]>(`/v1/assets?month=${y}-${pad(current)}`),
    api<AuditRow[]>('/v1/audit?entity=period').catch(() => [] as AuditRow[]),
    api<Aging>(`/v1/reports/aging?asOf=${end(current)}&side=AR`),
    api<Aging>(`/v1/reports/aging?asOf=${end(current)}&side=AP`),
    ...upTo.map((n) => api<Statements>(`/v1/reports/statements?year=${year}&period=${n}`)),
  ]);
  const banks = accounts.filter((a) => /^1100\d{3}$/u.test(a.code) && a.name.includes('ธนาคาร')).map((a) => a.code);
  // กระทบยอดธนาคารรายงวด: เฉพาะบัญชีที่มี statement ถึงสิ้นงวด
  const recon = await Promise.all(upTo.map((n) => Promise.all(banks.map(async (b) => ({ account: b, ...(await api<Recon>(`/v1/bank/${b}/reconciliation?asOf=${end(n)}`)) })))));
  const profit = (n: number) => (n === 0 ? 0n : cents(stmts[n - 1]!.pl.profit));
  const bankText = (n: number): PeriodRow['bank'] => {
    const rs = (recon[n - 1] ?? []).filter((r) => r.total > 0);
    if (!rs.length) return null;
    const bad = rs.find((r) => cents(r.diff) !== 0n);
    return bad ? { ok: false, diff: bad.diff, account: bad.account } : { ok: true, diff: '0.00', account: '' };
  };
  const rows: PeriodRow[] = periods.filter((p) => p.period_no >= 1 && p.period_no <= 13).map((p) => ({
    no: p.period_no, status: p.status, closedAt: p.closed_at, drafts: p.draftJournals + p.pendingDocuments,
    profit: p.period_no <= current ? money2(profit(p.period_no) - profit(p.period_no - 1)) : null,
    bank: p.period_no <= current ? bankText(p.period_no) : null,
  }));

  // ---------- รายการตรวจก่อนปิดงวดปัจจุบัน ----------
  const cur = stmts[current - 1]!;
  const all = [...cur.pl.revenue, ...cur.pl.expense, ...cur.bs.assets, ...cur.bs.liabilities, ...cur.bs.equity];
  const dr = all.reduce((s, l) => s + cents(l.debit), 0n);
  const cr = all.reduce((s, l) => s + cents(l.credit), 0n);
  const suspense = all.filter((l) => l.account === '2190100' || l.account === '1190100').reduce((s, l) => s + (cents(l.balance) < 0n ? -cents(l.balance) : cents(l.balance)), 0n);
  const agingDiff = [cents(arAging.gl.diff), cents(apAging.gl.diff)];
  // ค่าเสื่อมเดือนนี้: หา JV "ค่าเสื่อมราคา n/ปี" ในแยกประเภทบัญชีค่าเสื่อม (runDepreciation ใน packages/db/src/close-ops.ts)
  // TODO(backend): ควรมี API สถานะ acct.depreciation_run ต่องวดแทนการค้นจากแยกประเภท
  const expAccounts = [...new Set(assets.map((a) => a.expense))];
  const depLedgers = await Promise.all(expAccounts.map((a) => api<{ rows: { journal_no: string; description: string | null }[] }>(`/v1/ledger?account=${a}&from=${y}-${pad(current)}-01&to=${end(current)}`)));
  const depJv = depLedgers.flatMap((l) => l.rows).find((r) => r.description === `ค่าเสื่อมราคา ${current}/${year}`)?.journal_no ?? null;
  const curRow = rows.find((r) => r.no === current);
  const bank = curRow?.bank ?? null;
  const nextMonth = current === 12 ? 1 : current + 1;
  const checks: Check[] = [
    { mark: curRow?.drafts ? 'x' : 'ok', text: 'ไม่มีเอกสารสถานะร่างลงวันที่ในงวด', right: String(curRow?.drafts ?? 0) },
    { mark: dr === cr ? 'ok' : 'x', text: 'รายการบัญชี Dr = Cr ทุกรายการ', right: money(money2(dr)) }, // TODO(backend): จำนวนรายการบัญชีในงวด (แบบร่าง "1,284 รายการ") — ยังไม่มี API
    { mark: suspense === 0n ? 'ok' : 'x', text: 'บัญชีพักไม่มียอดคงเหลือ (2190100, 1190100)', right: money(money2(suspense)) },
    { mark: agingDiff.every((d) => d === 0n) ? 'ok' : 'x', text: 'อายุหนี้ AR/AP ตรงกับ GL', right: agingDiff.every((d) => d === 0n) ? '0.00' : `${money(money2(agingDiff[0]!))} / ${money(money2(agingDiff[1]!))}` },
    // TODO(Wei) ScreenPeriodClose.dc.html: ค่าเสื่อมยังไม่บันทึก จัดเป็น "!" (ก่อนปิดแข็ง) หรือ "✕" (ก่อนปิดอ่อน) — แบบร่างแสดงเฉพาะกรณีบันทึกแล้ว
    { mark: depJv ? 'ok' : expAccounts.length ? 'warn' : 'na', text: 'ค่าเสื่อมราคาเดือนนี้บันทึกแล้ว (อัตโนมัติ)', right: depJv ?? '—' },
    // TODO(M7): สถานะ webhook จาก TMS ยังไม่มี — แสดง "—"
    { mark: 'na', text: 'รายการจาก TMS นำเข้าครบ (ไม่มีค้างใน webhook)', right: '—' },
    { mark: bank?.ok ? 'ok' : 'x', text: 'กระทบยอดธนาคารครบทุกบัญชี', right: bank ? (bank.ok ? 'ครบ' : `${bank.account} ผลต่าง ${money(bank.diff)}`) : '—', href: href('bank') },
    // TODO(backend) ScreenPeriodClose.dc.html: ยังไม่มีการบันทึกสถานะ "ยื่นแล้ว" ของ ภ.พ.30 / ภ.ง.ด. — ถือเป็นร่างเสมอ (ครบกำหนดตาม tax.filing.online_extension)
    { mark: 'warn', text: 'ภ.พ.30 / ภ.ง.ด. บันทึกว่ายื่นแล้ว', right: `ยังเป็นร่าง (ครบกำหนด 15 / 23 ${thaiMonth(nextMonth)})`, href: href('tax') },
    { mark: 'warn', text: 'รายการปรับปรุงค้างรับ–ค้างจ่าย (accrual) ทบทวนแล้ว', right: '', button: 'ยืนยันทบทวนแล้ว' },
  ];
  const reopens = audit.filter((a) => a.action === 'period.reopen').map((a) => {
    const after = (typeof a.after === 'string' ? JSON.parse(a.after) : a.after) as { reason?: string } | null;
    return { at: a.at, period: a.entity_id, reason: after?.reason ?? '' };
  });
  return (
    <Shell active="close">
      <PeriodCloseScreen year={year} current={current} rows={rows} checks={checks} reopens={reopens}
        yearEnd={{ revenue: cur.pl.totalRevenue, expense: cur.pl.totalExpense, profit: cur.pl.profit }} />
    </Shell>
  );
}
