// Phase 2A FXB — หลายสกุลเงิน + สาขา (docs/technical-plan-P2A.md "FXB") · ทุกอย่างใน withCompany (RLS)
// - เอกสาร: ยอดเก็บเป็นสกุลเอกสาร · journal เป็นบาทเสมอ (ยอด × อัตรา ปัดบรรทัดสุดท้าย) · journal_line เก็บ currency + amount_fx
// - รับ/จ่าย: ล้างลูกหนี้/เจ้าหนี้ตามอัตราเดิม · ผลต่าง → 4910100 กำไร / 5920100 ขาดทุนจากอัตราแลกเปลี่ยน (บัญชีของโมดูล ไม่ใช้ 4900100 เดิม)
// - ปรับมูลค่าสิ้นงวด (ยังไม่เกิดขึ้นจริง) + กลับรายการวันแรกของงวดถัดไป — เปิดด้วย fx.revalue_period_end (ค่าตั้งต้น false)
// - สาขา: ทะเบียนรหัส 5 หลัก · เลขที่เอกสารแยกสาขา (branch.numbering) · รายงานภาษี/ภ.พ.30 กรองสาขา (reports.ts) · ยื่นแยก/รวม (branch.vat_filing)
// โมดูลปิด / บริษัทใช้บาทอย่างเดียว = พฤติกรรม Phase 1 เดิมทุกอย่าง (คอลัมน์ใหม่เป็น NULL)
import { BASE_CURRENCY, convertJournal, isRate, Money, revaluation, toBase, type CompanyRole, type JournalLine } from '@innovera/ledger';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, nextNumber, postJournalTx } from './ledger-service.ts';
import { categoryOf } from './seed.ts';

// ---------- บัญชีของโมดูล (สร้างเมื่อเปิดโมดูล · upsert ไม่ทับชื่อที่ผู้ใช้แก้) ----------
export const FX_GAIN_ACCOUNT = '4910100';
export const FX_LOSS_ACCOUNT = '5920100';
const FX_ACCOUNTS = [
  { code: FX_GAIN_ACCOUNT, name: 'กำไรจากอัตราแลกเปลี่ยน', type: 'revenue' as const },
  { code: FX_LOSS_ACCOUNT, name: 'ขาดทุนจากอัตราแลกเปลี่ยน', type: 'expense' as const },
];
const AR = '1130100';
const AP = '2110100';
/** บัญชีที่ยอดบาทต้อง = ยอด × อัตรา พอดี (บัญชีคุม/ภาษี/ส่วนลด/มัดจำ) — เศษปัดไปบรรทัดรายได้/ค่าใช้จ่าย */
const FIXED_ACCOUNTS = new Set([AR, AP, '2150100', '2150400', '1170100', '2150300', '1160100', '4190100', '2140100']);

// ---------- ค่าตั้ง [ผู้สอบบัญชี] (acct.company_setting) ----------
// TODO(Wei): ทุกค่าด้านล่างเป็น "รอยืนยัน" จากผู้สอบบัญชี — ค่าตั้งต้นชั่วคราวตาม docs/technical-plan-P2A.md ตาราง config · ระบบไม่ตัดสินเอง
export const FXB_KEYS = {
  /** อัตราที่ใช้: กลาง/ซื้อ/ขาย ของ ธปท. (กรอกเอง ไม่ดึงจากภายนอก) · TODO(Wei) รอผู้สอบบัญชี */
  rateSource: 'fx.rate_source',
  /** ปรับมูลค่าลูกหนี้/เจ้าหนี้สกุลต่างประเทศสิ้นงวด (ยังไม่เกิดขึ้นจริง) + กลับรายการต้นงวดถัดไป · TODO(Wei) รอผู้สอบบัญชี */
  revaluePeriodEnd: 'fx.revalue_period_end',
  /** เลขที่เอกสาร: ร่วมทุกสาขา / แยกต่อสาขา · TODO(Wei) รอผู้สอบบัญชี (รูปแบบเลขแยกสาขายังไม่มีในแบบร่าง) */
  numbering: 'branch.numbering',
  /** ภ.พ.30: ยื่นแยกสาขา / ยื่นรวม (ต้องได้รับอนุมัติจากกรมสรรพากร) · TODO(Wei) รอผู้สอบบัญชี */
  vatFiling: 'branch.vat_filing',
} as const;
export type RateSource = 'bot_mid' | 'bot_buy' | 'bot_sell';
export interface FxbSettings { rateSource: RateSource; revaluePeriodEnd: boolean; numbering: 'shared' | 'per_branch'; vatFiling: 'separate' | 'combined' }
export const FXB_DEFAULTS: Readonly<FxbSettings> = { rateSource: 'bot_mid', revaluePeriodEnd: false, numbering: 'shared', vatFiling: 'separate' };
const ALLOWED: Record<string, readonly unknown[]> = {
  [FXB_KEYS.rateSource]: ['bot_mid', 'bot_buy', 'bot_sell'], [FXB_KEYS.revaluePeriodEnd]: [true, false],
  [FXB_KEYS.numbering]: ['shared', 'per_branch'], [FXB_KEYS.vatFiling]: ['separate', 'combined'],
};

