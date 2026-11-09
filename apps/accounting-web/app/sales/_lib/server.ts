// โหลดข้อมูลฝั่ง server ที่ฟอร์มขายใช้ร่วม (session ของผู้ใช้ผ่าน api())
import 'server-only';
import { api, type Context } from '../../lib/api';
import type { Account, Contact, DocDetail, DocRow, Rule } from './doc.ts';

export const appToday = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

export interface FormBase { ctx: Context; contacts: Contact[]; accounts: Account[]; rules: Rule[]; today: string }

export async function formBase(): Promise<FormBase> {
  const ctx = await api<Context>('/v1/context');
  const [contacts, accounts, rules] = await Promise.all([
    api<Contact[]>('/v1/contacts'),
    api<Account[]>(`/v1/accounts?year=${ctx.period?.fiscal_year ?? 2569}&period=${ctx.period?.period_no ?? 12}`),
    api<Rule[]>('/v1/rules'),
  ]);
  return { ctx, contacts: contacts.filter((c) => c.kind !== 'vendor'), accounts, rules: rules.map((r) => ({ code: r.code, docType: r.docType, name: r.name })), today: appToday() };
}

/** ใบเสนอราคา (ScreenQuote): ต้นทุนประมาณต่อหน่วยของสินค้า + ตัวเลือกพนักงานขาย/โครงการที่เคยใช้ */
export interface QuoteExtras { estCosts: Record<string, string>; salespersons: string[]; projects: string[] }
export async function quoteExtras(): Promise<QuoteExtras> {
  const [products, fields] = await Promise.all([
    // ผู้ใช้ที่ไม่มีสิทธิ์อ่านข้อมูลหลัก → ไม่แสดงต้นทุนของบรรทัดใหม่ (บรรทัดที่บันทึกแล้วมีต้นทุนในเอกสาร)
    api<{ rows: { code: string; est_cost: string | null }[] }>('/v1/master/products').catch(() => ({ rows: [] })),
    api<{ salespersons: string[]; projects: string[] }>('/v1/document-fields'),
  ]);
  return { estCosts: Object.fromEntries(products.rows.filter((p) => p.est_cost !== null).map((p) => [p.code, p.est_cost!])), ...fields };
}

export const getDoc = (id: string): Promise<DocDetail> => api<DocDetail>(`/v1/documents/${encodeURIComponent(id)}`);
export const listDocs = (qs: string): Promise<DocRow[]> => api<DocRow[]>(`/v1/documents?${qs}`);

/** ชื่อบัญชีตามรหัส (ใช้ใน "ตัวอย่างการลงบัญชี") */
export const accountNames = (accounts: Account[]): Record<string, string> => Object.fromEntries(accounts.map((a) => [a.code, a.name]));
