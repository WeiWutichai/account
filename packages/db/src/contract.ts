// Phase 2A SWT — สัญญาลูกค้า · รอบบิล (IV ร่าง) · รายได้รับล่วงหน้า + รับรู้รายเดือน · ยอดใช้งาน · ตัวชี้วัด · สินทรัพย์ไม่มีตัวตน · เปิดโมดูล
// docs/technical-plan-P2A.md "SWT" · backend อย่างเดียว (ยังไม่มีแบบร่าง .dc.html ของหน้าจอเหล่านี้ — ห้ามเดาหน้าจอ)
// นโยบายรายได้ = ค่าตั้งบริษัท "รอยืนยัน" (ผู้สอบบัญชี): revenue.standard (npae) · revenue.ssp_allocation (contract_price) · revenue.vat_point_subscription (on_payment = ม.78/1 เดิม)
import { Decimal } from 'decimal.js';
import { addDays, addMonthsDate, billingPeriod, CYCLE_MONTHS, daysBetween, Money, monthlyAmount, prorate, type BillingCycle, type CompanyRole, type JournalLine, type MoneyString } from '@innovera/ledger';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, postJournalTx, voidJournalTx } from './ledger-service.ts';
import { saveAsset, type AssetInput } from './close-ops.ts';
import { categoryOf } from './seed.ts';
import { event, totalsOf, type Actor } from './sales.ts';
import { DEFERRED_REVENUE, requireModuleTx, settingTx, SOFTWARE_MODULE } from './swt-hooks.ts';

// ---------- โมดูล + ค่าตั้ง ----------

/** บัญชีของโมดูล (สร้างเมื่อเปิดโมดูล · ไม่ทับชื่อที่ผู้ใช้แก้) */
export const SWT_ACCOUNTS = [
  { code: '2170100', name: 'รายได้รับล่วงหน้า', type: 'liability', binding: 'ตารางรับรู้รายได้ (สัญญา)' },
  { code: '1170200', name: 'ภาษีซื้อรอใช้สิทธิ (ภ.พ.36)', type: 'asset', binding: 'ภ.พ.36 · โอนเป็นภาษีซื้อเมื่อยื่น' },
  { code: '2150500', name: 'ภาษี ภ.พ.36 ค้างนำส่ง', type: 'liability', binding: 'ภ.พ.36' },
  { code: '2150600', name: 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.54 ค้างนำส่ง', type: 'liability', binding: 'ภ.ง.ด.54' },
  { code: '1600100', name: 'สินทรัพย์ไม่มีตัวตน-ซอฟต์แวร์', type: 'asset', binding: null },
  { code: '1600190', name: 'ค่าตัดจำหน่ายสะสม-ซอฟต์แวร์', type: 'contra_asset', binding: null },
  { code: '5150400', name: 'ค่าตัดจำหน่าย', type: 'expense', binding: null },
] as const;

/** ค่าตั้ง "รอยืนยัน" ของโมดูล + ค่าตั้งต้นชั่วคราว (docs/technical-plan-P2A.md ตาราง config) */
export const SWT_SETTINGS = {
  'revenue.standard': 'npae',                       // TODO(Wei) รอผู้สอบบัญชี: 'npae' (TFRS for NPAEs) | 'tfrs' (TFRS 15 เต็ม)
  'revenue.ssp_allocation': 'contract_price',       // TODO(Wei) รอผู้สอบบัญชี: 'contract_price' | 'relative_ssp' (ยังไม่ทำ)
  'revenue.vat_point_subscription': 'on_payment',   // TODO(Wei) รอผู้สอบบัญชี: 'on_payment' (ม.78/1 เดิม: 2150400 → 2150100 ตอนรับเงิน) | 'on_invoice'
  'tax.pp36.enabled': true,                         // TODO(Wei) รอผู้สอบบัญชี: เงื่อนไข ภ.พ.36 แต่ละกรณี
  'tax.pnd54.treaty_rates': {},                     // TODO(Wei) รอผู้สอบบัญชี: ว่าง = อัตราตามประมวล (tax-th PND54_INCOME_TYPES)
  'tax.pnd54.gross_up': false,                      // TODO(Wei) รอผู้สอบบัญชี: ผู้จ่ายออกภาษีแทน
  'asset.intangible.capitalize_dev': false,         // TODO(Wei) รอผู้สอบบัญชี: บันทึกต้นทุนพัฒนาซอฟต์แวร์เองเป็นสินทรัพย์
} as const;
export type SwtSettingKey = keyof typeof SWT_SETTINGS;

export async function swtSettings(db: Db, companyId: string) {
  return db.withCompany(companyId, async (tx) => {
    const out: Record<string, { value: unknown; default: unknown; pendingAuditor: true }> = {};
    for (const [k, d] of Object.entries(SWT_SETTINGS)) out[k] = { value: await settingTx<unknown>(tx, k, d), default: d, pendingAuditor: true };
    out['tax.pnd54.gross_up_account'] = { value: await settingTx<unknown>(tx, 'tax.pnd54.gross_up_account', null), default: null, pendingAuditor: true };
    return out;
  });
}

/** เปิด/ปิดโมดูล software (public.company.modules.software) · เปิด = upsert บัญชีของโมดูล (ไม่ทับชื่อเดิม) · ปิดแล้วข้อมูลเดิมยังอยู่ */
export async function setSoftwareModule(db: Db, companyId: string, on: boolean, actorId: string | null = null) {
  await db.withPublic((tx) => sql`update public.company set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object(${SOFTWARE_MODULE}::text, ${on}::boolean) where id = ${companyId}`.execute(tx));
  return db.withCompany(companyId, async (tx) => {
    let created = 0;
    if (on) {
      for (const a of SWT_ACCOUNTS) {
        const r = await tx.insertInto('acct.account').values({ company_id: companyId, code: a.code, name: a.name, type: a.type, parent_code: null, is_control: false, control_kind: null,
          requires_contact: false, category: categoryOf(a.code, a.type), binding: a.binding }).onConflict((oc) => oc.columns(['company_id', 'code']).doNothing()).returning('code').executeTakeFirst();
        if (r) created += 1;
      }
    }
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: 'settings.module', entity: 'company', entity_id: companyId,
      before: null, after: JSON.stringify({ module: SOFTWARE_MODULE, on, accountsCreated: created }), prev_hash: null, hash: null }).execute();
    return { module: SOFTWARE_MODULE, on, accountsCreated: created };
  });
}

// ---------- สัญญา ----------