export async function fxbSettingsTx(tx: CompanyTx): Promise<FxbSettings> {
  const rows = await tx.selectFrom('acct.company_setting').select(['key', 'value']).where('key', 'in', Object.values(FXB_KEYS)).execute();
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  const pick = <T>(k: string, d: T): T => (ALLOWED[k]!.includes(v(k)) ? (v(k) as T) : d);
  return {
    rateSource: pick(FXB_KEYS.rateSource, FXB_DEFAULTS.rateSource), revaluePeriodEnd: pick(FXB_KEYS.revaluePeriodEnd, FXB_DEFAULTS.revaluePeriodEnd),
    numbering: pick(FXB_KEYS.numbering, FXB_DEFAULTS.numbering), vatFiling: pick(FXB_KEYS.vatFiling, FXB_DEFAULTS.vatFiling),
  };
}
export async function fxbSettings(db: Db, companyId: string): Promise<FxbSettings & { pendingAuditor: true }> {
  return { ...(await db.withCompany(companyId, fxbSettingsTx)), pendingAuditor: true };
}
export async function setFxbSetting(db: Db, companyId: string, key: string, value: unknown) {
  if (!(key in ALLOWED) || !Object.values(FXB_KEYS).includes(key as never)) throw new LedgerError(`ไม่รู้จักค่าตั้ง ${key}`);
  if (!ALLOWED[key]!.includes(value)) throw new LedgerError(`ค่าของ ${key} ต้องเป็น ${ALLOWED[key]!.join(' / ')}`);
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.company_setting').values({ company_id: companyId, key, value: JSON.stringify(value), updated_at: new Date() })
    .onConflict((oc) => oc.columns(['company_id', 'key']).doUpdateSet({ value: JSON.stringify(value), updated_at: new Date() })).execute());
}

// ---------- โมดูล (public.company.modules) ----------
export type FxbModule = 'multi_currency' | 'branches';
export async function moduleOn(db: Db, companyId: string, m: FxbModule): Promise<boolean> {
  const c = await db.withPublic((tx) => tx.selectFrom('public.company').select('modules').where('id', '=', companyId).executeTakeFirst());
  const mods = (c?.modules ?? {}) as Record<string, unknown>;
  return mods[m] === true;
}
async function assertModule(db: Db, companyId: string, m: FxbModule) {
  if (!(await moduleOn(db, companyId, m))) throw new LedgerError(m === 'multi_currency' ? 'ยังไม่ได้เปิดโมดูลหลายสกุลเงิน' : 'ยังไม่ได้เปิดโมดูลสาขา');
}

