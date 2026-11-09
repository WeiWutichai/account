// F7 อายุหนี้ — design/project/ScreenAging.dc.html (Sidebar active="aging")
import { parseThaiDate } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { AgingScreen, type Aging } from './_screen';

const pad = (n: number) => String(n).padStart(2, '0');

export default async function AgingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { year, period } = await currentPeriod();
  const y = year - 543;
  const monthEnd = `${y}-${pad(period)}-${pad(new Date(Date.UTC(y, period, 0)).getUTCDate())}`;
  const asOf = sp.asOf && /^\d{4}-\d{2}-\d{2}$/u.test(sp.asOf) ? sp.asOf : (sp.asOf ? parseThaiDate(sp.asOf) : null) ?? monthEnd;
  const side = sp.side === 'AP' ? 'AP' : 'AR';
  const [data, accounts] = await Promise.all([
    api<Aging>(`/v1/reports/aging?asOf=${asOf}&side=${side}`),
    api<{ code: string; name: string }[]>(`/v1/accounts?year=${year}&period=${period}`),
  ]);
  const control = accounts.find((a) => a.code === data.gl.account);
  return (
    <Shell active="aging">
      <AgingScreen data={data} side={side} asOf={asOf} controlName={control?.name ?? ''} />
    </Shell>
  );
}