export type ContractLineKind = 'license' | 'subscription' | 'support' | 'implementation' | 'usage';
export type Recognition = 'point_in_time' | 'ratably' | 'milestone';
const RECURRING: readonly ContractLineKind[] = ['subscription', 'support'];
const DEFAULT_RECOGNITION: Record<ContractLineKind, Recognition> = { license: 'point_in_time', subscription: 'ratably', support: 'ratably', implementation: 'milestone', usage: 'point_in_time' };
const MONEY_RE = /^\d+(\.\d{1,2})?$/u;
const QTY_RE = /^\d+(\.\d{1,4})?$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export interface ContractLineInput {
  kind: ContractLineKind; recognition?: Recognition; description: string; productCode?: string | null;
  /** ยอดต่อรอบบิล (subscription/support) หรือยอดรวมครั้งเดียว (license/implementation) · usage ใช้ unitPrice */
  amount?: MoneyString; unitPrice?: string | null; usageUnit?: string | null; vat?: boolean; revenueAccount?: string | null; startDate?: string | null; endDate?: string | null;
}
export interface ContractInput {
  code: string; contactId: string; startDate: string; endDate: string; billingCycle: BillingCycle; autoRenew?: boolean; notes?: string | null; lines: ContractLineInput[];
}

function validateContract(c: ContractInput) {
  if (!c.code?.trim()) throw new LedgerError('ต้องระบุเลขที่สัญญา');
  if (!DATE_RE.test(c.startDate) || !DATE_RE.test(c.endDate) || c.endDate < c.startDate) throw new LedgerError('ช่วงสัญญาไม่ถูกต้อง');
  if (!(c.billingCycle in CYCLE_MONTHS)) throw new LedgerError('รอบบิลต้องเป็น monthly / quarterly / annual');
  if (!c.lines.length) throw new LedgerError('สัญญาต้องมีอย่างน้อย 1 รายการ');
  for (const l of c.lines) {
    if (!(l.kind in DEFAULT_RECOGNITION)) throw new LedgerError(`ประเภทรายการ ${l.kind} ไม่ถูกต้อง`);
    const rec = l.recognition ?? DEFAULT_RECOGNITION[l.kind];
    if (l.kind === 'usage') {
      if (!l.unitPrice || !QTY_RE.test(l.unitPrice)) throw new LedgerError(`"${l.description}": รายการตามการใช้งานต้องมีราคาต่อหน่วย`);
      if (rec !== 'point_in_time') throw new LedgerError(`"${l.description}": รายการตามการใช้งานรับรู้ ณ วันที่ออกใบแจ้งหนี้เท่านั้น`);
    } else if (!l.amount || !MONEY_RE.test(l.amount)) throw new LedgerError(`"${l.description}": ต้องระบุยอด`);
    if (rec === 'milestone' && l.kind !== 'implementation') throw new LedgerError(`"${l.description}": รับรู้ตามความสำเร็จของงานใช้กับงานติดตั้ง/implementation เท่านั้น`);
    if (rec === 'ratably' && l.kind === 'usage') throw new LedgerError(`"${l.description}": รายการตามการใช้งานรับรู้ตามช่วงเวลาไม่ได้`);
    for (const d of [l.startDate, l.endDate]) if (d && !DATE_RE.test(d)) throw new LedgerError(`"${l.description}": วันที่ไม่ถูกต้อง`);
  }
}
const lineValues = (l: ContractLineInput, i: number) => ({
  line_no: i + 1, kind: l.kind, recognition: l.recognition ?? DEFAULT_RECOGNITION[l.kind], description: l.description.trim(), product_code: l.productCode ?? null,
  amount: l.kind === 'usage' ? '0.00' : Money.parse(l.amount!).toString(), unit_price: l.kind === 'usage' ? l.unitPrice! : null, usage_unit: l.usageUnit ?? null, vat: l.vat ?? true,
  revenue_account: l.revenueAccount ?? null, start_date: l.startDate ?? null, end_date: l.endDate ?? null,
});

async function invoicedLines(tx: CompanyTx, contractId: string): Promise<Set<string>> {
  const r = await tx.selectFrom('acct.document_line as l').innerJoin('acct.document as d', (j) => j.onRef('d.id', '=', 'l.document_id').onRef('d.company_id', '=', 'l.company_id'))
    .select('l.contract_line_id').where('d.contract_id', '=', contractId).where('d.status', '<>', 'voided').where('l.contract_line_id', 'is not', null).execute();
  return new Set(r.map((x) => x.contract_line_id!));
}

/**
 * สร้าง/แก้สัญญา · สัญญาที่ออกใบแจ้งหนี้แล้ว: แก้ได้เฉพาะวันสิ้นสุด · ต่ออายุอัตโนมัติ · หมายเหตุ และเพิ่มรายการใหม่ (รายการที่ออกบิลแล้วต้องคงเดิม)
 * TODO(Wei) รอผู้สอบบัญชี: revenue.ssp_allocation = relative_ssp (ปันส่วนตามราคาขายเดี่ยว) ยังไม่ทำ — ใช้ราคาในสัญญาต่อรายการ
 */