/** เปิดโมดูล: หลายสกุลเงิน → สร้างบัญชี 4910100/5920100 · สาขา → สร้างสำนักงานใหญ่ 00000 (ชื่อ/ที่อยู่จากข้อมูลบริษัท) */
export async function enableModule(db: Db, companyId: string, m: FxbModule) {
  const c = await db.withPublic(async (tx) => {
    const row = await tx.selectFrom('public.company').select(['modules', 'name_th', 'address', 'tax_id', 'branch_code']).where('id', '=', companyId).executeTakeFirst();
    if (!row) throw new LedgerError('ไม่พบบริษัท');
    const mods = { ...((row.modules ?? {}) as Record<string, unknown>), [m]: true };
    await tx.updateTable('public.company').set({ modules: JSON.stringify(mods) }).where('id', '=', companyId).execute();
    return row;
  });
  await db.withCompany(companyId, async (tx) => {
    if (m === 'multi_currency') {
      for (const a of FX_ACCOUNTS) {
        await tx.insertInto('acct.account').values({ company_id: companyId, code: a.code, name: a.name, type: a.type, parent_code: null, is_control: false, control_kind: null,
          requires_contact: false, category: categoryOf(a.code, a.type), binding: null }).onConflict((oc) => oc.columns(['company_id', 'code']).doNothing()).execute();
      }
    } else {
      await tx.insertInto('acct.branch').values({ company_id: companyId, code: '00000', name: 'สำนักงานใหญ่', address: c.address, tax_id: c.tax_id })
        .onConflict((oc) => oc.columns(['company_id', 'code']).doNothing()).execute();
    }
  });
}

// ---------- สกุลเงิน / อัตรา ----------
const CODE_RE = /^[A-Z]{3}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export async function listCurrencies(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.currency').select(['code', 'name', 'decimals', 'active']).orderBy('code').execute());
}
export async function saveCurrency(db: Db, companyId: string, c: { code: string; name: string; decimals?: number; active?: boolean }) {
  if (!CODE_RE.test(c.code) || c.code === BASE_CURRENCY) throw new LedgerError('รหัสสกุลเงินต้องเป็นตัวอักษร 3 ตัว (ISO 4217) และไม่ใช่ THB');
  if (!c.name?.trim()) throw new LedgerError('ต้องระบุชื่อสกุลเงิน');
  const decimals = c.decimals ?? 2;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 2) throw new LedgerError('ทศนิยมของสกุลเงินต้องเป็น 0–2');
  await assertModule(db, companyId, 'multi_currency');
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.currency').values({ company_id: companyId, code: c.code, name: c.name.trim(), decimals, active: c.active ?? true })
    .onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: c.name.trim(), decimals, active: c.active ?? true })).execute());
}

export async function listRates(db: Db, companyId: string, f: { currency?: string; from?: string; to?: string } = {}) {
  return db.withCompany(companyId, (tx) => {
    let q = tx.selectFrom('acct.exchange_rate').select(['currency', 'rate_date', 'source', 'rate']).orderBy('rate_date', 'desc').orderBy('currency');
    if (f.currency) q = q.where('currency', '=', f.currency);
    if (f.from) q = q.where('rate_date', '>=', f.from);
    if (f.to) q = q.where('rate_date', '<=', f.to);
    return q.execute();
  });
}
/** กรอกอัตรา (บาทต่อ 1 หน่วย) · วันที่+สกุล+แหล่งซ้ำ = แก้ไข (เอกสารที่ลงแล้วเก็บอัตราของตัวเอง ไม่เปลี่ยนตาม) */
export async function saveRate(db: Db, companyId: string, actorId: string | null, r: { currency: string; date: string; rate: string; source?: RateSource }) {
  if (!CODE_RE.test(r.currency) || r.currency === BASE_CURRENCY) throw new LedgerError('สกุลเงินไม่ถูกต้อง');
  if (!DATE_RE.test(r.date)) throw new LedgerError('ระบุวันที่เป็น YYYY-MM-DD');
  if (!isRate(r.rate)) throw new LedgerError('อัตราแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 6 ตำแหน่ง');
  const source = r.source ?? 'bot_mid';
  if (!ALLOWED[FXB_KEYS.rateSource]!.includes(source)) throw new LedgerError('แหล่งอัตราต้องเป็น bot_mid / bot_buy / bot_sell');
  await db.withCompany(companyId, async (tx) => {
    const c = await tx.selectFrom('acct.currency').select('code').where('code', '=', r.currency).executeTakeFirst();
    if (!c) throw new LedgerError(`ยังไม่ได้ตั้งสกุลเงิน ${r.currency}`);
    await tx.insertInto('acct.exchange_rate').values({ company_id: companyId, currency: r.currency, rate_date: r.date, source, rate: r.rate, created_by: actorId })
      .onConflict((oc) => oc.columns(['company_id', 'currency', 'rate_date', 'source']).doUpdateSet({ rate: r.rate, created_by: actorId, created_at: new Date() })).execute();
  });
}
export async function deleteRate(db: Db, companyId: string, r: { currency: string; date: string; source?: RateSource }) {
  const n = await db.withCompany(companyId, (tx) => tx.deleteFrom('acct.exchange_rate').where('currency', '=', r.currency).where('rate_date', '=', r.date).where('source', '=', r.source ?? 'bot_mid').executeTakeFirst());
  if (!Number(n.numDeletedRows)) throw new LedgerError('ไม่พบอัตราที่จะลบ');
}

