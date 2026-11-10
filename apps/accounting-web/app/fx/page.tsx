// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// สกุลเงิน · อัตราแลกเปลี่ยน · ปรับมูลค่าสิ้นงวด · ทะเบียนสาขา (Phase 2A FXB · docs/technical-plan-P2A.md "FXB")
// ข้อมูล: GET /v1/modules · /v1/fx/currencies · /v1/fx/rates?currency=&from=&to= · /v1/fx/settings · /v1/fx/revaluation?year= · /v1/periods?year= · /v1/branches
import { api, type Context } from '../lib/api';
import { Shell } from '../lib/shell';
import { companyModules } from '../_p2a/server';
import type { Branch, Currency } from '../_p2a/types';
import { FxScreen, type FxSettings, type PeriodRow, type RateRow, type RevalRun } from './_screen';

const ISO = /^\d{4}-\d{2}-\d{2}$/u;

export default async function FxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [modules, ctx] = await Promise.all([companyModules(), api<Context>('/v1/context')]);
  const year = ctx.period?.fiscal_year ?? 2569;
  const filter = { currency: sp.currency && /^[A-Z]{3}$/u.test(sp.currency) ? sp.currency : '', from: sp.from && ISO.test(sp.from) ? sp.from : '', to: sp.to && ISO.test(sp.to) ? sp.to : '' };
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const fxOn = modules.multi_currency;
  const [currencies, rates, settings, runs, periods, branches] = await Promise.all([
    fxOn ? api<Currency[]>('/v1/fx/currencies') : Promise.resolve([]),
    fxOn ? api<RateRow[]>(`/v1/fx/rates${qs ? `?${qs}` : ''}`) : Promise.resolve([]),
    api<FxSettings>('/v1/fx/settings').catch(() => null),
    fxOn ? api<RevalRun[]>(`/v1/fx/revaluation?year=${year}`).catch(() => []) : Promise.resolve([]),
    api<PeriodRow[]>(`/v1/periods?year=${year}`).catch(() => []),
    modules.branches ? api<Branch[]>('/v1/branches') : Promise.resolve([]),
  ]);
  return (
    <Shell active="fx">
      <FxScreen modules={modules} currencies={currencies} rates={rates} filter={filter} settings={settings} runs={runs} periods={periods.filter((p) => p.period_no >= 1 && p.period_no <= 12)}
        current={{ year, period: ctx.period?.period_no ?? 12 }} branches={branches} today={process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10)} />
    </Shell>
  );
}