export async function saveContract(db: Db, companyId: string, actor: Actor, input: ContractInput, id?: string): Promise<string> {
  validateContract(input);
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx);
    const ssp = await settingTx<string>(tx, 'revenue.ssp_allocation', SWT_SETTINGS['revenue.ssp_allocation']);
    if (ssp !== 'contract_price') throw new LedgerError('การปันส่วนราคาตามราคาขายเดี่ยว (relative_ssp) ยังไม่รองรับ — รอยืนยัน');
    const contact = await tx.selectFrom('acct.contact').select(['id', 'kind']).where('id', '=', input.contactId).executeTakeFirst();
    if (!contact) throw new LedgerError('ไม่พบลูกค้า');
    for (const l of input.lines) {
      if (!l.revenueAccount) continue;
      const a = await tx.selectFrom('acct.account').select('type').where('code', '=', l.revenueAccount).executeTakeFirst();
      if (a?.type !== 'revenue') throw new LedgerError(`บัญชี ${l.revenueAccount} ไม่ใช่บัญชีรายได้`);
    }
    const header = { contact_id: input.contactId, start_date: input.startDate, end_date: input.endDate, billing_cycle: input.billingCycle, auto_renew: input.autoRenew ?? false,
      notes: input.notes ?? null, updated_at: new Date() };
    if (!id) {
      const r = await tx.insertInto('acct.contract').values({ company_id: companyId, code: input.code.trim(), ...header, status: 'active', created_by: actor.userId }).returning('id').executeTakeFirstOrThrow();
      for (const [i, l] of input.lines.entries()) await tx.insertInto('acct.contract_line').values({ company_id: companyId, contract_id: r.id, ...lineValues(l, i) }).execute();
      await audit(tx, companyId, actor, 'contract.create', r.id, null, { code: input.code, lines: input.lines.length });
      return r.id;
    }
    const cur = await tx.selectFrom('acct.contract').selectAll().where('id', '=', id).executeTakeFirst();
    if (!cur) throw new LedgerError('ไม่พบสัญญา');
    if (cur.status === 'cancelled') throw new LedgerError('สัญญายกเลิกแล้ว');
    const billed = await invoicedLines(tx, id);
    const existing = await tx.selectFrom('acct.contract_line').selectAll().where('contract_id', '=', id).orderBy('line_no').execute();
    if (billed.size) {
      if (cur.contact_id !== input.contactId || cur.start_date !== input.startDate || cur.billing_cycle !== input.billingCycle) throw new LedgerError('สัญญาที่ออกใบแจ้งหนี้แล้ว แก้ลูกค้า/วันเริ่ม/รอบบิลไม่ได้');
      for (const e of existing) {
        const n = input.lines[e.line_no - 1];
        const v = n ? lineValues(n, e.line_no - 1) : null;
        if (billed.has(e.id) && (!v || v.kind !== e.kind || v.recognition !== e.recognition || !Money.parse(v.amount).equals(Money.parse(e.amount)) || (v.unit_price ?? null) !== (e.unit_price === null ? null : String(Number(e.unit_price))))) {
          throw new LedgerError(`รายการที่ ${e.line_no} ออกใบแจ้งหนี้แล้ว — แก้ประเภท/ยอด/วิธีรับรู้ไม่ได้`);
        }
      }
    }
    await tx.updateTable('acct.contract').set(header).where('id', '=', id).execute();
    for (const [i, l] of input.lines.entries()) {
      const e = existing.find((x) => x.line_no === i + 1);
      if (e && billed.has(e.id)) { await tx.updateTable('acct.contract_line').set({ description: l.description.trim(), end_date: l.endDate ?? null }).where('id', '=', e.id).execute(); continue; }
      if (e) await tx.updateTable('acct.contract_line').set(lineValues(l, i)).where('id', '=', e.id).execute();
      else await tx.insertInto('acct.contract_line').values({ company_id: companyId, contract_id: id, ...lineValues(l, i) }).execute();
    }
    for (const e of existing.filter((x) => x.line_no > input.lines.length)) {
      if (billed.has(e.id)) throw new LedgerError(`รายการที่ ${e.line_no} ออกใบแจ้งหนี้แล้ว — ลบไม่ได้`);
      const used = await tx.selectFrom('acct.usage_record').select('id').where('contract_line_id', '=', e.id).limit(1).executeTakeFirst();
      if (used) throw new LedgerError(`รายการที่ ${e.line_no} มียอดใช้งานแล้ว — ลบไม่ได้`);
      await tx.deleteFrom('acct.contract_line').where('id', '=', e.id).execute();
    }
    await audit(tx, companyId, actor, 'contract.edit', id, { end_date: cur.end_date, auto_renew: cur.auto_renew }, { end_date: input.endDate, auto_renew: input.autoRenew ?? false, lines: input.lines.length });
    return id;
  });
}

async function audit(tx: CompanyTx, companyId: string, actor: Actor, action: string, id: string, before: unknown, after: unknown) {
  await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action, entity: 'contract', entity_id: id,
    before: before === null ? null : JSON.stringify(before), after: JSON.stringify(after), prev_hash: null, hash: null }).execute();
}

/** ยกเลิกสัญญา: date = วันสุดท้ายที่ให้บริการ (ไม่ออกรอบบิลที่เริ่มหลังวันนี้ · ตัวชี้วัด churn) · ใบแจ้งหนี้ที่ออกแล้วไม่เปลี่ยน */
export async function cancelContract(db: Db, companyId: string, actor: Actor, id: string, p: { date: string; reason: string }) {
  if (!p.reason?.trim()) throw new LedgerError('ต้องระบุเหตุผลการยกเลิก');
  if (!DATE_RE.test(p.date)) throw new LedgerError('ระบุวันที่เป็น YYYY-MM-DD');
  return db.withCompany(companyId, async (tx) => {
    const c = await tx.selectFrom('acct.contract').select(['status', 'start_date']).where('id', '=', id).executeTakeFirst();
    if (!c) throw new LedgerError('ไม่พบสัญญา');
    if (c.status === 'cancelled') throw new LedgerError('สัญญายกเลิกแล้ว');
    if (p.date < c.start_date) throw new LedgerError('วันที่ยกเลิกต้องไม่ก่อนวันเริ่มสัญญา');
    await tx.updateTable('acct.contract').set({ status: 'cancelled', cancelled_on: p.date, updated_at: new Date() }).where('id', '=', id).execute();
    await audit(tx, companyId, actor, 'contract.cancel', id, { status: c.status }, { status: 'cancelled', date: p.date, reason: p.reason.trim() });
  });
}

/** งาน implementation (milestone) เสร็จ → ออกบิลในรอบบิลถัดไปและรับรู้รายได้ ณ ใบแจ้งหนี้ · TODO(Wei) รอผู้สอบบัญชี: เกณฑ์ความสำเร็จของงาน (สัดส่วน/ส่งมอบ) */
export async function completeMilestone(db: Db, companyId: string, actor: Actor, lineId: string, date: string) {
  if (!DATE_RE.test(date)) throw new LedgerError('ระบุวันที่เป็น YYYY-MM-DD');
  return db.withCompany(companyId, async (tx) => {
    const l = await tx.selectFrom('acct.contract_line').select(['recognition', 'milestone_done_on', 'contract_id']).where('id', '=', lineId).executeTakeFirst();
    if (!l) throw new LedgerError('ไม่พบรายการในสัญญา');
    if (l.recognition !== 'milestone') throw new LedgerError('รายการนี้ไม่ได้รับรู้ตามความสำเร็จของงาน');
    if (l.milestone_done_on) throw new LedgerError('บันทึกงานเสร็จแล้ว');
    await tx.updateTable('acct.contract_line').set({ milestone_done_on: date }).where('id', '=', lineId).execute();
    await audit(tx, companyId, actor, 'contract.milestone', l.contract_id, null, { line: lineId, date });
  });
}

