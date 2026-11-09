// โหลดข้อมูลฝั่ง server ที่ฟอร์มซื้อใช้ร่วม (session ของผู้ใช้ผ่าน api())
import 'server-only';
import { api, type Context } from '../../lib/api';
import { appToday } from '../../sales/_lib/server.ts';
import type { Account, PContact, PDetail, PRow, WhtTypeDef } from './types.ts';

export { appToday };

export interface PeriodRow { fiscal_year: number; period_no: number; starts_on: string; ends_on: string; status: string }
export interface PurchaseBase { ctx: Context; vendors: PContact[]; accounts: Account[]; whtTypes: Record<string, WhtTypeDef>; names: Record<string, string>; today: string }

export async function purchaseBase(): Promise<PurchaseBase> {
  const ctx = await api<Context>('/v1/context');
  const [contacts, accounts, whtTypes] = await Promise.all([
    api<PContact[]>('/v1/contacts'),
    api<Account[]>(`/v1/accounts?year=${ctx.period?.fiscal_year ?? 2569}&period=${ctx.period?.period_no ?? 12}`),
    api<Record<string, WhtTypeDef>>('/v1/wht-types'),
  ]);
  return {
    ctx, vendors: contacts.filter((c) => c.kind !== 'customer'), accounts, whtTypes,
    names: Object.fromEntries(accounts.map((a) => [a.code, a.name])), today: appToday(),
  };
}

export const getPDoc = (id: string): Promise<PDetail> => api<PDetail>(`/v1/documents/${encodeURIComponent(id)}`);
export const listPDocs = (qs: string): Promise<PRow[]> => api<PRow[]>(`/v1/documents?${qs}`);
export const periods = (year: number): Promise<PeriodRow[]> => api<PeriodRow[]>(`/v1/periods?year=${year}`).catch(() => []);
