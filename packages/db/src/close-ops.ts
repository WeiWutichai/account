// M6 ปิดงวด · ทะเบียนทรัพย์สิน + ค่าเสื่อม · กระทบยอดธนาคาร (docs/technical-plan-M6.md)
import { depreciationSchedule, Money, yearEndClose, type CompanyRole, type JournalLine, type MoneyString } from '@innovera/ledger';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, postJournalTx, trialBalance } from './ledger-service.ts';
import { emitTx } from './hub.ts';
import { filingStatus } from './reports.ts';

export interface OpsActor { userId: string | null; role: CompanyRole }
const MANAGERS: readonly CompanyRole[] = ['owner', 'accounting_manager'];

// ---------- ปิดงวด (ScreenPeriodClose) ----------
// open → soft_closed (manager+ แก้ได้) → hard_closed (ห้ามแก้) · เปิดงวดคืนต้องมีเหตุผล + audit (CLAUDE.md)

export async function periodStatus(db: Db, companyId: string, fiscalYear: number) {
  const vatRegistered = (await db.withPublic((tx) => tx.selectFrom('public.company').select('vat_registered').where('id', '=', companyId).executeTakeFirst()))?.vat_registered ?? true;
  const rows = await db.withCompany(companyId, async (tx) => {
    const periods = await tx.selectFrom('acct.period').selectAll().where('fiscal_year', '=', fiscalYear).orderBy('period_no').execute();
    const drafts = await tx.selectFrom('acct.journal').select(['period_no', sql<string>`count(*)`.as('n')]).where('fiscal_year', '=', fiscalYear).where('status', '=', 'draft').groupBy('period_no').execute();
    const posted = await tx.selectFrom('acct.journal').select(['period_no', sql<string>`count(*)`.as('n')]).where('fiscal_year', '=', fiscalYear).where('status', '<>', 'draft').groupBy('period_no').execute();
    const pending = await tx.selectFrom('acct.document').select([sql<number>`extract(month from issue_date)::int`.as('m'), sql<string>`count(*)`.as('n')])
      .where('status', 'in', ['draft', 'pending_approval']).groupBy(sql`extract(month from issue_date)`).execute();
    const runs = await depreciationRunsTx(tx, fiscalYear);
    const monthOf = (p: { period_no: number; starts_on: string }) => (p.period_no >= 1 && p.period_no <= 12 ? p.starts_on.slice(0, 7) : null);
    const filings = await filingStatus(tx, periods.map(monthOf).filter((m): m is string => m !== null), vatRegistered);
    return periods.map((p) => {
      const m = monthOf(p);
      return { ...p, draftJournals: Number(drafts.find((d) => d.period_no === p.period_no)?.n ?? 0),
        pendingDocuments: p.period_no >= 1 && p.period_no <= 12 ? Number(pending.find((d) => d.m === p.period_no)?.n ?? 0) : 0,
        /** จำนวนรายการบัญชีที่ผ่านแล้วในงวด (ScreenPeriodClose "Dr = Cr ทุกรายการ n รายการ") */
        journals: Number(posted.find((d) => d.period_no === p.period_no)?.n ?? 0),
        depreciation: runs.find((r) => r.period_no === p.period_no) ?? null,
        tax: m ? filings.get(m) ?? null : null };
    });
  });
  // ชื่อผู้ปิดงวด/ผู้ทบทวน (public.app_user)
  const ids = [...new Set(rows.flatMap((r) => [r.closed_by, r.accrual_reviewed_by]).filter((x): x is string => !!x))];
  const users = ids.length ? await db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'display_name', 'email']).where('id', 'in', ids).execute()) : [];
  const nameOf = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? (u.display_name || u.email) : null; };
  return rows.map((r) => ({ ...r, closedByName: nameOf(r.closed_by), accrualReviewedByName: nameOf(r.accrual_reviewed_by) }));
}

/** ScreenPeriodClose "ยืนยันทบทวนแล้ว": รายการปรับปรุงค้างรับ–ค้างจ่าย (accrual) ของงวดทบทวนแล้ว */
export async function reviewAccruals(db: Db, companyId: string, actor: OpsActor, p: { fiscalYear: number; periodNo: number }) {
  if (!MANAGERS.includes(actor.role)) throw new LedgerError('ยืนยันทบทวนได้เฉพาะเจ้าของ/ผู้จัดการบัญชี');
  await db.withCompany(companyId, async (tx) => {
    const cur = await tx.selectFrom('acct.period').select(['status', 'accrual_reviewed_at']).where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
    if (!cur) throw new LedgerError('ไม่พบงวด');
    if (cur.status === 'hard_closed') throw new LedgerError('งวดปิดแข็งแล้ว');
    await tx.updateTable('acct.period').set({ accrual_reviewed_at: new Date(), accrual_reviewed_by: actor.userId }).where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'period.accrual_reviewed', entity: 'period', entity_id: `${p.fiscalYear}-${p.periodNo}`,
      before: JSON.stringify({ reviewed: cur.accrual_reviewed_at !== null }), after: JSON.stringify({ reviewed: true }), prev_hash: null, hash: null }).execute();
  });
}

