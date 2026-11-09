// F6 กระทบยอดธนาคาร — design/project/ScreenBankRecon.dc.html
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { BankReconScreen, type Recon } from './_screen';

interface Account { code: string; name: string }
const pad = (n: number) => String(n).padStart(2, '0');

export default async function BankReconPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { year, period } = await currentPeriod();
  const y = year - 543;
  const from = `${y}-${pad(period)}-01`;
  const asOf = `${y}-${pad(period)}-${pad(new Date(Date.UTC(y, period, 0)).getUTCDate())}`;
  const accounts = await api<Account[]>(`/v1/accounts?year=${year}&period=${period}`);
  // บัญชีเงินฝากธนาคาร (11001xx–11002xx ในผังบริการ) · ชื่อแสดงตัดคำว่า "เงินฝากธนาคาร" ตามแบบร่าง
  const banks = accounts.filter((a) => /^1100\d{3}$/u.test(a.code) && a.name.includes('ธนาคาร')).map((a) => ({ code: a.code, label: `${a.code} ${a.name.replace(/^เงินฝากธนาคาร\s*/u, '')}` }));
  const account = banks.find((b) => b.code === sp.account)?.code ?? banks[0]?.code ?? '1100100';
  // รายการ statement ที่จับคู่แล้วพร้อม journal (1 ต่อหลาย) · ข้อเสนอการจับคู่ · สถานะปิดกระทบยอดของเดือน — จาก GET bank/:account/reconciliation
  const rec = await api<Recon>(`/v1/bank/${account}/reconciliation?asOf=${asOf}`);
  return (
    <Shell active="bank">
      <BankReconScreen banks={banks} account={account} year={year} period={period} from={from} asOf={asOf} rec={rec} />
    </Shell>
  );
}