export async function listContracts(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.contract as k').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'k.contact_id').onRef('c.company_id', '=', 'k.company_id'))
    .select(['k.id', 'k.code', 'k.start_date', 'k.end_date', 'k.billing_cycle', 'k.auto_renew', 'k.status', 'k.cancelled_on', 'c.code as contact_code', 'c.name as contact_name',
      // หน้าจอชั่วคราว P2A: ยอดต่อรอบบิล (subscription/support) · ยอดครั้งเดียว (license/implementation) · ยอดใบแจ้งหนี้ที่ออกแล้ว (ไม่นับที่ยกเลิก)
      sql<string>`coalesce((select sum(l.amount) from acct.contract_line l where l.contract_id = k.id and l.company_id = k.company_id and l.kind in ('subscription', 'support')), 0)`.as('recurring_amount'),
      sql<string>`coalesce((select sum(l.amount) from acct.contract_line l where l.contract_id = k.id and l.company_id = k.company_id and l.kind in ('license', 'implementation')), 0)`.as('one_time_amount'),
      sql<string>`coalesce((select sum(d.grand_total) from acct.document d where d.contract_id = k.id and d.company_id = k.company_id and d.status <> 'voided'), 0)`.as('billed_total')])
    .orderBy('k.code').execute());
}

export async function getContract(db: Db, companyId: string, id: string) {
  return db.withCompany(companyId, async (tx) => {
    const contract = await tx.selectFrom('acct.contract').selectAll().where('id', '=', id).executeTakeFirst();
    if (!contract) return null;
    const lines = await tx.selectFrom('acct.contract_line').selectAll().where('contract_id', '=', id).orderBy('line_no').execute();
    const invoices = await tx.selectFrom('acct.document').select(['id', 'doc_no', 'status', 'issue_date', 'contract_period_start', 'subtotal', 'vat', 'grand_total'])
      .where('contract_id', '=', id).orderBy('contract_period_start').execute();
    const schedule = await tx.selectFrom('acct.revenue_schedule as s').innerJoin('acct.contract_line as l', (j) => j.onRef('l.id', '=', 's.contract_line_id').onRef('l.company_id', '=', 's.company_id'))
      .select(['s.period', sql<string>`sum(s.amount)`.as('amount'), sql<string>`sum(case when s.journal_id is null then 0 else s.amount end)`.as('recognized')])
      .where('l.contract_id', '=', id).where('s.voided', '=', false).groupBy('s.period').orderBy('s.period').execute();
    // ตารางรับรู้แยกรายการในสัญญา (หน้าจอชั่วคราว P2A)
    const scheduleLines = await tx.selectFrom('acct.revenue_schedule as s').innerJoin('acct.contract_line as l', (j) => j.onRef('l.id', '=', 's.contract_line_id').onRef('l.company_id', '=', 's.company_id'))
      .select(['s.contract_line_id', 's.period', sql<string>`sum(s.amount)`.as('amount'), sql<string>`sum(case when s.journal_id is null then 0 else s.amount end)`.as('recognized')])
      .where('l.contract_id', '=', id).where('s.voided', '=', false).groupBy(['s.contract_line_id', 's.period']).orderBy('s.contract_line_id').orderBy('s.period').execute();
    const usage = await tx.selectFrom('acct.usage_record as u').innerJoin('acct.contract_line as l', (j) => j.onRef('l.id', '=', 'u.contract_line_id').onRef('l.company_id', '=', 'u.company_id'))
      .select(['u.id', 'u.contract_line_id', 'u.usage_date', 'u.qty', 'u.external_source', 'u.external_ref', 'u.document_id']).where('l.contract_id', '=', id).orderBy('u.usage_date').execute();
    return { contract, lines, invoices, schedule, scheduleLines, usage };
  });
}

// ---------- ยอดใช้งาน (usage) ----------

export interface UsageInput { contractCode: string; lineNo: number; usageDate: string; qty: string; externalSource?: string | null; externalRef?: string | null }
/**
 * บันทึกยอดใช้งาน (ผู้ใช้ หรือ API ภายนอก scope documents:draft — ข้อมูลร่าง ไม่ลงบัญชี · ออกบิลในรอบบิลถัดไป)
 * idempotent: external_source + external_ref ซ้ำ = คืนแถวเดิม (created: false)
 */
export async function recordUsage(db: Db, companyId: string, u: UsageInput, clientId: string | null = null): Promise<{ id: string; created: boolean }> {
  if (!DATE_RE.test(u.usageDate)) throw new LedgerError('usage_date ต้องเป็น YYYY-MM-DD');
  if (!QTY_RE.test(u.qty)) throw new LedgerError('qty ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 4 ตำแหน่ง');
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx);
    if (u.externalRef) {
      const ex = await tx.selectFrom('acct.usage_record').select('id').where('external_source', u.externalSource ? '=' : 'is', u.externalSource ?? null).where('external_ref', '=', u.externalRef).executeTakeFirst();
      if (ex) return { id: ex.id, created: false };
    }
    const line = await tx.selectFrom('acct.contract_line as l').innerJoin('acct.contract as k', (j) => j.onRef('k.id', '=', 'l.contract_id').onRef('k.company_id', '=', 'l.company_id'))
      .select(['l.id', 'l.kind', 'k.status', 'k.start_date']).where('k.code', '=', u.contractCode).where('l.line_no', '=', u.lineNo).executeTakeFirst();
    if (!line) throw new LedgerError(`ไม่พบรายการที่ ${u.lineNo} ของสัญญา ${u.contractCode}`);
    if (line.kind !== 'usage') throw new LedgerError('รายการนี้ไม่ได้คิดตามการใช้งาน');
    if (line.status === 'draft') throw new LedgerError('สัญญายังไม่เริ่มใช้');
    if (u.usageDate < line.start_date) throw new LedgerError('วันที่ใช้งานก่อนวันเริ่มสัญญา');
    const r = await tx.insertInto('acct.usage_record').values({ company_id: companyId, contract_line_id: line.id, usage_date: u.usageDate, qty: u.qty, external_source: u.externalSource ?? null,
      external_ref: u.externalRef ?? null, document_id: null, created_by_client: clientId }).returning('id').executeTakeFirstOrThrow();
    return { id: r.id, created: true };
  });
}

// ---------- รอบบิล → IV ร่าง ----------

type ContractRow = { id: string; code: string; contact_id: string; start_date: string; end_date: string; billing_cycle: BillingCycle; auto_renew: boolean; status: string; cancelled_on: string | null };
type LineRow = { id: string; line_no: number; kind: ContractLineKind; recognition: Recognition; description: string; product_code: string | null; amount: string; unit_price: string | null;
  vat: boolean; revenue_account: string | null; start_date: string | null; end_date: string | null; milestone_done_on: string | null };
