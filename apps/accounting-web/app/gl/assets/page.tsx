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
  // ลงค่าเสื่อมงวดนี้แล้วหรือยัง: สถานะ acct.depreciation_run ต่องวด (GET /v1/assets/depreciation)
  const runs = await api<{ period_no: number; journal_no: string; total: string }[]>(`/v1/assets/depreciation?year=${year}`);
  const journalNo = runs.find((r) => r.period_no === period)?.journal_no ?? null;
  return (
    <Shell active="assets">
      <AssetsScreen year={year} period={period} monthEnd={end} assets={assets} journalNo={journalNo} names={Object.fromEntries(accounts.map((a) => [a.code, a.name]))} />
    </Shell>
  );
}