export async function closePeriod(db: Db, companyId: string, actor: OpsActor, p: { fiscalYear: number; periodNo: number; to: 'soft_closed' | 'hard_closed' }) {
  if (!MANAGERS.includes(actor.role)) throw new LedgerError('ปิดงวดได้เฉพาะเจ้าของ/ผู้จัดการบัญชี');
  if (p.to === 'hard_closed' && actor.role !== 'owner' && actor.role !== 'accounting_manager') throw new LedgerError('ปิดแข็งได้เฉพาะเจ้าของ/ผู้จัดการบัญชี');
  return db.withCompany(companyId, async (tx) => {
    const cur = await tx.selectFrom('acct.period').selectAll().where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
    if (!cur) throw new LedgerError('ไม่พบงวด');
    const order = { open: 0, soft_closed: 1, hard_closed: 2 } as const;
    if (order[p.to] <= order[cur.status]) throw new LedgerError(`งวดนี้สถานะ ${cur.status} อยู่แล้ว`);
    // ปิดงวดต้องปิดงวดก่อนหน้าก่อน (ปิดเรียงลำดับ)
    const before = await tx.selectFrom('acct.period').select(['period_no', 'status']).where('fiscal_year', '=', p.fiscalYear).where('period_no', '<', p.periodNo).where('period_no', '>=', 1).execute();
    if (before.some((b) => order[b.status] < order[p.to])) throw new LedgerError('ต้องปิดงวดก่อนหน้าก่อน');
    const drafts = await tx.selectFrom('acct.journal').select('id').where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).where('status', '=', 'draft').execute();
    if (p.to === 'hard_closed' && drafts.length) throw new LedgerError(`มีรายการร่าง ${drafts.length} รายการในงวดนี้ — ลงบัญชีหรือลบก่อนปิดแข็ง`);
    await tx.updateTable('acct.period').set({ status: p.to, closed_at: new Date(), closed_by: actor.userId }).where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'period.close', entity: 'period', entity_id: `${p.fiscalYear}-${p.periodNo}`,
      before: JSON.stringify({ status: cur.status }), after: JSON.stringify({ status: p.to }), prev_hash: null, hash: null }).execute();
    await emitTx(tx, companyId, 'period.closed', { fiscal_year: p.fiscalYear, period_no: p.periodNo, status: p.to });
  });
}

export async function reopenPeriod(db: Db, companyId: string, actor: OpsActor, p: { fiscalYear: number; periodNo: number; reason: string }) {
  if (actor.role !== 'owner') throw new LedgerError('เปิดงวดคืนได้เฉพาะเจ้าของ');
  if (!p.reason.trim()) throw new LedgerError('ต้องระบุเหตุผลการเปิดงวดคืน');
  await db.withCompany(companyId, async (tx) => {
    const cur = await tx.selectFrom('acct.period').select('status').where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirstOrThrow();
    if (cur.status === 'open') throw new LedgerError('งวดเปิดอยู่แล้ว');
    if (p.periodNo === 0) throw new LedgerError('งวดยอดยกมาเปิดคืนไม่ได้ — ใช้ "แก้ยอดยกมา"');
    await tx.updateTable('acct.period').set({ status: 'open', closed_at: null, closed_by: null }).where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'period.reopen', entity: 'period', entity_id: `${p.fiscalYear}-${p.periodNo}`,
      before: JSON.stringify({ status: cur.status }), after: JSON.stringify({ status: 'open', reason: p.reason }), prev_hash: null, hash: null }).execute();
  });
}

/** ปิดปี: ลงในงวด 13 — ปิดรายได้/ค่าใช้จ่ายเข้า 3900100 แล้วโอนกำไรสะสม (สำรองตามกฎหมายไม่ลงตอนปิดปี · PLAN) */
export async function yearEnd(db: Db, companyId: string, actor: OpsActor, fiscalYear: number) {
  if (!MANAGERS.includes(actor.role)) throw new LedgerError('ปิดปีได้เฉพาะเจ้าของ/ผู้จัดการบัญชี');
  const tb = await trialBalance(db, companyId, { fiscalYear, upToPeriod: 13 });
  const types = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.account').select(['code', 'type']).execute());
  const r = yearEndClose(tb.map((t) => ({ account: t.account, balance: t.balance as MoneyString, type: types.find((x) => x.code === t.account)?.type ?? '' })));
  const y = fiscalYear - 543;
  return db.withCompany(companyId, async (tx) => {
    const done = await tx.selectFrom('acct.journal').select('id').where('fiscal_year', '=', fiscalYear).where('period_no', '=', 13).where('description', 'like', 'ปิดบัญชีสิ้นปี%').where('status', '=', 'posted').executeTakeFirst();
    if (done) throw new LedgerError('ปิดปีนี้แล้ว');
    const a = r.closePl.length ? await postJournalTx(tx, companyId, { date: `${y}-12-31`, periodNo: 13, lines: r.closePl, role: actor.role, book: 'GJ', description: `ปิดบัญชีสิ้นปี ${fiscalYear} (รายได้/ค่าใช้จ่าย)` }) : null;
    const b = r.transfer.length ? await postJournalTx(tx, companyId, { date: `${y}-12-31`, periodNo: 13, lines: r.transfer, role: actor.role, book: 'GJ', description: `ปิดบัญชีสิ้นปี ${fiscalYear} (โอนกำไรสะสม)` }) : null;
    return { netProfit: r.netProfit, journals: [a?.journalNo, b?.journalNo].filter(Boolean) };
  });
}

// ---------- ทะเบียนทรัพย์สิน + ค่าเสื่อม (ScreenAssets) ----------

export interface AssetInput { code: string; name: string; assetAccount: string; accumAccount: string; expenseAccount: string; startDate: string; lifeYears: string; cost: MoneyString; salvage?: MoneyString; openingAccum?: MoneyString; openingAccumDate?: string | null; sourceDocumentId?: string | null }
export async function saveAsset(db: Db, companyId: string, a: AssetInput) {
  if (Number(a.lifeYears) <= 0) throw new LedgerError('อายุการใช้งานต้องมากกว่า 0');
  const v = { name: a.name, asset_account: a.assetAccount, accum_account: a.accumAccount, expense_account: a.expenseAccount, start_date: a.startDate, life_years: a.lifeYears, cost: a.cost,
    salvage: a.salvage ?? '1.00', opening_accum: a.openingAccum ?? '0.00', opening_accum_date: a.openingAccumDate ?? null, source_document_id: a.sourceDocumentId ?? null };
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.fixed_asset').values({ company_id: companyId, code: a.code, ...v }).onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet(v)).execute());
}

type AssetRec = { cost: string; salvage: string; life_years: string; start_date: string; opening_accum: string; opening_accum_date: string | null };
const ymAdd = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number) as [number, number]; const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