const FAR = '9999-12-31';
/** วันสุดท้ายที่ให้บริการ: ยกเลิก → วันที่ยกเลิก · ต่ออายุอัตโนมัติ → ไม่มีกำหนด · ปกติ → วันสิ้นสุด */
const lastDay = (c: Pick<ContractRow, 'cancelled_on' | 'auto_renew' | 'end_date'>) => c.cancelled_on ?? (c.auto_renew ? FAR : c.end_date);
const minD = (a: string, b: string) => (a < b ? a : b);
const maxD = (a: string, b: string) => (a > b ? a : b);

interface BillLine { contractLineId: string; description: string; productCode: string | null; qty: string; unitPrice: string; vat: boolean; accountCode: string | null; serviceFrom: string | null; serviceTo: string | null; usageIds?: string[] }

/** บรรทัดที่ต้องออกบิลของรอบ [from, to] (ยังไม่ตัดตามวันสิ้นสุดสัญญา) */
async function billLines(tx: CompanyTx, c: ContractRow, lines: LineRow[], from: string, to: string, asOf: string, billed: Set<string>): Promise<BillLine[]> {
  const end = lastDay(c);
  const pTo = minD(to, end);
  const fullDays = daysBetween(from, to);
  const out: BillLine[] = [];
  for (const l of lines) {
    const ls = maxD(l.start_date ?? c.start_date, c.start_date);
    const le = minD(l.end_date ?? end, end);
    if (RECURRING.includes(l.kind)) {
      const sf = maxD(from, ls);
      const st = minD(pTo, le);
      if (sf > st) continue;
      const amount = prorate(l.amount, daysBetween(sf, st), fullDays);
      out.push({ contractLineId: l.id, description: `${l.description} (${sf} – ${st})`, productCode: l.product_code, qty: '1', unitPrice: amount, vat: l.vat, accountCode: l.revenue_account, serviceFrom: sf, serviceTo: st });
    } else if (l.kind === 'usage') {
      // ยอดใช้งานคิดย้อนหลัง: รายการที่ยังไม่ออกบิล ก่อนวันเริ่มรอบนี้ (รอบสุดท้ายหลังสิ้นสัญญา = เก็บตก)
      const recs = await tx.selectFrom('acct.usage_record').select(['id', 'qty']).where('contract_line_id', '=', l.id).where('document_id', 'is', null).where('usage_date', '<', from).execute();
      if (!recs.length) continue;
      const totalQty = recs.map((r) => r.qty).reduce((a, b) => addQty(a, b), '0');
      out.push({ contractLineId: l.id, description: `${l.description} (ใช้งานถึง ${addDays(from, -1)})`, productCode: l.product_code, qty: totalQty, unitPrice: l.unit_price!, vat: l.vat,
        accountCode: l.revenue_account, serviceFrom: null, serviceTo: null, usageIds: recs.map((r) => r.id) });
    } else if (!billed.has(l.id)) {
      // ครั้งเดียว: license / implementation · milestone ออกบิลเมื่อบันทึกงานเสร็จ
      if (l.recognition === 'milestone' && !(l.milestone_done_on && l.milestone_done_on <= asOf)) continue;
      if (ls > pTo) continue;
      const ratable = l.recognition === 'ratably';
      out.push({ contractLineId: l.id, description: l.description, productCode: l.product_code, qty: '1', unitPrice: l.amount, vat: l.vat, accountCode: l.revenue_account,
        serviceFrom: ratable ? ls : null, serviceTo: ratable ? minD(le, c.end_date) : null });
    }
  }
  return out;
}
/** บวกปริมาณ (NUMERIC 18,4) แบบไม่ใช้ float */
function addQty(a: string, b: string): string {
  const scale = (s: string) => { const [i, f = ''] = s.split('.'); return BigInt(i!) * 10_000n + BigInt((f + '0000').slice(0, 4)); };
  const v = scale(a) + scale(b);
  return `${v / 10_000n}.${String(v % 10_000n).padStart(4, '0')}`;
}

/**
 * รอบบิล: ทุกสัญญาที่ใช้งาน · ทุกรอบที่เริ่มไม่เกิน asOf และยังไม่มีใบแจ้งหนี้ (ไม่นับใบที่ยกเลิก) → IV **ร่าง** 1 ใบต่อสัญญาต่อรอบ (ไม่ลงบัญชีเอง — ผู้ใช้อนุมัติ)
 * วันที่ใบแจ้งหนี้ = วันเริ่มรอบ (เก็บล่วงหน้า) · รอบที่ถูกตัดด้วยวันสิ้นสุด/ยกเลิก = คิดตามสัดส่วนวัน · ยอดใช้งานคิดย้อนหลัง
 * จุดภาษี: revenue.vat_point_subscription = on_payment (ค่าตั้งต้น · สูตร Service[IV] → 2150400) | on_invoice (Credit[IV] → 2150100)
 */