/**
 * อัตรา ณ วันที่ตามแหล่งที่ตั้งไว้ (fx.rate_source) = อัตราล่าสุดที่ไม่เกินวันนั้น (วันหยุดใช้อัตราวันทำการก่อนหน้า)
 * TODO(Wei): ใช้อัตราวันทำการก่อนหน้าเมื่อวันนั้นไม่มีอัตรา — รอผู้สอบบัญชียืนยัน
 */
export async function rateOnTx(tx: CompanyTx, currency: string, date: string): Promise<string> {
  const { rateSource } = await fxbSettingsTx(tx);
  const r = await tx.selectFrom('acct.exchange_rate').select('rate').where('currency', '=', currency).where('source', '=', rateSource).where('rate_date', '<=', date)
    .orderBy('rate_date', 'desc').executeTakeFirst();
  if (!r) throw new LedgerError(`ไม่มีอัตราแลกเปลี่ยน ${currency} (${rateSource}) ณ วันที่ ${date} — กรอกอัตราก่อน`);
  return r.rate;
}
export async function rateOn(db: Db, companyId: string, currency: string, date: string) {
  return db.withCompany(companyId, (tx) => rateOnTx(tx, currency, date));
}

// ---------- สาขา ----------
const BRANCH_RE = /^\d{5}$/u;
export async function listBranches(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.branch').select(['code', 'name', 'address', 'tax_id', 'files_separately', 'active']).orderBy('code').execute());
}
export async function saveBranch(db: Db, companyId: string, b: { code: string; name: string; address?: string | null; taxId?: string | null; filesSeparately?: boolean; active?: boolean }) {
  if (!BRANCH_RE.test(b.code)) throw new LedgerError('รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)');
  if (!b.name?.trim()) throw new LedgerError('ต้องระบุชื่อสาขา');
  if (b.taxId && !/^\d{13}$/u.test(b.taxId)) throw new LedgerError('เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  await assertModule(db, companyId, 'branches');
  const v = { name: b.name.trim(), address: b.address ?? null, tax_id: b.taxId ?? null, files_separately: b.filesSeparately ?? true, active: b.active ?? true };
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.branch').values({ company_id: companyId, code: b.code, ...v })
    .onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet(v)).execute());
}

/**
 * เลขที่เอกสาร: branch.numbering = shared (ค่าตั้งต้น) หรือสำนักงานใหญ่ → {PREFIX}{YY}{MM}-{SEQ:4} เดิม
 * per_branch → {PREFIX}{YY}{MM}-{BRANCH}-{SEQ:4} ตัวนับแยกต่อสาขา (เช่น IV2611-00001-0001)
 * TODO(Wei): รูปแบบเลขที่แยกสาขายังไม่มีในแบบร่าง (ScreenDocSettings) — รูปแบบนี้เป็นค่าชั่วคราว
 */