/** ค่าเสื่อมสะสมตามตารางถึงสิ้นเดือน ym (รวมยอดยกมาจากทะเบียนเดิม) · ไม่เกินทุน − ซาก */
function accumThrough(a: AssetRec, ym: string): Money {
  const sch = depreciationSchedule({ cost: a.cost as MoneyString, salvage: a.salvage as MoneyString, lifeYears: Number(a.life_years), startDate: a.start_date });
  const cutoff = a.opening_accum_date?.slice(0, 7) ?? null;
  const depreciable = Money.parse(a.cost).minus(Money.parse(a.salvage));
  let accumulated: Money;
  if (cutoff) accumulated = (ym < cutoff ? Money.zero() : Money.parse(a.opening_accum)).plus(Money.sum(sch.filter((s) => s.month > cutoff && s.month <= ym).map((s) => Money.of(s.amount))));
  else accumulated = Money.sum(sch.filter((s) => s.month <= ym).map((s) => Money.of(s.amount)));
  return accumulated.gt(depreciable) ? depreciable : accumulated;
}

/**
 * ค่าเสื่อมเดือนที่จำหน่าย: คิดถึงวันที่จำหน่าย (นับวันที่จำหน่ายด้วย)
 * สูตรตาม fixtures FA-0003 dep_2569_11_formula: ค่าเสื่อมเต็มเดือน × วันที่ใช้ ÷ วันในเดือน (1,604.98 × 18 ÷ 30) · เดือนเริ่มใช้ = รายปี × วัน ÷ 365 (เหมือนเดือนแรกของตาราง)
 * TODO(Wei): fixtures ระบุผล 963.00 แต่สูตรของ fixtures เองได้ 962.988 → 962.99 (963.00 ได้เมื่อไม่หักซาก) → สะสม/ขาดทุนต่าง 0.01 · และข้อความในแบบร่าง ScreenAssets.dc.html
 *   "เดือนแรก / เดือนสุดท้าย ค่าเสื่อมต่อปี × วันที่ใช้ ÷ วันในปี" ให้ 949.80 — ต้องยืนยันสูตรเดือนสุดท้าย (ระบบใช้สูตรใน fixtures)
 */
function disposalMonthDep(a: AssetRec, date: string): Money {
  const ym = date.slice(0, 7);
  const firstMonth = a.start_date.slice(0, 7) === ym;
  const before = firstMonth ? Money.zero() : accumThrough(a, ymAdd(ym, -1));
  const annualRaw = Money.parse(a.cost).minus(Money.parse(a.salvage)).ratio(Money.of('1.00'), Money.parse(String(Number(a.life_years)))); // ไม่ปัด (เหมือน depreciationSchedule)
  const day = Number(date.slice(8, 10));
  const dim = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  let amt: Money;
  if (firstMonth) amt = annualRaw.times(String(day - Number(a.start_date.slice(8, 10)) + 1)).ratio(Money.of('1.00'), Money.of('365.00')).round();
  else amt = annualRaw.ratio(Money.of('1.00'), Money.of('12.00')).round().times(String(day)).ratio(Money.of('1.00'), Money.parse(String(dim))).round();
  if (a.opening_accum_date && ym <= a.opening_accum_date.slice(0, 7)) amt = Money.zero(); // เดือนที่ยกมาจากทะเบียนเดิมแล้ว
  const left = Money.parse(a.cost).minus(Money.parse(a.salvage)).minus(before);
  if (amt.gt(left)) amt = left.isNegative() ? Money.zero() : left;
  return amt;
}
/** ค่าเสื่อมสะสม ณ วันที่จำหน่าย */
function accumAtDisposal(a: AssetRec, date: string): { dep: Money; accum: Money } {
  const dep = disposalMonthDep(a, date);
  const before = a.start_date.slice(0, 7) === date.slice(0, 7) ? Money.zero() : accumThrough(a, ymAdd(date.slice(0, 7), -1));
  return { dep, accum: before.plus(dep) };
}

/**
 * ค่าเสื่อมของเดือน (YYYY-MM) ต่อสินทรัพย์ ตามตารางเส้นตรงรายเดือน (golden 6) · ไม่คิดเดือนที่ยกมาแล้ว
 * คืนทุกสถานะ (รวมขายแล้วในปีปฏิทินเดียวกัน): เดือนที่จำหน่าย = ค่าเสื่อมถึงวันที่จำหน่าย · หลังจำหน่าย = 0 · สะสม = ถึงวันที่จำหน่าย · มูลค่าสุทธิ 0.00
 */
export async function depreciationFor(db: Db, companyId: string, ym: string) {
  const assets = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.fixed_asset as a')
    .leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'a.disposal_journal_id').onRef('j.company_id', '=', 'a.company_id'))
    .selectAll('a').select(['j.journal_no as disposal_journal_no',
      sql<[string, string, string][] | null>`(select json_agg(json_build_array(case when l.debit > 0 then 'Dr' else 'Cr' end, l.account_code, (case when l.debit > 0 then l.debit else l.credit end)::text) order by l.line_no)
        from acct.journal_line l where l.journal_id = a.disposal_journal_id and l.company_id = a.company_id)`.as('disposal_lines'),
      sql<string | null>`(select d.doc_no from acct.document d where d.id = a.source_document_id and d.company_id = a.company_id)`.as('source_doc_no')])
    .where((eb) => eb.or([eb('a.status', '<>', 'disposed'), eb('a.disposed_on', '>=', `${ym.slice(0, 4)}-01-01`)]))
    .orderBy('a.code').execute());
  return assets.map((a) => {
    const depreciable = Money.parse(a.cost).minus(Money.parse(a.salvage));
    const sold = a.status === 'disposed' && a.disposed_on !== null && ym >= a.disposed_on.slice(0, 7);
    let amount: Money;
    let accumulated: Money;
    if (sold) {
      const d = accumAtDisposal(a, a.disposed_on!);
      accumulated = d.accum;
      amount = ym === a.disposed_on!.slice(0, 7) ? d.dep : Money.zero();
    } else {
      const sch = depreciationSchedule({ cost: a.cost as MoneyString, salvage: a.salvage as MoneyString, lifeYears: Number(a.life_years), startDate: a.start_date });
      const cutoff = a.opening_accum_date?.slice(0, 7) ?? null;
      const row = sch.find((s) => s.month === ym);
      amount = row && !(cutoff !== null && ym <= cutoff) ? Money.of(row.amount) : Money.zero();
      accumulated = accumThrough(a, ym);
    }
    const fully = !sold && amount.isZero() && accumulated.equals(depreciable);
    return {
      code: a.code, name: a.name, expense: a.expense_account, accum: a.accum_account, asset: a.asset_account, assetAccount: a.asset_account, startDate: a.start_date, lifeYears: a.life_years,
      cost: a.cost, salvage: a.salvage, status: sold ? 'disposed' as const : fully ? 'fully_depreciated' as const : 'active' as const,
      openingAccum: a.opening_accum, openingAccumDate: a.opening_accum_date, sourceDocNo: a.source_doc_no,
      amount: amount.toString(), accumulated: accumulated.toString(), nbv: sold ? '0.00' : Money.parse(a.cost).minus(accumulated).toString(),
      disposal: sold ? { date: a.disposed_on!, saleAmount: a.sale_amount, saleVat: a.sale_vat, ref: a.disposal_ref, journalNo: a.disposal_journal_no, lines: a.disposal_lines ?? [],
        nbvAtSale: Money.parse(a.cost).minus(accumulated).toString() } : null,
    };
  });
}