export async function runBilling(db: Db, companyId: string, actor: Actor, p: { asOf: string; contractId?: string }) {
  if (!DATE_RE.test(p.asOf)) throw new LedgerError('ระบุวันที่เป็น YYYY-MM-DD');
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx);
    const vatPoint = await settingTx<string>(tx, 'revenue.vat_point_subscription', SWT_SETTINGS['revenue.vat_point_subscription']);
    let q = tx.selectFrom('acct.contract').select(['id', 'code', 'contact_id', 'start_date', 'end_date', 'billing_cycle', 'auto_renew', 'status', 'cancelled_on'])
      .where('status', 'in', ['active', 'cancelled']).where('start_date', '<=', p.asOf).orderBy('code');
    if (p.contractId) q = q.where('id', '=', p.contractId);
    const created: { id: string; contract: string; periodStart: string; periodEnd: string; subtotal: string; vat: string; grandTotal: string }[] = [];
    for (const c of (await q.execute()) as ContractRow[]) {
      const lines = (await tx.selectFrom('acct.contract_line').selectAll().where('contract_id', '=', c.id).orderBy('line_no').execute()) as LineRow[];
      const existing = new Set((await tx.selectFrom('acct.document').select('contract_period_start').where('contract_id', '=', c.id).where('status', '<>', 'voided').execute()).map((d) => d.contract_period_start!));
      const billed = await invoicedLines(tx, c.id);
      const end = lastDay(c);
      for (let k = 0; ; k++) {
        const per = billingPeriod(c.start_date, c.billing_cycle, k);
        if (per.from > p.asOf) break;
        const after = per.from > end; // หลังสิ้นสัญญา: เก็บตกยอดใช้งานเท่านั้น แล้วหยุด
        if (existing.has(per.from)) { if (after) break; continue; }
        let bl = await billLines(tx, c, lines, per.from, per.to, p.asOf, billed);
        if (after) bl = bl.filter((x) => x.usageIds);
        if (bl.length) {
          const doc = await createContractInvoiceTx(tx, companyId, actor, c, per.from, per.from, bl, vatPoint === 'on_invoice');
          for (const x of bl) if (!RECURRING.includes(lines.find((l) => l.id === x.contractLineId)!.kind)) billed.add(x.contractLineId);
          created.push({ id: doc.id, contract: c.code, periodStart: per.from, periodEnd: minD(per.to, end), subtotal: doc.subtotal, vat: doc.vat, grandTotal: doc.grandTotal });
        }
        if (after) break;
      }
      // รายการครั้งเดียวที่พร้อมออกบิลหลังใบของรอบไปแล้ว (งาน milestone เสร็จ · license ที่เริ่มทีหลัง) → ใบแจ้งหนี้เพิ่มเติม ลงวันที่ asOf (ไม่ผูกรอบ)
      const adhoc = lines.filter((l) => !RECURRING.includes(l.kind) && l.kind !== 'usage' && !billed.has(l.id)
        && (l.recognition === 'milestone' ? Boolean(l.milestone_done_on && l.milestone_done_on <= p.asOf) : maxD(l.start_date ?? c.start_date, c.start_date) <= minD(p.asOf, end)));
      if (adhoc.length) {
        const bl = adhoc.map((l): BillLine => {
          const ratable = l.recognition === 'ratably';
          return { contractLineId: l.id, description: l.description, productCode: l.product_code, qty: '1', unitPrice: l.amount, vat: l.vat, accountCode: l.revenue_account,
            serviceFrom: ratable ? maxD(l.start_date ?? c.start_date, c.start_date) : null, serviceTo: ratable ? minD(l.end_date ?? c.end_date, c.end_date) : null };
        });
        const doc = await createContractInvoiceTx(tx, companyId, actor, c, null, p.asOf, bl, vatPoint === 'on_invoice');
        for (const x of bl) billed.add(x.contractLineId);
        created.push({ id: doc.id, contract: c.code, periodStart: p.asOf, periodEnd: p.asOf, subtotal: doc.subtotal, vat: doc.vat, grandTotal: doc.grandTotal });
      }
    }
    return { asOf: p.asOf, created };
  });
}

async function createContractInvoiceTx(tx: CompanyTx, companyId: string, actor: Actor, c: ContractRow, periodStart: string | null, issueDate: string, bl: BillLine[], onInvoice: boolean) {
  const t = totalsOf({ lines: bl.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, vat: l.vat })), priceInclVat: false, billDiscount: '0.00' });
  const contact = await tx.selectFrom('acct.contact').select(['credit_days', 'address']).where('id', '=', c.contact_id).executeTakeFirst();
  const due = contact?.credit_days ? addDays(issueDate, contact.credit_days) : null;
  const d = await tx.insertInto('acct.document').values({
    company_id: companyId, doc_type: 'IV', doc_no: null, issue_date: issueDate, due_date: due, contact_id: c.contact_id, price_incl_vat: false,
    subtotal: t.subtotal, discount: t.discount, vat: t.vat, wht: '0.00', grand_total: t.receivable, bill_discount: '0.00',
    tax_mode: onInvoice ? 'immediate' : 'on_payment', rule_code: onInvoice ? 'Credit[IV]' : 'Service[IV]', address: contact?.address ?? null, notes: null, reference: c.code, ref_document_id: null,
    credit_days: contact?.credit_days ?? null, receive_account: null, created_by: actor.userId, external_source: null, external_ref: null, branch_code: '00000', fee: '0.00',
    contract_id: c.id, contract_period_start: periodStart, updated_at: new Date(),
  } as never).returning('id').executeTakeFirstOrThrow() as { id: string };
  for (const [i, l] of bl.entries()) {
    await tx.insertInto('acct.document_line').values({ company_id: companyId, document_id: d.id, line_no: i + 1, line_type: 'item', product_code: l.productCode, description: l.description,
      qty: l.qty, unit_price: l.unitPrice, discount: '0.00', amount: t.lines[i]!.amount, vat_rate: l.vat ? '0.0700' : null, account_code: l.accountCode, wht_type: null,
      contract_line_id: l.contractLineId, service_from: l.serviceFrom, service_to: l.serviceTo }).execute();
    if (l.usageIds?.length) await tx.updateTable('acct.usage_record').set({ document_id: d.id }).where('id', 'in', l.usageIds).execute();
  }
  await event(tx, companyId, d.id, actor.userId, 'created', { contract: c.code, period: periodStart, issueDate });
  return { id: d.id, subtotal: t.subtotal, vat: t.vat, grandTotal: t.receivable };
}

// ---------- รับรู้รายได้รายงวด ----------

async function periodOf(tx: CompanyTx, fiscalYear: number, periodNo: number) {
  const per = await tx.selectFrom('acct.period').select(['starts_on', 'ends_on']).where('fiscal_year', '=', fiscalYear).where('period_no', '=', periodNo).executeTakeFirst();
  if (!per || periodNo < 1 || periodNo > 12) throw new LedgerError(`ไม่พบงวด ${periodNo}/${fiscalYear}`);
  return { ym: per.starts_on.slice(0, 7), endsOn: per.ends_on };
}

/**
 * รับรู้รายได้รับล่วงหน้าของงวด (เหมือนค่าเสื่อม · ครั้งเดียวต่องวด): ตารางที่ยังไม่รับรู้ของงวดนี้และงวดก่อน (IV ลงย้อนหลัง) → JV Dr 2170100 / Cr รายได้
 */
