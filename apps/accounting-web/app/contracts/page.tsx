// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// Phase 2A SWT — สัญญา/รายได้รับล่วงหน้า: ตัวชี้วัด (GET /v1/contracts-metrics) · รายการสัญญา (GET /v1/contracts) · รับรู้รายได้รายงวด (GET /v1/revenue-recognition?year)
// + สินทรัพย์ไม่มีตัวตน (POST /v1/intangible-assets → แสดงใน /gl/assets) · ไม่มีไฟล์ .dc.html — Wei สั่งให้ใช้งานได้ก่อน (docs/technical-plan-P2A.md กติกาข้อ 1)
import { css } from '@innovera/ui';
import { api } from '../lib/api';
import { currentPeriod, Shell } from '../lib/shell';
import { today } from '../finance/_shared/types';
import { ModuleOff, MODULE_OFF_RE, PageHead, ST, type ContractRow, type Metrics, type RecognitionRun } from './_lib';
import { ContractsScreen } from './_screen';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/u;

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { year: curYear, period } = await currentPeriod();
  const month = sp.month && YM.test(sp.month) ? sp.month : today().slice(0, 7);
  const year = sp.year && /^\d{4}$/u.test(sp.year) ? Number(sp.year) : curYear;
  let metrics: Metrics;
  try {
    metrics = await api<Metrics>(`/v1/contracts-metrics?month=${month}`);
  } catch (e) {
    if (!(e instanceof Error) || !MODULE_OFF_RE.test(e.message)) throw e;
    return (
      <Shell active="contracts">
        <PageHead crumb="โมดูลเพิ่มเติม / สัญญาและรายได้รับล่วงหน้า" title="สัญญาและรายได้รับล่วงหน้า" />
        <div style={css(ST.page)}><ModuleOff /></div>
      </Shell>
    );
  }
  const [contracts, runs, assets] = await Promise.all([api<ContractRow[]>('/v1/contracts'), api<RecognitionRun[]>(`/v1/revenue-recognition?year=${year}`),
    api<{ code: string }[]>(`/v1/assets?month=${today().slice(0, 7)}`).catch(() => [])]);
  return (
    <Shell active="contracts">
      <PageHead crumb="โมดูลเพิ่มเติม / สัญญาและรายได้รับล่วงหน้า" title="สัญญาและรายได้รับล่วงหน้า"
        sub={`มาตรฐาน ${metrics.standard === 'npae' ? 'TFRS for NPAEs' : 'TFRS 15'} (รอยืนยัน) · รอบบิลสร้างใบแจ้งหนี้ "ร่าง" ให้ตรวจและอนุมัติที่หน้าใบแจ้งหนี้`} />
      <div style={css(ST.page)}>
        <ContractsScreen month={month} metrics={metrics} contracts={contracts} year={year} currentYear={curYear} currentPeriod={period} runs={runs} today={today()} assetCodes={assets.map((a) => a.code)} />
      </div>
    </Shell>
  );
}