/** สถานะลงค่าเสื่อมต่องวด (acct.depreciation_run · journal_no, total) */
async function depreciationRunsTx(tx: CompanyTx, fiscalYear: number) {
  return tx.selectFrom('acct.depreciation_run as r').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'r.journal_id').onRef('j.company_id', '=', 'r.company_id'))
    .select(['r.period_no', 'r.total', 'j.journal_no', 'j.journal_date']).where('r.fiscal_year', '=', fiscalYear).orderBy('r.period_no').execute();
}
export async function depreciationRuns(db: Db, companyId: string, fiscalYear: number) {
  return db.withCompany(companyId, (tx) => depreciationRunsTx(tx, fiscalYear));
}

/** บัญชีกำไรจากการจำหน่ายทรัพย์สิน — ผังใน fixtures ไม่มีบัญชีเฉพาะ · ค่าตั้งต้น 4200100 ดอกเบี้ยรับ / รายได้อื่น · TODO(Wei): ยืนยันบัญชี (ตั้งได้ที่ assets.disposal_gain_account) */
export const DISPOSAL_GAIN_ACCOUNT_KEY = 'assets.disposal_gain_account';
export const DISPOSAL_LOSS_ACCOUNT = '5910100'; // ขาดทุนจากการจำหน่ายทรัพย์สิน (fixtures FA-0003)

export interface DisposeInput { date: string; saleAmount: MoneyString; vat?: boolean; receiveAccount: string; contactId?: string | null; reference?: string | null }
/**
 * ขาย/จำหน่ายทรัพย์สิน (fixtures FA-0003): Dr เงินที่รับ (ราคาขาย + VAT) / Dr ค่าเสื่อมสะสมถึงวันที่ขาย / Dr 5910100 ขาดทุน หรือ Cr กำไร / Cr ราคาทุน / Cr 2150100 ภาษีขาย
 * ค่าเสื่อมเดือนที่ขาย (ถึงวันที่ขาย) ลงใน JV ค่าเสื่อมประจำงวดตามปกติ → ต้องขายก่อนลงค่าเสื่อมงวดนั้น
 * VAT 7% เมื่อบริษัทจด VAT (ขายทรัพย์สินที่ใช้ในกิจการ) — vat: false = ไม่คิด · ค่าตั้งต้น = company.vat_registered
 * TODO(Wei) ScreenAssets.dc.html: แบบร่างอ้างใบกำกับ IV2611-0060 — ระบบยังไม่ออกเอกสาร IV ให้การขายทรัพย์สิน (เลขใบกำกับ = reference · แสดงในรายงานภาษีขาย) · ไม่มีแบบร่างฟอร์มขาย
 */
