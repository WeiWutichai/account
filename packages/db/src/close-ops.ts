// M6 ปิดงวด · ทะเบียนทรัพย์สิน + ค่าเสื่อม · กระทบยอดธนาคาร (docs/technical-plan-M6.md)
import { depreciationSchedule, Money, yearEndClose, type CompanyRole, type JournalLine, type MoneyString } from '@innovera/ledger';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './index.ts';
import { LedgerError, postJournalTx, trialBalance } from './ledger-service.ts';
import { emitTx } from './hub.ts';

export interface OpsActor { userId: string | null; role: CompanyRole }
const MANAGERS: readonly CompanyRole[] = ['owner', 'accounting_manager'];

// ---------- ปิดงวด (ScreenPeriodClose) ----------
// open → soft_closed (manager+ แก้ได้) → hard_closed (ห้ามแก้) · เปิดงวดคืนต้องมีเหตุผล + audit (CLAUDE.md)

export async function periodStatus(db: Db, companyId: string, fiscalYear: number) {
  return db.withCompany(companyId, async (tx) => {
    const periods = await tx.selectFrom('acct.period').selectAll().where('fiscal_year', '=', fiscalYear).orderBy('period_no').execute();
    const drafts = await tx.selectFrom('acct.journal').select(['period_no', sql<string>`count(*)`.as('n')]).where('fiscal_year', '=', fiscalYear).where('status', '=', 'draft').groupBy('period_no').execute();
    const pending = await tx.selectFrom('acct.document').select([sql<number>`extract(month from issue_date)::int`.as('m'), sql<string>`count(*)`.as('n')])
      .where('status', 'in', ['draft', 'pending_approval']).groupBy(sql`extract(month from issue_date)`).execute();
    return periods.map((p) => ({ ...p, draftJournals: Number(drafts.find((d) => d.period_no === p.period_no)?.n ?? 0),
      pendingDocuments: p.period_no >= 1 && p.period_no <= 12 ? Number(pending.find((d) => d.m === p.period_no)?.n ?? 0) : 0 }));
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

/** ค่าเสื่อมของเดือน (YYYY-MM) ต่อสินทรัพย์ ตามตารางเส้นตรงรายเดือน (golden 6) · ไม่คิดเดือนที่ยกมาแล้ว */
export async function depreciationFor(db: Db, companyId: string, ym: string) {
  const assets = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.fixed_asset').selectAll().where('status', '=', 'active').orderBy('code').execute());
  return assets.map((a) => {
    const sch = depreciationSchedule({ cost: a.cost as MoneyString, salvage: a.salvage as MoneyString, lifeYears: Number(a.life_years), startDate: a.start_date });
    const row = sch.find((s) => s.month === ym);
    const skip = a.opening_accum_date && ym <= a.opening_accum_date.slice(0, 7);
    return { code: a.code, name: a.name, expense: a.expense_account, accum: a.accum_account, amount: row && !skip ? row.amount : '0.00', accumulated: row?.accumulated ?? null, nbv: row?.nbv ?? null };
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

/** CSV: วันที่ (YYYY-MM-DD หรือ DD/MM/YYYY พ.ศ.), รายละเอียด, ยอด (+/−), ยอดคงเหลือ(ไม่บังคับ) · TODO(M6): OFX และรูปแบบไฟล์ของแต่ละธนาคาร */
export function parseStatementCsv(text: string): { date: string; description: string; amount: string; balance: string | null }[] {
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

export async function importStatement(db: Db, companyId: string, bankAccount: string, rows: ReturnType<typeof parseStatementCsv>, batch: string) {
  return db.withCompany(companyId, async (tx) => {
    let added = 0;
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.date}|${r.amount}|${r.description}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      const fp = createHash('sha256').update(`${k}|${n}`).digest('hex').slice(0, 32);
      const res = await tx.insertInto('acct.bank_statement_line').values({ company_id: companyId, bank_account: bankAccount, line_date: r.date, description: r.description, amount: r.amount, balance: r.balance,
        ref: null, import_batch: batch, fingerprint: fp, matched_journal_id: null }).onConflict((oc) => oc.columns(['company_id', 'bank_account', 'fingerprint']).doNothing()).executeTakeFirst();
      added += res.numInsertedOrUpdatedRows ? Number(res.numInsertedOrUpdatedRows) : 0;
    }
    return { added, skipped: rows.length - added };
  });
}

/** จับคู่อัตโนมัติ: ยอดเท่ากัน (เข้า = Dr / ออก = Cr ของบัญชีธนาคาร) วันที่ห่างไม่เกิน 3 วัน · 1 journal ต่อ 1 รายการ · เลือกวันที่ใกล้สุด */
export async function autoMatch(db: Db, companyId: string, bankAccount: string) {
  return db.withCompany(companyId, async (tx) => {
    const lines = await tx.selectFrom('acct.bank_statement_line').selectAll().where('bank_account', '=', bankAccount).where('match_status', '=', 'unmatched').orderBy('line_date').execute();
    const used = new Set((await tx.selectFrom('acct.bank_statement_line').select('matched_journal_id').where('bank_account', '=', bankAccount).where('matched_journal_id', 'is not', null).execute()).map((x) => x.matched_journal_id));
    let matched = 0;
    for (const s of lines) {
      const amt = Money.parse(s.amount);
      const cands = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
        .select(['j.id', 'j.journal_date']).where('l.account_code', '=', bankAccount).where('j.status', '=', 'posted')
        .where(amt.isNegative() ? 'l.credit' : 'l.debit', '=', amt.abs().toString())
        .where('j.journal_date', '>=', sql<string>`${s.line_date}::date - 3`).where('j.journal_date', '<=', sql<string>`${s.line_date}::date + 3`).execute();
      const best = cands.filter((c) => !used.has(c.id)).sort((a, b) => Math.abs(Date.parse(a.journal_date) - Date.parse(s.line_date)) - Math.abs(Date.parse(b.journal_date) - Date.parse(s.line_date)))[0];
      if (!best) continue;
      await tx.updateTable('acct.bank_statement_line').set({ matched_journal_id: best.id, match_status: 'auto' }).where('id', '=', s.id).execute();
      used.add(best.id);
      matched++;
    }
    return { matched, remaining: lines.length - matched };
  });
}

export async function matchManually(db: Db, companyId: string, lineId: string, journalId: string | null) {
  await db.withCompany(companyId, (tx) => tx.updateTable('acct.bank_statement_line').set(journalId ? { matched_journal_id: journalId, match_status: 'manual' } : { matched_journal_id: null, match_status: 'ignored' }).where('id', '=', lineId).execute());
}

/** สรุปการกระทบยอด ณ วันที่: ยอดตาม statement ↔ GL · รายการที่ยังไม่จับคู่ทั้งสองฝั่ง */
export async function reconciliation(db: Db, companyId: string, bankAccount: string, asOf: string) {
  return db.withCompany(companyId, async (tx) => {
    const st = await tx.selectFrom('acct.bank_statement_line').selectAll().where('bank_account', '=', bankAccount).where('line_date', '<=', asOf).orderBy('line_date').execute();
    const gl = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(['j.id', 'j.journal_no', 'j.journal_date', 'j.description', 'l.debit', 'l.credit']).where('l.account_code', '=', bankAccount).where('j.status', '<>', 'draft').where('j.journal_date', '<=', asOf).orderBy('j.journal_date').execute();
    const glBal = Money.sum(gl.map((g) => Money.parse(g.debit).minus(Money.parse(g.credit))));
    const stBal = st.length && st.at(-1)!.balance !== null ? Money.parse(st.at(-1)!.balance!) : Money.sum(st.map((s) => Money.parse(s.amount)));
    const matchedIds = new Set(st.map((s) => s.matched_journal_id).filter(Boolean));
    return {
      asOf, bankAccount, statementBalance: stBal.toString(), glBalance: glBal.toString(), diff: stBal.minus(glBal).toString(),
      unmatchedStatement: st.filter((s) => s.match_status === 'unmatched'), unmatchedGl: gl.filter((g) => !matchedIds.has(g.id)),
      matched: st.filter((s) => s.match_status === 'auto' || s.match_status === 'manual').length, total: st.length,
    };
  });
}
