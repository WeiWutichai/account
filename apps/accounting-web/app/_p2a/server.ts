// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// โหลดข้อมูลโมดูล Phase 2A ฝั่ง server — โหลดเฉพาะโมดูลที่เปิด (ปิดทั้งหมด = เรียก /v1/modules ครั้งเดียว)
import 'server-only';
import { api } from '../lib/api';
import { MODULES_OFF, P2A_OFF, type Branch, type CompanyModules, type Currency, type P2A, type Warehouse } from './types';

export const companyModules = (): Promise<CompanyModules> => api<CompanyModules>('/v1/modules').catch(() => MODULES_OFF);

export async function p2aData(): Promise<P2A> {
  const modules = await companyModules();
  if (!modules.multi_currency && !modules.branches && !modules.inventory) return { ...P2A_OFF, modules };
  const [currencies, branches, warehouses] = await Promise.all([
    modules.multi_currency ? api<Currency[]>('/v1/fx/currencies') : Promise.resolve([]),
    modules.branches ? api<Branch[]>('/v1/branches') : Promise.resolve([]),
    modules.inventory ? api<Warehouse[]>('/v1/inventory/warehouses').catch(() => []) : Promise.resolve([]),
  ]);
  return { modules, currencies: currencies.filter((c) => c.active), branches: branches.filter((b) => b.active), warehouses: warehouses.filter((w) => w.active !== false) };
}