export async function runRevenueRecognition(db: Db, companyId: string, actor: { userId: string | null; role: CompanyRole }, p: { fiscalYear: number; periodNo: number }) {
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx);
    const { ym, endsOn } = await periodOf(tx, p.fiscalYear, p.periodNo);
    const done = await tx.selectFrom('acct.revenue_recognition_run').select('id').where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).where('voided_at', 'is', null).executeTakeFirst();
    if (done) throw new LedgerError('รับรู้รายได้งวดนี้แล้ว');
    const rows = await tx.selectFrom('acct.revenue_schedule as s').innerJoin('acct.document as d', (j) => j.onRef('d.id', '=', 's.document_id').onRef('d.company_id', '=', 's.company_id'))
      .select(['s.id', 's.amount', 's.revenue_account']).where('s.voided', '=', false).where('s.journal_id', 'is', null).where('s.period', '<=', ym).where('d.status', '=', 'posted').execute();
    const total = Money.sum(rows.map((r) => Money.parse(r.amount)));
    if (total.isZero()) return { total: '0.00', journalNo: null, rows: 0 };
    const byAcc = new Map<string, Money>();
    for (const r of rows) byAcc.set(r.revenue_account, (byAcc.get(r.revenue_account) ?? Money.zero()).plus(Money.parse(r.amount)));
    const lines: JournalLine[] = [{ side: 'Dr', account: DEFERRED_REVENUE, amount: total }, ...[...byAcc].map(([account, amount]) => ({ side: 'Cr' as const, account, amount }))];
    const j = await postJournalTx(tx, companyId, { date: endsOn, lines, role: actor.role, book: 'GJ', description: `รับรู้รายได้รับล่วงหน้า ${p.periodNo}/${p.fiscalYear}` });
    await tx.updateTable('acct.revenue_schedule').set({ journal_id: j.id }).where('id', 'in', rows.map((r) => r.id)).execute();
    await tx.insertInto('acct.revenue_recognition_run').values({ company_id: companyId, fiscal_year: p.fiscalYear, period_no: p.periodNo, journal_id: j.id, total: total.toString(), voided_at: null, void_reason: null }).execute();
    return { total: total.toString(), journalNo: j.journalNo, rows: rows.length };
  });
}

/** ยกเลิกการรับรู้ของงวด (reversal · เลขเดิมคงอยู่) → ตารางกลับเป็นยังไม่รับรู้ · รันใหม่ได้ */
export async function voidRevenueRecognition(db: Db, companyId: string, actor: { userId: string | null; role: CompanyRole }, p: { fiscalYear: number; periodNo: number; reason: string; date?: string }) {
  if (!p.reason?.trim()) throw new LedgerError('ต้องระบุเหตุผลการยกเลิก');
  return db.withCompany(companyId, async (tx) => {
    const run = await tx.selectFrom('acct.revenue_recognition_run as r').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'r.journal_id').onRef('j.company_id', '=', 'r.company_id'))
      .select(['r.id', 'r.journal_id', 'j.journal_date']).where('r.fiscal_year', '=', p.fiscalYear).where('r.period_no', '=', p.periodNo).where('r.voided_at', 'is', null).executeTakeFirst();
    if (!run) throw new LedgerError('งวดนี้ยังไม่ได้รับรู้รายได้');
    const later = await tx.selectFrom('acct.revenue_recognition_run').select('period_no').where('voided_at', 'is', null)
      .where((eb) => eb.or([eb('fiscal_year', '>', p.fiscalYear), eb.and([eb('fiscal_year', '=', p.fiscalYear), eb('period_no', '>', p.periodNo)])])).executeTakeFirst();
    if (later) throw new LedgerError('มีการรับรู้รายได้ของงวดหลังแล้ว — ยกเลิกงวดหลังก่อน');
    const r = await voidJournalTx(tx, companyId, run.journal_id, { date: p.date ?? run.journal_date, role: actor.role, reason: p.reason, ...(actor.userId ? { actorId: actor.userId } : {}) });
    await tx.updateTable('acct.revenue_schedule').set({ journal_id: null }).where('journal_id', '=', run.journal_id).execute();
    await tx.updateTable('acct.revenue_recognition_run').set({ voided_at: new Date(), void_reason: p.reason.trim() }).where('id', '=', run.id).execute();
    return { reversal: r.journalNo };
  });
}

export async function recognitionRuns(db: Db, companyId: string, fiscalYear: number) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.revenue_recognition_run as r').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'r.journal_id').onRef('j.company_id', '=', 'r.company_id'))
    .select(['r.period_no', 'r.total', 'r.voided_at', 'j.journal_no', 'j.journal_date']).where('r.fiscal_year', '=', fiscalYear).orderBy('r.period_no').orderBy('r.created_at').execute());
}

// ---------- ตัวชี้วัด ----------

const isActive = (c: ContractRow, date: string) => c.status !== 'draft' && c.start_date <= date && date <= lastDay(c);
const lineActive = (c: ContractRow, l: LineRow, date: string) => maxD(l.start_date ?? c.start_date, c.start_date) <= date && date <= minD(l.end_date ?? lastDay(c), lastDay(c));

/**
 * ตัวชี้วัด ณ วันที่ asOf: MRR (รายการ subscription/support ÷ เดือนต่อรอบ) · ARR = MRR × 12
 * backlog = รายได้รับล่วงหน้าที่ยังไม่รับรู้ (ออกบิลแล้ว) + มูลค่าตามสัญญาที่ยังไม่ออกบิลถึงวันสิ้นสุดสัญญา (ต่ออายุอัตโนมัติ = ถึงวันสิ้นสุดรอบสัญญาปัจจุบัน)
 * churn เดือน month: ลูกค้าที่มีสัญญาใช้งาน ณ วันแรกของเดือน แต่ไม่มีเลย ณ วันแรกของเดือนถัดไป (จำนวน และ MRR ที่หายไป)
 */