export async function disposeAsset(db: Db, companyId: string, actor: OpsActor, code: string, p: DisposeInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(p.date)) throw new LedgerError('ระบุวันที่ขายเป็น YYYY-MM-DD');
  const sale = Money.parse(p.saleAmount);
  if (sale.isNegative()) throw new LedgerError('ราคาขายติดลบไม่ได้');
  const vatRegistered = (await db.withPublic((tx) => tx.selectFrom('public.company').select('vat_registered').where('id', '=', companyId).executeTakeFirst()))?.vat_registered ?? true;
  const withVat = p.vat ?? vatRegistered;
  return db.withCompany(companyId, async (tx) => {
    const a = await tx.selectFrom('acct.fixed_asset').selectAll().where('code', '=', code).executeTakeFirst();
    if (!a) throw new LedgerError(`ไม่พบทรัพย์สิน ${code}`);
    if (a.status === 'disposed') throw new LedgerError(`${code} จำหน่ายแล้ว`);
    if (p.date < a.start_date) throw new LedgerError('วันที่ขายต้องไม่ก่อนวันที่เริ่มใช้');
    const per = await tx.selectFrom('acct.period').select(['fiscal_year', 'period_no']).where('starts_on', '<=', p.date).where('ends_on', '>=', p.date).where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirst();
    if (!per) throw new LedgerError(`ไม่มีงวดบัญชีสำหรับวันที่ ${p.date}`);
    const run = await tx.selectFrom('acct.depreciation_run').select('period_no').where('fiscal_year', '=', per.fiscal_year).where('period_no', '>=', per.period_no).executeTakeFirst();
    if (run) throw new LedgerError('ลงค่าเสื่อมงวดนี้ (หรืองวดหลัง) แล้ว — ขายทรัพย์สินย้อนหลังไม่ได้');
    const { dep, accum } = accumAtDisposal(a, p.date);
    const cost = Money.parse(a.cost);
    const nbv = cost.minus(accum);
    const vat = withVat ? sale.times('0.07').round() : Money.zero();
    const gain = sale.minus(nbv);
    const gainAccount = gain.gt(Money.zero())
      ? ((await tx.selectFrom('acct.company_setting').select('value').where('key', '=', DISPOSAL_GAIN_ACCOUNT_KEY).executeTakeFirst())?.value as string | undefined) ?? '4200100' : null;
    const lines: JournalLine[] = [
      ...(sale.plus(vat).isZero() ? [] : [{ side: 'Dr' as const, account: p.receiveAccount, amount: sale.plus(vat), ...(p.contactId ? { contactId: p.contactId } : {}) }]),
      ...(accum.isZero() ? [] : [{ side: 'Dr' as const, account: a.accum_account, amount: accum }]),
      ...(gain.isNegative() ? [{ side: 'Dr' as const, account: DISPOSAL_LOSS_ACCOUNT, amount: gain.neg() }] : []),
      { side: 'Cr' as const, account: a.asset_account, amount: cost },
      ...(vat.isZero() ? [] : [{ side: 'Cr' as const, account: '2150100', amount: vat }]),
      ...(gainAccount ? [{ side: 'Cr' as const, account: gainAccount, amount: gain }] : []),
    ];
    const j = await postJournalTx(tx, companyId, { date: p.date, lines, role: actor.role, book: 'GJ', description: `ขายทรัพย์สิน ${code} ${a.name}` });
    await tx.updateTable('acct.fixed_asset').set({ status: 'disposed', disposed_on: p.date, sale_amount: sale.toString(), sale_vat: vat.toString(), disposal_contact_id: p.contactId ?? null,
      disposal_ref: p.reference ?? null, disposal_journal_id: j.id }).where('id', '=', a.id).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'asset.disposed', entity: 'fixed_asset', entity_id: code,
      before: JSON.stringify({ status: a.status }), after: JSON.stringify({ status: 'disposed', date: p.date, sale: sale.toString(), vat: vat.toString(), journal: j.journalNo }), prev_hash: null, hash: null }).execute();
    return { journalNo: j.journalNo, depreciation: dep.toString(), accumulated: accum.toString(), nbv: nbv.toString(), vat: vat.toString(), gain: gain.toString(),
      lines: lines.map((l) => [l.side, l.account, l.amount.toString()] as [string, string, string]) };
  });
}

/** ลงค่าเสื่อมประจำงวด 1 รายการต่อเดือน (job · รันซ้ำไม่ได้) */
export async function runDepreciation(db: Db, companyId: string, actor: OpsActor, p: { fiscalYear: number; periodNo: number }) {
  const y = p.fiscalYear - 543;
  const ym = `${y}-${String(p.periodNo).padStart(2, '0')}`;
  const rows = (await depreciationFor(db, companyId, ym)).filter((r) => Money.of(r.amount as MoneyString).gt(Money.zero()));
  if (!rows.length) return { total: '0.00', journalNo: null };
  const byExp = new Map<string, Money>();
  const byAcc = new Map<string, Money>();
  for (const r of rows) {
    byExp.set(r.expense, (byExp.get(r.expense) ?? Money.zero()).plus(Money.of(r.amount as MoneyString)));
    byAcc.set(r.accum, (byAcc.get(r.accum) ?? Money.zero()).plus(Money.of(r.amount as MoneyString)));
  }
  const lines: JournalLine[] = [...[...byExp].map(([account, amount]) => ({ side: 'Dr' as const, account, amount })), ...[...byAcc].map(([account, amount]) => ({ side: 'Cr' as const, account, amount }))];
  const last = new Date(Date.UTC(y, p.periodNo, 0)).getUTCDate();
  return db.withCompany(companyId, async (tx) => {
    const done = await tx.selectFrom('acct.depreciation_run').select('journal_id').where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
    if (done) throw new LedgerError('ลงค่าเสื่อมงวดนี้แล้ว');
    const j = await postJournalTx(tx, companyId, { date: `${ym}-${last}`, lines, role: actor.role, book: 'GJ', description: `ค่าเสื่อมราคา ${p.periodNo}/${p.fiscalYear}` });
    const total = Money.sum(rows.map((r) => Money.of(r.amount as MoneyString))).toString();
    await tx.insertInto('acct.depreciation_run').values({ company_id: companyId, fiscal_year: p.fiscalYear, period_no: p.periodNo, journal_id: j.id, total, detail: JSON.stringify(rows) }).execute();
    return { total, journalNo: j.journalNo };
  });
}

// ---------- กระทบยอดธนาคาร (ScreenBankRecon) ----------
// จับคู่ 1 ต่อหลาย: acct.bank_match (statement 1 รายการ ↔ journal หลายใบ) · matched_journal_id = journal แรก (เข้ากันได้กับของเดิม)
// ปิดกระทบยอดเดือน (acct.bank_recon_close): ล็อกรายการ statement ของเดือน — นำเข้า/จับคู่/ยกเลิกจับคู่ไม่ได้
// TODO(Wei) ScreenBankRecon.dc.html: "พิมพ์งบกระทบยอด" ยังไม่มีแบบพิมพ์ในแบบร่าง

export type StatementRow = { date: string; description: string; amount: string; balance: string | null; ref?: string | null };

