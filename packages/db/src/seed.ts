// seed ข้อมูลตั้งต้นของบริษัทจาก fixtures/sample-company.json (แหล่งตัวเลขเดียว) · รันซ้ำได้ (upsert)
// TODO(Wei): CLAUDE.md ระบุผังบัญชีบริการ 186 บัญชี แต่ไม่มีรายการในไฟล์ใด (ScreenCOA = 84, fixtures = 53) → seed ตาม fixtures ไปก่อน
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AccountType, Db } from './index.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/sample-company.json', import.meta.url));

interface FxAccount { code: string; name: string; type: AccountType; control?: 'ar' | 'ap' }
interface FxContact { code: string; name: string; type: 'customer' | 'vendor'; tax_id?: string }
interface FxProduct { code: string; name: string; unit?: string; price?: string; price_2?: string; vat?: boolean; revenue_account?: string; type?: string }
interface Fixtures { chart_of_accounts: FxAccount[]; contacts: FxContact[]; products: FxProduct[] }

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(FIXTURES, 'utf8')) as Fixtures;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** หมวดย่อยตามรหัสบัญชี (ผังบริการ) — ใช้แสดงใน ScreenCOA */
export function categoryOf(code: string, type: AccountType): string {
  if (type === 'asset' || type === 'contra_asset') return code < '1500000' ? 'สินทรัพย์หมุนเวียน' : 'สินทรัพย์ไม่หมุนเวียน';
  if (type === 'liability') return code < '2300000' ? 'หนี้สินหมุนเวียน' : 'หนี้สินไม่หมุนเวียน';
  if (type === 'equity') return 'ส่วนของเจ้าของ';
  if (type === 'revenue' || type === 'contra_revenue') return 'รายได้';
  return code.startsWith('53') || code.startsWith('54') ? 'ค่าใช้จ่ายในการบริหาร' : 'ค่าใช้จ่าย';
}

/** ข้อความ "คุม / ผูกกับ" ของบัญชีที่ระบบใช้เฉพาะ (ScreenCOA) */
export const BINDINGS: Readonly<Record<string, string>> = {
  '1130100': 'บัญชีคุม · ต้องระบุคู่ค้า',
  '2110100': 'บัญชีคุม · ต้องระบุคู่ค้า',
  '1160100': 'รายงานภาษีถูกหัก',
  '2150100': 'รายงานภาษีขาย · ภ.พ.30',
  '2150300': 'ภ.ง.ด.3/53',
  '4100100': 'ค่าเริ่มต้นสูตร IV',
  '4101100': 'mapping TMS',
  '5301200': 'WHT 3% ตั้งต้น',
};
/** งวดปีบัญชี ปฏิทิน (01-01) · fiscalYear = พ.ศ. · งวด 0 = ยอดยกมา (31 ธ.ค. ปีก่อน) · งวด 13 = 31 ธ.ค. (ปรับปรุงปิดปี) */
export function calendarPeriods(fiscalYear: number) {
  const y = fiscalYear - 543;
  const opening = { period_no: 0, starts_on: `${y - 1}-12-31`, ends_on: `${y - 1}-12-31` };
  const months = Array.from({ length: 12 }, (_, i) => {
    const last = new Date(Date.UTC(y, i + 1, 0)).getUTCDate();
    return { period_no: i + 1, starts_on: `${y}-${pad(i + 1)}-01`, ends_on: `${y}-${pad(i + 1)}-${pad(last)}` };
  });
  return [opening, ...months, { period_no: 13, starts_on: `${y}-12-31`, ends_on: `${y}-12-31` }];
}

export interface SeedResult { accounts: number; periods: number; contacts: number; products: number }

export async function seedCompany(db: Db, companyId: string, fiscalYear = 2569): Promise<SeedResult> {
  const fx = loadFixtures();
  return db.withCompany(companyId, async (tx) => {
    for (const a of fx.chart_of_accounts) {
      await tx.insertInto('acct.account').values({
        company_id: companyId, code: a.code, name: a.name, type: a.type, parent_code: null,
        is_control: Boolean(a.control), control_kind: a.control ?? null, requires_contact: Boolean(a.control),
        category: categoryOf(a.code, a.type), binding: BINDINGS[a.code] ?? null,
      }).onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: a.name, category: categoryOf(a.code, a.type), binding: BINDINGS[a.code] ?? null })).execute();
    }
    for (const p of calendarPeriods(fiscalYear)) {
      await tx.insertInto('acct.period').values({ company_id: companyId, fiscal_year: fiscalYear, ...p, closed_at: null, closed_by: null })
        .onConflict((oc) => oc.columns(['company_id', 'fiscal_year', 'period_no']).doNothing()).execute();
    }
    for (const c of fx.contacts) {
      await tx.insertInto('acct.contact').values({ company_id: companyId, code: c.code, name: c.name, kind: c.type, tax_id: c.tax_id ?? null,
        branch_code: null, external_source: null, external_ref: null }).onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: c.name })).execute();
    }
    const accounts = new Set(fx.chart_of_accounts.map((a) => a.code));
    for (const p of fx.products) {
      await tx.insertInto('acct.product').values({ company_id: companyId, code: p.code, name: p.name, unit: p.unit ?? null,
        kind: p.type === 'goods' ? 'goods' : 'service', price: p.price ?? null, price_2: p.price_2 ?? null, vat: p.vat ?? true,
        revenue_account: p.revenue_account && accounts.has(p.revenue_account) ? p.revenue_account : null, expense_account: null })
        .onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: p.name, price: p.price ?? null })).execute();
    }
    const count = async (t: 'acct.account' | 'acct.period' | 'acct.contact' | 'acct.product') =>
      Number((await tx.selectFrom(t).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
    return { accounts: await count('acct.account'), periods: await count('acct.period'), contacts: await count('acct.contact'), products: await count('acct.product') };
  });
}
