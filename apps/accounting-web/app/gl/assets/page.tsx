// B6 ทะเบียนทรัพย์สิน — design/project/ScreenAssets.dc.html (Sidebar active="assets")
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { AssetsScreen, type AssetRow } from './_screen';

const pad = (n: number) => String(n).padStart(2, '0');

export default async function AssetsPage() {
  const { year, period } = await currentPeriod();
  const y = year - 543;
  const ym = `${y}-${pad(period)}`;
  const end = `${ym}-${pad(new Date(Date.UTC(y, period, 0)).getUTCDate())}`;
  const [assets, accounts] = await Promise.all([
    api<AssetRow[]>(`/v1/assets?month=${ym}`),
    api<{ code: string; name: string }[]>(`/v1/accounts?year=${year}&period=${period}`),
  ]);
  // ลงค่าเสื่อมงวดนี้แล้วหรือยัง: หา JV "ค่าเสื่อมราคา n/ปี" (runDepreciation · packages/db/src/close-ops.ts) ในแยกประเภทบัญชีค่าเสื่อม
  // TODO(backend): ควรมี API สถานะ acct.depreciation_run ต่องวด (journal_no, total) แทนการค้นจากแยกประเภท
  const expense = [...new Set(assets.map((a) => a.expense))];
  const ledgers = await Promise.all(expense.map((a) => api<{ rows: { journal_no: string; description: string | null }[] }>(`/v1/ledger?account=${a}&from=${ym}-01&to=${end}`)));
  const journalNo = ledgers.flatMap((l) => l.rows).find((r) => r.description === `ค่าเสื่อมราคา ${period}/${year}`)?.journal_no ?? null;
  return (
    <Shell active="assets">
      <AssetsScreen year={year} period={period} monthEnd={end} assets={assets} journalNo={journalNo} names={Object.fromEntries(accounts.map((a) => [a.code, a.name]))} />
    </Shell>
  );
}