export async function contractMetrics(db: Db, companyId: string, p: { asOf: string; month?: string }) {
  if (!DATE_RE.test(p.asOf)) throw new LedgerError('ระบุวันที่เป็น YYYY-MM-DD');
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx);
    const contracts = (await tx.selectFrom('acct.contract').select(['id', 'code', 'contact_id', 'start_date', 'end_date', 'billing_cycle', 'auto_renew', 'status', 'cancelled_on']).execute()) as ContractRow[];
    const lines = (await tx.selectFrom('acct.contract_line').selectAll().execute()) as (LineRow & { contract_id: string })[];
    const linesOf = (c: ContractRow) => lines.filter((l) => l.contract_id === c.id);
    const mrrOf = (c: ContractRow, date: string) => (isActive(c, date)
      ? Money.sum(linesOf(c).filter((l) => RECURRING.includes(l.kind) && lineActive(c, l, date)).map((l) => Money.of(monthlyAmount(Money.parse(l.amount).toString(), c.billing_cycle)))) : Money.zero());
    const mrr = Money.sum(contracts.map((c) => mrrOf(c, p.asOf)));
    // backlog: ออกบิลแล้วยังไม่รับรู้
    const deferred = await tx.selectFrom('acct.revenue_schedule as s').innerJoin('acct.document as d', (j) => j.onRef('d.id', '=', 's.document_id').onRef('d.company_id', '=', 's.company_id'))
      .leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 's.journal_id').onRef('j.company_id', '=', 's.company_id'))
      .select(sql<string>`coalesce(sum(s.amount), 0)`.as('a')).where('s.voided', '=', false).where('d.status', '=', 'posted').where('d.issue_date', '<=', p.asOf)
      .where((eb) => eb.or([eb('s.journal_id', 'is', null), eb('j.journal_date', '>', p.asOf)])).executeTakeFirstOrThrow();
    // backlog: ยังไม่ออกบิล
    let unbilled = Money.zero();
    for (const c of contracts.filter((x) => x.status === 'active' || x.status === 'cancelled')) {
      const end = c.cancelled_on ?? (c.auto_renew ? termEnd(c, p.asOf) : c.end_date);
      if (end < p.asOf && c.status === 'cancelled') continue;
      const existing = new Set((await tx.selectFrom('acct.document').select('contract_period_start').where('contract_id', '=', c.id).where('status', '<>', 'voided').execute()).map((d) => d.contract_period_start!));
      const billed = await invoicedLines(tx, c.id);
      for (const l of linesOf(c)) {
        if (l.kind === 'usage') continue;
        if (!RECURRING.includes(l.kind)) { if (!billed.has(l.id)) unbilled = unbilled.plus(Money.parse(l.amount)); continue; }
        for (let k = 0; ; k++) {
          const per = billingPeriod(c.start_date, c.billing_cycle, k);
          if (per.from > end) break;
          if (existing.has(per.from)) continue;
          const sf = maxD(per.from, maxD(l.start_date ?? c.start_date, c.start_date));
          const st = minD(minD(per.to, end), l.end_date ?? end);
          if (sf <= st) unbilled = unbilled.plus(Money.of(prorate(Money.parse(l.amount).toString(), daysBetween(sf, st), daysBetween(per.from, per.to))));
        }
      }
    }
    const def = Money.parse(deferred.a);
    const standard = await settingTx<string>(tx, 'revenue.standard', SWT_SETTINGS['revenue.standard']);
    let churn: { month: string; customersStart: number; churnedCustomers: number; customerChurnRate: string; mrrStart: string; churnedMrr: string; mrrChurnRate: string } | null = null;
    if (p.month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(p.month)) throw new LedgerError('ระบุเดือนเป็น YYYY-MM');
      const start = `${p.month}-01`;
      const next = billingPeriod(start, 'monthly', 1).from;
      const customers = (date: string) => new Set(contracts.filter((c) => isActive(c, date)).map((c) => c.contact_id));
      const before = customers(start);
      const afterSet = customers(next);
      const churned = [...before].filter((x) => !afterSet.has(x));
      const mrrStart = Money.sum(contracts.map((c) => mrrOf(c, start)));
      const churnedMrr = Money.sum(contracts.filter((c) => churned.includes(c.contact_id)).map((c) => mrrOf(c, start)));
      const rate = (n: string, d: string) => (new Decimal(d).isZero() ? '0.0000' : new Decimal(n).div(d).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
      churn = { month: p.month, customersStart: before.size, churnedCustomers: churned.length, customerChurnRate: rate(String(churned.length), String(before.size)),
        mrrStart: mrrStart.toString(), churnedMrr: churnedMrr.toString(), mrrChurnRate: rate(churnedMrr.toString(), mrrStart.toString()) };
    }
    return { asOf: p.asOf, standard, mrr: mrr.toString(), arr: mrr.times('12').round().toString(), deferredRevenue: def.toString(), unbilled: unbilled.toString(),
      backlog: def.plus(unbilled).toString(), activeContracts: contracts.filter((c) => isActive(c, p.asOf)).length, churn };
  });
}
/** วันสิ้นสุดรอบสัญญาปัจจุบันของสัญญาต่ออายุอัตโนมัติ (ต่อครั้งละเท่าอายุสัญญาเดิม) */
function termEnd(c: ContractRow, asOf: string): string {
  const after = addDays(c.end_date, 1);
  const ym = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  const termMonths = Math.max(1, ym(after) - ym(c.start_date));
  let end = c.end_date;
  for (let i = 1; end < asOf && i < 1000; i++) end = addDays(addMonthsDate(c.start_date, termMonths * (i + 1)), -1);
  return end;
}

// ---------- สินทรัพย์ไม่มีตัวตน ----------

export interface IntangibleInput extends Omit<AssetInput, 'assetAccount' | 'accumAccount' | 'expenseAccount' | 'salvage'> {
  origin: 'purchased' | 'internal_dev'; assetAccount?: string; accumAccount?: string; expenseAccount?: string; salvage?: MoneyString;
}
/**
 * สินทรัพย์ไม่มีตัวตน (ซอฟต์แวร์) — ตัดจำหน่ายเส้นตรงด้วย runDepreciation เดิม (Dr 5150400 / Cr 1600190) · ซากตั้งต้น 0.00
 * พัฒนาเอง (internal_dev) บันทึกเป็นสินทรัพย์ได้เมื่อ asset.intangible.capitalize_dev = true เท่านั้น (ค่าตั้งต้น false · รอผู้สอบบัญชี: เกณฑ์ capitalize)
 */
export async function saveIntangibleAsset(db: Db, companyId: string, a: IntangibleInput) {
  if (!['purchased', 'internal_dev'].includes(a.origin)) throw new LedgerError('ที่มาของสินทรัพย์ไม่มีตัวตนไม่ถูกต้อง');
  await db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx);
    if (a.origin === 'internal_dev' && (await settingTx<unknown>(tx, 'asset.intangible.capitalize_dev', SWT_SETTINGS['asset.intangible.capitalize_dev'])) !== true) {
      throw new LedgerError('ยังไม่ได้เปิดให้บันทึกต้นทุนพัฒนาซอฟต์แวร์เป็นสินทรัพย์ (asset.intangible.capitalize_dev) — รอผู้สอบบัญชียืนยัน');
    }
  });
  await saveAsset(db, companyId, { ...a, assetAccount: a.assetAccount ?? '1600100', accumAccount: a.accumAccount ?? '1600190', expenseAccount: a.expenseAccount ?? '5150400',
    salvage: a.salvage ?? '0.00', kind: 'intangible', intangibleOrigin: a.origin });
}
