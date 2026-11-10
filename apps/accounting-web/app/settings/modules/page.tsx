// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ตั้งค่า / โมดูล (Phase 2A) — เปิด/ปิดโมดูล + ค่าตั้ง "รอยืนยัน (ผู้สอบบัญชี)" ตามตาราง config ใน docs/technical-plan-P2A.md
// ข้อมูล: GET /v1/modules · /v1/inventory/status · /v1/fx/settings · /v1/swt/settings
import { api } from '../../lib/api';
import { Shell } from '../../lib/shell';
import type { CompanyModules } from '../../_p2a/types';
import { ModulesScreen } from './_screen';

interface InvStatus { enabled: boolean; settings: { method: string; costing: string; writedownNrv: boolean } }
interface FxbSettings { rateSource: string; revaluePeriodEnd: boolean; numbering: string; vatFiling: string }
type SwtSettings = Record<string, { value: unknown; default: unknown; pendingAuditor: true }>;

export default async function ModulesPage() {
  const [modules, inv, fxs, swt] = await Promise.all([
    api<CompanyModules>('/v1/modules'),
    api<InvStatus>('/v1/inventory/status').catch(() => null),
    api<FxbSettings>('/v1/fx/settings').catch(() => null),
    api<SwtSettings>('/v1/swt/settings').catch(() => null),
  ]);
  const values: Record<string, unknown> = {
    ...(inv ? { 'inventory.method': inv.settings.method, 'inventory.costing': inv.settings.costing, 'inventory.writedown_nrv': inv.settings.writedownNrv } : {}),
    ...(fxs ? { 'fx.rate_source': fxs.rateSource, 'fx.revalue_period_end': fxs.revaluePeriodEnd, 'branch.vat_filing': fxs.vatFiling, 'branch.numbering': fxs.numbering } : {}),
    ...(swt ? Object.fromEntries(Object.entries(swt).map(([k, v]) => [k, v.value])) : {}),
  };
  return (
    <Shell active="modules">
      <ModulesScreen modules={modules} values={values} />
    </Shell>
  );
}