export async function docNumberTx(tx: CompanyTx, companyId: string, prefix: string, date: string, branchCode: string): Promise<string> {
  if (branchCode === '00000' || (await fxbSettingsTx(tx)).numbering !== 'per_branch') return nextNumber(tx, companyId, prefix, date);
  const [y, m] = date.split('-') as [string, string];
  const key = `${y.slice(2)}${m}`;
  const series = `${prefix}-${branchCode}`;
  const r = await sql<{ n: number }>`
    insert into acct.number_series (company_id, doc_type, pattern, prefix, period_key, next_no)
    values (${companyId}, ${series}, '{PREFIX}{YY}{MM}-{BRANCH}-{SEQ:4}', ${prefix}, ${key}, 2)
    on conflict (company_id, doc_type, period_key) do update set next_no = acct.number_series.next_no + 1
    returning next_no - 1 as n`.execute(tx);
  return `${prefix}${key}-${branchCode}-${String(r.rows[0]!.n).padStart(4, '0')}`;
}

// ---------- เอกสาร ----------
export interface DocFxInput { currency?: string | null; fxRate?: string | null; branchCode?: string | null }
/**
 * ค่า currency / fx_rate / branch_code ของร่างเอกสาร · ไม่ระบุอะไร = {} (ค่าเดิมของ Phase 1)
 * สกุลต่างประเทศต้องเปิดโมดูล + มีสกุลในทะเบียน · ไม่ระบุอัตรา = อัตรา ณ วันที่เอกสาร · สาขาต้องเปิดโมดูล + มีในทะเบียน
 */
export async function documentFx(db: Db, companyId: string, issueDate: string, input: DocFxInput): Promise<{ currency?: string; fx_rate?: string | null; branch_code?: string }> {
  const out: { currency?: string; fx_rate?: string | null; branch_code?: string } = {};
  if (input.currency && input.currency !== BASE_CURRENCY) {
    await assertModule(db, companyId, 'multi_currency');
    if (input.fxRate && !isRate(input.fxRate)) throw new LedgerError('อัตราแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 6 ตำแหน่ง');
    out.currency = input.currency;
    out.fx_rate = await db.withCompany(companyId, async (tx) => {
      const c = await tx.selectFrom('acct.currency').select(['code', 'active']).where('code', '=', input.currency!).executeTakeFirst();
      if (!c?.active) throw new LedgerError(`ยังไม่ได้ตั้งสกุลเงิน ${input.currency}`);
      return input.fxRate ?? (await rateOnTx(tx, input.currency!, issueDate));
    });
  } else if (input.currency === BASE_CURRENCY) {
    out.currency = BASE_CURRENCY;
    out.fx_rate = null;
  }
  if (input.branchCode && input.branchCode !== '00000') {
    await assertModule(db, companyId, 'branches');
    const b = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.branch').select(['code', 'active']).where('code', '=', input.branchCode!).executeTakeFirst());
    if (!b?.active) throw new LedgerError(`ไม่พบสาขา ${input.branchCode} ในทะเบียนสาขา`);
    out.branch_code = input.branchCode;
  } else if (input.branchCode === '00000') out.branch_code = '00000';
  return out;
}

type DocRow = { currency: string; fx_rate: string | null; issue_date: string; grand_total: string; vat: string; receive_account: string | null };
/**
 * journal ของเอกสารสกุลต่างประเทศ: แปลงบรรทัดจาก Posting Engine (สกุลเอกสาร) เป็นบาท · คืนยอดบาทที่เก็บบนเอกสาร
 * เอกสารบาท → คืนบรรทัดเดิม thb = null (ไม่แตะ)
 */
export async function convertDocumentJournal(tx: CompanyTx, d: DocRow, lines: JournalLine[]): Promise<{ lines: JournalLine[]; thb: { fx_rate: string; grand_total_thb: string; vat_thb: string; base_thb: string } | null }> {
  if (d.currency === BASE_CURRENCY) return { lines, thb: null };
  const rate = d.fx_rate ?? (await rateOnTx(tx, d.currency, d.issue_date));
  const fixed = (l: JournalLine) => FIXED_ACCOUNTS.has(l.account) || l.account === d.receive_account;
  const out = convertJournal(lines, rate, d.currency, fixed);
  const gt = toBase(d.grand_total, rate);
  const vat = toBase(d.vat, rate);
  return { lines: out, thb: { fx_rate: rate, grand_total_thb: gt.toString(), vat_thb: vat.toString(), base_thb: gt.minus(vat).toString() } };
}