/** CSV: วันที่ (YYYY-MM-DD หรือ DD/MM/YYYY พ.ศ.), รายละเอียด, ยอด (+/−), ยอดคงเหลือ(ไม่บังคับ) · TODO(M6): รูปแบบไฟล์เฉพาะของแต่ละธนาคาร */
export function parseStatementCsv(text: string): StatementRow[] {
  const out = [];
  for (const line of text.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean)) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/gu)!.map((c) => c.replace(/,$/u, '').replace(/^"|"$/gu, '').replace(/""/gu, '"').trim()).filter((_, i, a) => i < a.length - 1 || a[i] !== '');
    const [d, desc, amt, bal] = cells;
    if (!d || !amt || !/\d/u.test(d)) continue; // แถวหัว
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(d);
    const date = m ? `${Number(m[3]) > 2400 ? Number(m[3]) - 543 : m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : d;
    const n = amt.replace(/,/gu, '');
    if (!/^-?\d+(\.\d{1,2})?$/u.test(n)) throw new LedgerError(`ยอดไม่ถูกต้อง: ${amt}`);
    out.push({ date, description: desc ?? '', amount: Money.parse(n).toString(), balance: bal ? Money.parse(bal.replace(/,/gu, '')).toString() : null });
  }
  return out;
}

/**
 * OFX (SGML 1.x หรือ XML 2.x): <STMTTRN> แต่ละรายการ → วันที่ (DTPOSTED) · ยอด (TRNAMT +/−) · รายละเอียด (NAME / MEMO) · อ้างอิง (FITID)
 * ยอดคงเหลือ (LEDGERBAL/BALAMT) ใส่ให้รายการสุดท้ายของวันที่ DTASOF (ถ้ามี)
 */
export function parseStatementOfx(text: string): StatementRow[] {
  const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, 'iu').exec(block)?.[1]?.trim() ?? null;
  const ymd = (v: string | null) => (v && /^\d{8}/u.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
  const amount = (v: string | null) => {
    const n = (v ?? '').replace(/,/gu, '').replace(/^\+/u, '');
    if (!/^-?\d+(\.\d{1,2})?$/u.test(n)) throw new LedgerError(`ยอดไม่ถูกต้อง: ${v ?? ''}`);
    return Money.parse(n).toString();
  };
  const out: StatementRow[] = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/giu)) {
    const b = m[1]!;
    const date = ymd(tag(b, 'DTPOSTED'));
    if (!date) throw new LedgerError('OFX: รายการไม่มีวันที่ (DTPOSTED)');
    const name = tag(b, 'NAME');
    const memo = tag(b, 'MEMO');
    out.push({ date, description: [name, memo].filter(Boolean).join(' ') || (tag(b, 'TRNTYPE') ?? ''), amount: amount(tag(b, 'TRNAMT')), balance: null, ref: tag(b, 'FITID') });
  }
  const bal = /<LEDGERBAL>([\s\S]*?)(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/iu.exec(text)?.[1];
  if (bal && out.length) {
    const asOf = ymd(tag(bal, 'DTASOF'));
    const lastDate = out.reduce((a, r) => (r.date > a ? r.date : a), out[0]!.date);
    const i = out.map((r) => r.date).lastIndexOf(lastDate);
    if (!asOf || asOf >= lastDate) out[i] = { ...out[i]!, balance: amount(tag(bal, 'BALAMT')) };
  }
  return out;
}

/** ตรวจรูปแบบจากเนื้อไฟล์: OFX (มี OFXHEADER หรือ <OFX>) · อื่น ๆ = CSV */
export function parseStatement(text: string): StatementRow[] {
  return /OFXHEADER|<OFX>/iu.test(text.slice(0, 2000)) ? parseStatementOfx(text) : parseStatementCsv(text);
}

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
async function closedMonths(tx: CompanyTx, bankAccount: string): Promise<Set<string>> {
  const rows = await tx.selectFrom('acct.bank_recon_close').select(sql<string>`to_char(month, 'YYYY-MM-DD')`.as('m')).where('bank_account', '=', bankAccount).execute();
  return new Set(rows.map((r) => r.m));
}
async function assertOpen(tx: CompanyTx, bankAccount: string, dates: string[]) {
  const closed = await closedMonths(tx, bankAccount);
  const hit = dates.find((d) => closed.has(monthStart(d)));
  if (hit) throw new LedgerError(`ปิดกระทบยอดเดือน ${hit.slice(0, 7)} แล้ว — รายการธนาคารของเดือนนี้ถูกล็อก`);
}

export async function importStatement(db: Db, companyId: string, bankAccount: string, rows: StatementRow[], batch: string) {
  return db.withCompany(companyId, async (tx) => {
    await assertOpen(tx, bankAccount, rows.map((r) => r.date));
    let added = 0;
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.date}|${r.amount}|${r.description}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      const fp = createHash('sha256').update(`${k}|${n}`).digest('hex').slice(0, 32);
      const res = await tx.insertInto('acct.bank_statement_line').values({ company_id: companyId, bank_account: bankAccount, line_date: r.date, description: r.description, amount: r.amount, balance: r.balance,
        ref: r.ref ?? null, import_batch: batch, fingerprint: fp, matched_journal_id: null }).onConflict((oc) => oc.columns(['company_id', 'bank_account', 'fingerprint']).doNothing()).executeTakeFirst();
      added += res.numInsertedOrUpdatedRows ? Number(res.numInsertedOrUpdatedRows) : 0;
    }
    return { added, skipped: rows.length - added };
  });
}

type GlCand = { id: string; journal_no: string; journal_date: string; description: string | null; amount: Money; batch_ref: string | null; doc_no: string | null };
/** journal ที่ลงบัญชีธนาคารนี้แล้วและยังไม่ถูกจับคู่ (ยอดสุทธิ + = เข้า / − = ออก) · batch_ref ของเอกสารต้นทาง (รอบจ่าย) */
async function openGl(tx: CompanyTx, bankAccount: string, asOf?: string): Promise<GlCand[]> {
  let q = tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
    .leftJoin('acct.document as d', (jn) => jn.onRef('d.id', '=', 'j.source_document_id').onRef('d.company_id', '=', 'j.company_id'))
    .select(['j.id', 'j.journal_no', 'j.journal_date', 'j.description', 'd.batch_ref', 'd.doc_no', sql<string>`sum(l.debit) - sum(l.credit)`.as('net')])
    .where('l.account_code', '=', bankAccount).where('j.status', '=', 'posted')
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom('acct.bank_match as m').innerJoin('acct.bank_statement_line as s', (jn) => jn.onRef('s.id', '=', 'm.statement_line_id').onRef('s.company_id', '=', 'm.company_id'))
      .select('m.journal_id').whereRef('m.journal_id', '=', 'j.id').where('s.bank_account', '=', bankAccount))))
    .groupBy(['j.id', 'j.journal_no', 'j.journal_date', 'j.description', 'd.batch_ref', 'd.doc_no']);
  if (asOf) q = q.where('j.journal_date', '<=', asOf);
  return (await q.orderBy('j.journal_date').orderBy('j.journal_no').execute()).map((r) => ({ ...r, amount: Money.parse(r.net) }));
}
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export interface MatchProposal { lineId: string; journals: { id: string; journal_no: string; journal_date: string; description: string | null; doc_no: string | null; amount: string }[]; kind: 'single' | 'batch'; batchRef: string | null; days: number }
/**
 * ข้อเสนอการจับคู่ของรายการที่ยังไม่จับคู่:
 * 1) 1 ต่อ 1 — ยอดเท่ากัน ทิศเดียวกัน วันที่ห่างไม่เกิน 3 วัน (เลือกวันที่ใกล้สุด)
 * 2) 1 ต่อหลาย — journal จากเอกสารที่ batch_ref เดียวกัน (รอบจ่าย) ทุกใบยังไม่จับคู่ · วันที่ห่างไม่เกิน 3 วัน · ผลรวมเท่ายอด statement (เช่น BULK 895,500.00 = PV2611-0031 + 0032 + 0033)
 */
function propose(lines: { id: string; line_date: string; amount: string }[], gl: GlCand[]): MatchProposal[] {
  const used = new Set<string>();
  const out: MatchProposal[] = [];
  const view = (g: GlCand) => ({ id: g.id, journal_no: g.journal_no, journal_date: g.journal_date, description: g.description, doc_no: g.doc_no, amount: g.amount.toString() });
  for (const s of lines) {
    const amt = Money.parse(s.amount);
    const near = gl.filter((g) => !used.has(g.id) && dayDiff(g.journal_date, s.line_date) <= 3);
    const single = near.filter((g) => g.amount.equals(amt)).sort((a, b) => dayDiff(a.journal_date, s.line_date) - dayDiff(b.journal_date, s.line_date))[0];
    if (single) {
      used.add(single.id);
      out.push({ lineId: s.id, journals: [view(single)], kind: 'single', batchRef: single.batch_ref, days: dayDiff(single.journal_date, s.line_date) });
      continue;
    }
    const batches = new Map<string, GlCand[]>();
    for (const g of near) if (g.batch_ref) batches.set(g.batch_ref, [...(batches.get(g.batch_ref) ?? []), g]);
    for (const [ref, gs] of batches) {
      if (gs.length < 2 || !Money.sum(gs.map((g) => g.amount)).equals(amt)) continue;
      // ทุกใบของรอบต้องอยู่ในชุดนี้ (ไม่มีใบของรอบที่ยังไม่จับคู่นอกช่วงวันที่)
      if (gl.some((g) => g.batch_ref === ref && !used.has(g.id) && !gs.includes(g))) continue;
      for (const g of gs) used.add(g.id);
      out.push({ lineId: s.id, journals: gs.map(view), kind: 'batch', batchRef: ref, days: Math.max(...gs.map((g) => dayDiff(g.journal_date, s.line_date))) });
      break;
    }
  }
  return out;
}

async function setMatch(tx: CompanyTx, companyId: string, lineId: string, journalIds: string[], status: 'auto' | 'manual') {
  await tx.deleteFrom('acct.bank_match').where('statement_line_id', '=', lineId).execute();
  for (const journalId of journalIds) await tx.insertInto('acct.bank_match').values({ company_id: companyId, statement_line_id: lineId, journal_id: journalId }).execute();
  await tx.updateTable('acct.bank_statement_line').set({ matched_journal_id: journalIds[0] ?? null, match_status: status }).where('id', '=', lineId).execute();
}

/** จับคู่อัตโนมัติตามข้อเสนอ (1 ต่อ 1 และ 1 ต่อหลายตามรอบจ่าย) · ข้ามเดือนที่ปิดกระทบยอดแล้ว */
export async function autoMatch(db: Db, companyId: string, bankAccount: string) {
  return db.withCompany(companyId, async (tx) => {
    const closed = await closedMonths(tx, bankAccount);
    const lines = (await tx.selectFrom('acct.bank_statement_line').select(['id', 'line_date', 'amount']).where('bank_account', '=', bankAccount).where('match_status', '=', 'unmatched').orderBy('line_date').execute())
      .filter((s) => !closed.has(monthStart(s.line_date)));
    const props = propose(lines, await openGl(tx, bankAccount));
    for (const p of props) await setMatch(tx, companyId, p.lineId, p.journals.map((j) => j.id), 'auto');
    return { matched: props.length, remaining: lines.length - props.length };
  });
}

/**
 * จับคู่เอง: journalIds 1 ใบขึ้นไป (ยอดรวมต้องเท่ายอด statement) · journalId = null → พักไว้ (ignored) · journalIds = [] → ยกเลิกจับคู่
 * เดือนที่ปิดกระทบยอดแล้ว → ปฏิเสธ
 */
export async function matchManually(db: Db, companyId: string, lineId: string, journalIds: string[] | null) {
  await db.withCompany(companyId, async (tx) => {
    const s = await tx.selectFrom('acct.bank_statement_line').selectAll().where('id', '=', lineId).executeTakeFirst();
    if (!s) throw new LedgerError('ไม่พบรายการ statement');
    await assertOpen(tx, s.bank_account, [s.line_date]);
    if (journalIds === null) {
      await tx.deleteFrom('acct.bank_match').where('statement_line_id', '=', lineId).execute();
      await tx.updateTable('acct.bank_statement_line').set({ matched_journal_id: null, match_status: 'ignored' }).where('id', '=', lineId).execute();
      return;
    }
    if (!journalIds.length) {
      await tx.deleteFrom('acct.bank_match').where('statement_line_id', '=', lineId).execute();
      await tx.updateTable('acct.bank_statement_line').set({ matched_journal_id: null, match_status: 'unmatched' }).where('id', '=', lineId).execute();
      return;
    }
    const ids = [...new Set(journalIds)];
    const nets = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(['j.id', sql<string>`sum(l.debit) - sum(l.credit)`.as('net')]).where('j.id', 'in', ids).where('l.account_code', '=', s.bank_account).where('j.status', '=', 'posted').groupBy('j.id').execute();
    if (nets.length !== ids.length) throw new LedgerError('จับคู่ได้เฉพาะรายการที่ลงบัญชีธนาคารนี้แล้ว');
    const taken = await tx.selectFrom('acct.bank_match as m').innerJoin('acct.bank_statement_line as x', (jn) => jn.onRef('x.id', '=', 'm.statement_line_id').onRef('x.company_id', '=', 'm.company_id'))
      .select('m.journal_id').where('m.journal_id', 'in', ids).where('x.bank_account', '=', s.bank_account).where('m.statement_line_id', '<>', lineId).execute();
    if (taken.length) throw new LedgerError('รายการในสมุดนี้จับคู่กับ statement รายการอื่นแล้ว');
    if (ids.length > 1 && !Money.sum(nets.map((n) => Money.parse(n.net))).equals(Money.parse(s.amount))) throw new LedgerError('ยอดรวมของรายการในสมุดต้องเท่ากับยอดใน statement');
    await setMatch(tx, companyId, lineId, ids, 'manual');
  });
}

/**
 * สรุปการกระทบยอด ณ วันที่: ยอดตาม statement ↔ GL · รายการที่ยังไม่จับคู่ทั้งสองฝั่ง · รายการที่จับคู่แล้ว (พร้อม journal) · ข้อเสนอการจับคู่ · สถานะปิดกระทบยอดของเดือน asOf
 */
export async function reconciliation(db: Db, companyId: string, bankAccount: string, asOf: string) {
  return db.withCompany(companyId, async (tx) => {
    const st = await tx.selectFrom('acct.bank_statement_line').selectAll().where('bank_account', '=', bankAccount).where('line_date', '<=', asOf).orderBy('line_date').orderBy('created_at').execute();
    const gl = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(['j.id', 'j.journal_no', 'j.journal_date', 'j.description', 'l.debit', 'l.credit']).where('l.account_code', '=', bankAccount).where('j.status', '<>', 'draft').where('j.journal_date', '<=', asOf).orderBy('j.journal_date').execute();
    const glBal = Money.sum(gl.map((g) => Money.parse(g.debit).minus(Money.parse(g.credit))));
    const stBal = st.length && st.at(-1)!.balance !== null ? Money.parse(st.at(-1)!.balance!) : Money.sum(st.map((s) => Money.parse(s.amount)));
    const matches = st.length ? await tx.selectFrom('acct.bank_match as m').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'm.journal_id').onRef('j.company_id', '=', 'm.company_id'))
      .leftJoin('acct.document as d', (jn) => jn.onRef('d.id', '=', 'j.source_document_id').onRef('d.company_id', '=', 'j.company_id'))
      .select(['m.statement_line_id', 'j.id', 'j.journal_no', 'j.journal_date', 'j.description', 'd.doc_no',
        sql<string>`(select coalesce(sum(x.debit) - sum(x.credit), 0) from acct.journal_line x where x.company_id = j.company_id and x.journal_id = j.id and x.account_code = ${bankAccount})`.as('amount')])
      .where('m.statement_line_id', 'in', st.map((s) => s.id)).orderBy('j.journal_no').execute() : [];
    const matchedIds = new Set(matches.map((m) => m.id));
    const isMatched = (s: (typeof st)[number]) => s.match_status === 'auto' || s.match_status === 'manual';
    const unmatchedStatement = st.filter((s) => s.match_status === 'unmatched');
    const month = monthStart(asOf);
    const close = await tx.selectFrom('acct.bank_recon_close').selectAll().where('bank_account', '=', bankAccount).where('month', '=', month).executeTakeFirst();
    return {
      asOf, bankAccount, statementBalance: stBal.toString(), glBalance: glBal.toString(), diff: stBal.minus(glBal).toString(),
      unmatchedStatement, unmatchedGl: gl.filter((g) => !matchedIds.has(g.id)),
      matched: st.filter(isMatched).length, total: st.length,
      matchedLines: st.filter(isMatched).map((s) => ({ ...s, journals: matches.filter((m) => m.statement_line_id === s.id).map((j) => ({ id: j.id, journal_no: j.journal_no, journal_date: j.journal_date, description: j.description, doc_no: j.doc_no, amount: j.amount })) })),
      proposals: propose(unmatchedStatement.filter((s) => !close || monthStart(s.line_date) !== month), await openGl(tx, bankAccount, asOf)),
      closed: close ? { month: close.month, closedAt: close.closed_at, closedBy: close.closed_by } : null,
    };
  });
}

/** ปิดกระทบยอดเดือน (ScreenBankRecon "ปิดกระทบยอดเดือนนี้"): ได้เมื่อผลต่าง ณ สิ้นเดือนเป็น 0.00 · ล็อกรายการ statement ของเดือน */
export async function closeReconciliation(db: Db, companyId: string, actor: OpsActor, bankAccount: string, month: string) {
  if (!/^\d{4}-\d{2}$/u.test(month)) throw new LedgerError('ระบุเดือนเป็น YYYY-MM');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const asOf = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const rec = await reconciliation(db, companyId, bankAccount, asOf);
  if (rec.closed) throw new LedgerError(`ปิดกระทบยอดเดือน ${month} แล้ว`);
  if (!Money.parse(rec.diff).isZero()) throw new LedgerError(`ปิดกระทบยอดได้เมื่อผลต่างเป็น 0.00 (ตอนนี้ ${rec.diff})`);
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.bank_recon_close').values({ company_id: companyId, bank_account: bankAccount, month: `${month}-01`,
    statement_balance: rec.statementBalance, gl_balance: rec.glBalance, closed_by: actor.userId }).execute());
  return { month, statementBalance: rec.statementBalance, glBalance: rec.glBalance };
}