/** ยอดบาทที่ตัดชำระไปแล้วของเอกสาร (ไม่นับที่ยกเลิก/รออนุมัติ) */
export async function settledBaseTx(tx: CompanyTx, documentId: string): Promise<{ settledThb: Money; vatDueThb: Money }> {
  const r = await tx.selectFrom('acct.settlement').select([sql<string>`coalesce(sum(coalesce(settled_thb, applied + wht)), 0)`.as('s'), sql<string>`coalesce(sum(coalesce(vat_due_thb, vat_due)), 0)`.as('v')])
    .where('document_id', '=', documentId).where('voided', '=', false).executeTakeFirstOrThrow();
  return { settledThb: Money.parse(r.s), vatDueThb: Money.parse(r.v) };
}

// ---------- ปรับมูลค่าสิ้นงวด ----------
export interface RevalueLine { documentId: string; docNo: string | null; side: 'AR' | 'AP'; contactId: string; currency: string; openFx: string; originalRate: string; closingRate: string; carrying: string; revalued: string; adjustment: string }

/** ลูกหนี้/เจ้าหนี้สกุลต่างประเทศที่ค้าง ณ วันที่ asOf (ยอดสกุลเดิม + ยอดบาทตามบัญชี) */
async function openForeignItems(tx: CompanyTx, asOf: string) {
  const paidUpTo = (col: string) => sql<string>`coalesce((select sum(${sql.raw(col)}) from acct.settlement s join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
    where s.document_id = d.id and s.company_id = d.company_id and not s.voided and p.issue_date <= ${asOf}), 0)`;
  const rows = await tx.selectFrom('acct.document as d')
    .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.contact_id', 'd.currency', 'd.fx_rate', 'd.grand_total', 'd.grand_total_thb', paidUpTo('s.applied + s.wht').as('settled_fx'), paidUpTo('coalesce(s.settled_thb, s.applied + s.wht)').as('settled_thb')])
    .where('d.status', '=', 'posted').where('d.currency', '<>', BASE_CURRENCY).where('d.issue_date', '<=', asOf).where('d.pay_now', '=', false)
    .where('d.doc_type', 'in', ['IV', 'DN', 'AP', 'EXP', 'DNR']).orderBy('d.issue_date').orderBy('d.doc_no').execute();
  return rows.map((r) => ({ ...r, side: (['IV', 'DN'].includes(r.doc_type) ? 'AR' : 'AP') as 'AR' | 'AP',
    openFx: Money.parse(r.grand_total).minus(Money.parse(r.settled_fx)), carrying: Money.parse(r.grand_total_thb ?? r.grand_total).minus(Money.parse(r.settled_thb)) }))
    .filter((r) => r.openFx.gt(Money.zero()));
}

/** ตัวอย่างผลการปรับมูลค่า ณ สิ้นงวด (ไม่ลงบัญชี) */
export async function revaluationPreview(db: Db, companyId: string, p: { fiscalYear: number; periodNo: number }) {
  return db.withCompany(companyId, async (tx) => {
    const per = await periodRow(tx, p);
    return { asOf: per.ends_on, lines: await revalueLines(tx, per.ends_on) };
  });
}
async function periodRow(tx: CompanyTx, p: { fiscalYear: number; periodNo: number }) {
  if (p.periodNo < 1 || p.periodNo > 12) throw new LedgerError('ปรับมูลค่าได้เฉพาะงวด 1–12');
  const per = await tx.selectFrom('acct.period').select(['starts_on', 'ends_on', 'status']).where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
  if (!per) throw new LedgerError(`ไม่พบงวด ${p.periodNo}/${p.fiscalYear}`);
  return per;
}
async function revalueLines(tx: CompanyTx, asOf: string): Promise<RevalueLine[]> {
  const out: RevalueLine[] = [];
  const rates = new Map<string, string>();
  for (const r of await openForeignItems(tx, asOf)) {
    if (!rates.has(r.currency)) rates.set(r.currency, await rateOnTx(tx, r.currency, asOf));
    const closingRate = rates.get(r.currency)!;
    const v = revaluation({ openFx: r.openFx, carryingBase: r.carrying, closingRate });
    out.push({ documentId: r.id, docNo: r.doc_no, side: r.side, contactId: r.contact_id!, currency: r.currency, openFx: r.openFx.toString(), originalRate: r.fx_rate ?? '', closingRate,
      carrying: r.carrying.toString(), revalued: v.revalued.toString(), adjustment: v.adjustment.toString() });
  }
  return out;
}

/**
 * ปรับมูลค่าลูกหนี้/เจ้าหนี้สกุลต่างประเทศสิ้นงวด (ยังไม่เกิดขึ้นจริง) — รันได้ครั้งเดียวต่องวด · กลับรายการอัตโนมัติวันแรกของงวดถัดไป
 * ลูกหนี้เพิ่ม = Dr 1130100 / Cr 4910100 · เจ้าหนี้เพิ่ม = Dr 5920100 / Cr 2110100 (กลับด้านเมื่อลดลง)
 * TODO(Wei): กำไร/ขาดทุนที่ยังไม่เกิดขึ้นจริงใช้บัญชีเดียวกับที่เกิดขึ้นจริง (4910100/5920100 ตาม Technical Plan) — แยกบัญชีหรือไม่ รอผู้สอบบัญชี
 * TODO(Wei): อัตราสิ้นงวดใช้แหล่งเดียวกับ fx.rate_source ทั้งลูกหนี้และเจ้าหนี้ (ไม่แยกอัตราซื้อ/ขาย) — รอผู้สอบบัญชี
 */
export async function runRevaluation(db: Db, companyId: string, actor: { userId: string | null; role: CompanyRole }, p: { fiscalYear: number; periodNo: number }) {
  return db.withCompany(companyId, async (tx) => {
    if (!(await fxbSettingsTx(tx)).revaluePeriodEnd) throw new LedgerError(`ปิดการปรับมูลค่าสิ้นงวดอยู่ (${FXB_KEYS.revaluePeriodEnd} = false · รอผู้สอบบัญชียืนยัน)`);
    const per = await periodRow(tx, p);
    const done = await tx.selectFrom('acct.fx_revaluation').select('fiscal_year').where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
    if (done) throw new LedgerError('ปรับมูลค่าอัตราแลกเปลี่ยนงวดนี้แล้ว');
    const rows = (await revalueLines(tx, per.ends_on)).filter((r) => !Money.parse(r.adjustment).isZero());
    const raw: JournalLine[] = [];
    for (const r of rows) {
      const adj = Money.parse(r.adjustment);
      const amount = adj.abs();
      const control = r.side === 'AR' ? AR : AP;
      // ลูกหนี้: ยอดเพิ่ม = Dr ลูกหนี้ · เจ้าหนี้: ยอดเพิ่ม = Cr เจ้าหนี้
      const controlSide = (r.side === 'AR') === adj.gt(Money.zero()) ? 'Dr' : 'Cr';
      raw.push({ side: controlSide, account: control, amount, contactId: r.contactId });
      raw.push(controlSide === 'Dr' ? { side: 'Cr', account: FX_GAIN_ACCOUNT, amount } : { side: 'Dr', account: FX_LOSS_ACCOUNT, amount });
    }
    const lines: JournalLine[] = [];
    for (const l of raw) {
      const i = lines.findIndex((o) => o.side === l.side && o.account === l.account && o.contactId === l.contactId);
      if (i >= 0) lines[i] = { ...lines[i]!, amount: lines[i]!.amount.plus(l.amount) };
      else lines.push(l);
    }
    const total = Money.sum(rows.map((r) => (r.side === 'AR' ? Money.parse(r.adjustment) : Money.parse(r.adjustment).neg())));
    let journalNo: string | null = null;
    let reversalNo: string | null = null;
    let journalId: string | null = null;
    let reversalId: string | null = null;
    if (lines.length) {
      const next = await tx.selectFrom('acct.period').select('starts_on').where('starts_on', '>', per.ends_on).where('period_no', '>=', 1).where('period_no', '<=', 12).orderBy('starts_on').executeTakeFirst();
      if (!next) throw new LedgerError('ไม่มีงวดถัดไปสำหรับกลับรายการปรับมูลค่า — เปิดงวดของปีถัดไปก่อน');
      const label = `${p.periodNo}/${p.fiscalYear}`;
      const j = await postJournalTx(tx, companyId, { date: per.ends_on, lines, role: actor.role, book: 'GJ', description: `ปรับมูลค่าอัตราแลกเปลี่ยนสิ้นงวด ${label} (ยังไม่เกิดขึ้นจริง)` });
      const rev = await postJournalTx(tx, companyId, { date: next.starts_on, lines: lines.map((l) => ({ ...l, side: l.side === 'Dr' ? 'Cr' : 'Dr' })), role: actor.role, book: 'GJ',
        journalNo: `${j.journalNo}R`, description: `กลับรายการปรับมูลค่าอัตราแลกเปลี่ยน ${label}`, reversalOf: j.id });
      [journalNo, reversalNo, journalId, reversalId] = [j.journalNo, rev.journalNo, j.id, rev.id];
    }
    await tx.insertInto('acct.fx_revaluation').values({ company_id: companyId, fiscal_year: p.fiscalYear, period_no: p.periodNo, rate_date: per.ends_on, journal_id: journalId,
      reversal_journal_id: reversalId, total: total.toString(), detail: JSON.stringify(rows), created_by: actor.userId }).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'fx.revalue', entity: 'fx_revaluation', entity_id: `${p.fiscalYear}-${p.periodNo}`,
      before: null, after: JSON.stringify({ total: total.toString(), journal: journalNo, reversal: reversalNo, items: rows.length }), prev_hash: null, hash: null }).execute();
    return { asOf: per.ends_on, total: total.toString(), journalNo, reversalNo, lines: rows };
  });
}

export async function revaluationRuns(db: Db, companyId: string, fiscalYear: number) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.fx_revaluation as r')
    .leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'r.journal_id').onRef('j.company_id', '=', 'r.company_id'))
    .leftJoin('acct.journal as v', (jn) => jn.onRef('v.id', '=', 'r.reversal_journal_id').onRef('v.company_id', '=', 'r.company_id'))
    .select(['r.fiscal_year', 'r.period_no', 'r.rate_date', 'r.total', 'r.detail', 'j.journal_no', 'v.journal_no as reversal_no', 'v.journal_date as reversal_date'])
    .where('r.fiscal_year', '=', fiscalYear).orderBy('r.period_no').execute());
}

/** ยอดปรับมูลค่าที่มีผล ณ วันที่ asOf ต่อเอกสาร (ลงสิ้นงวดแล้ว ยังไม่ถึงวันกลับรายการ) — ใช้ในอายุหนี้ให้ตรงกับ GL */
export async function revaluationInEffectTx(tx: CompanyTx, asOf: string): Promise<Map<string, Money>> {
  const runs = await tx.selectFrom('acct.fx_revaluation as r')
    .innerJoin('acct.journal as v', (jn) => jn.onRef('v.id', '=', 'r.reversal_journal_id').onRef('v.company_id', '=', 'r.company_id'))
    .select(['r.detail']).where('r.rate_date', '<=', asOf).where('v.journal_date', '>', asOf).execute();
  const out = new Map<string, Money>();
  for (const r of runs) for (const l of r.detail as RevalueLine[]) out.set(l.documentId, (out.get(l.documentId) ?? Money.zero()).plus(Money.parse(l.adjustment)));
  return out;
}
