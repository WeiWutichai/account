// read model สำหรับหน้าจอ B1–B4 / A4 (ScreenCOA · ScreenJournal · ScreenFormula · ScreenLedger · ScreenOpeningBalance)
import { assertBalanced, DEFAULT_RULES, fromTuples, Money, type CompanyRole, type JournalLine, type RuleDefinition } from '@innovera/ledger';
import { sql } from 'kysely';
import type { Db } from './index.ts';
import { LedgerError, nextNumber, postJournalTx } from './ledger-service.ts';
import { balancesByContact } from './master.ts';

export interface CompanyContext {
  id: string; name: string; branch: string; period: { fiscal_year: number; period_no: number; status: string } | null;
  profile: { nameEn: string | null; taxId: string | null; branchCode: string; address: string | null; phone: string | null; email: string | null };
}

export async function companyContext(db: Db, companyId: string, today: string): Promise<CompanyContext> {
  const c = await db.withPublic((tx) => tx.selectFrom('public.company').select(['name_th', 'name_en', 'branch_code', 'tax_id', 'address', 'phone', 'email']).where('id', '=', companyId).executeTakeFirst());
  if (!c) throw new LedgerError('ไม่พบบริษัท');
  const period = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.period').select(['fiscal_year', 'period_no', 'status'])
    .where('starts_on', '<=', today).where('ends_on', '>=', today).where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirst());
  return { id: companyId, name: c.name_th, branch: c.branch_code === '00000' ? 'สำนักงานใหญ่' : `สาขา ${c.branch_code}`, period: period ?? null,
    profile: { nameEn: c.name_en, taxId: c.tax_id, branchCode: c.branch_code, address: c.address, phone: c.phone, email: c.email } };
}

export interface AccountRow {
  code: string; name: string; type: string; category: string | null; binding: string | null; is_control: boolean; active: boolean;
  balance: string | null; has_activity: boolean;
}

/** ผังบัญชีพร้อมยอดคงเหลือ (Dr − Cr) ถึงงวดที่ระบุ */
export async function listAccounts(db: Db, companyId: string, p: { fiscalYear: number; upToPeriod: number }): Promise<AccountRow[]> {
  return db.withCompany(companyId, async (tx) => {
    const rows = await tx.selectFrom('acct.account as a')
      .leftJoin(
        tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
          .select(['l.account_code', sql<string>`sum(l.debit - l.credit)`.as('bal')])
          .where('j.status', '<>', 'draft').where('j.fiscal_year', '=', p.fiscalYear).where('j.period_no', '<=', p.upToPeriod).groupBy('l.account_code').as('b'),
        (jn) => jn.onRef('b.account_code', '=', 'a.code'))
      .leftJoin(tx.selectFrom('acct.journal_line').select('account_code').distinct().as('u'), (jn) => jn.onRef('u.account_code', '=', 'a.code'))
      .select(['a.code', 'a.name', 'a.type', 'a.category', 'a.binding', 'a.is_control', 'a.active', 'b.bal', 'u.account_code as used'])
      .orderBy('a.code').execute();
    return rows.map((r) => ({ code: r.code, name: r.name, type: r.type, category: r.category, binding: r.binding, is_control: r.is_control, active: r.active,
      balance: r.bal === null ? null : Money.parse(r.bal).toString(), has_activity: r.used !== null }));
  });
}

export interface LedgerRow { date: string; journal_no: string; book: string; description: string | null; contact: string | null; debit: string; credit: string; balance: string; source_document_id: string | null }

/** บัญชีแยกประเภท: ยอดยกมา + รายการช่วงวันที่ + ยอดคงเหลือสะสม */
export async function accountLedger(db: Db, companyId: string, p: { account: string; from: string; to: string; contactId?: string }) {
  return db.withCompany(companyId, async (tx) => {
    const base = () => tx.selectFrom('acct.journal_line as l')
      .innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .where('j.status', '<>', 'draft').where('l.account_code', '=', p.account)
      .$if(p.contactId !== undefined, (q) => q.where('l.contact_id', '=', p.contactId!));
    const open = await base().select(sql<string>`coalesce(sum(l.debit - l.credit), 0)`.as('bal')).where('j.journal_date', '<', p.from).executeTakeFirstOrThrow();
    const rows = await base().leftJoin('acct.contact as c', (jn) => jn.onRef('c.id', '=', 'l.contact_id').onRef('c.company_id', '=', 'l.company_id'))
      .select(['j.journal_date', 'j.journal_no', 'j.book', 'j.description', 'j.source_document_id', 'c.name as contact', 'l.debit', 'l.credit', 'l.memo'])
      .where('j.journal_date', '>=', p.from).where('j.journal_date', '<=', p.to).orderBy('j.journal_date').orderBy('j.journal_no').orderBy('l.line_no').execute();
    let bal = Money.parse(open.bal);
    const out: LedgerRow[] = rows.map((r) => {
      const d = Money.parse(r.debit), c = Money.parse(r.credit);
      bal = bal.plus(d).minus(c);
      return { date: r.journal_date, journal_no: r.journal_no, book: r.book, description: r.memo ?? r.description, contact: r.contact, debit: d.toString(), credit: c.toString(),
        balance: bal.toString(), source_document_id: r.source_document_id };
    });
    const sum = (k: 'debit' | 'credit') => Money.sum(out.map((r) => Money.of(r[k]))).toString();
    return { opening: Money.parse(open.bal).toString(), rows: out, total_debit: sum('debit'), total_credit: sum('credit'), closing: bal.toString() };
  });
}

export interface JournalDraftInput {
  date: string; book: string; description: string; auto_reverse: boolean; recurring: 'monthly_last_day' | null;
  lines: { account_code: string; memo?: string; contact_id?: string | null; project_code?: string | null; debit?: string; credit?: string }[];
}

/** บันทึกร่าง JV (ยังไม่มีเลขที่จริง — ออกเลขตอนลงบัญชี) */
export async function saveJournalDraft(db: Db, companyId: string, d: JournalDraftInput, id?: string): Promise<string> {
  return db.withCompany(companyId, async (tx) => {
    const period = await tx.selectFrom('acct.period').select(['fiscal_year', 'period_no']).where('starts_on', '<=', d.date).where('ends_on', '>=', d.date).where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirst();
    if (!period) throw new LedgerError(`ไม่มีงวดบัญชีสำหรับวันที่ ${d.date}`);
    let jid = id;
    if (jid) {
      await tx.updateTable('acct.journal').set({ journal_date: d.date, book: d.book, description: d.description, auto_reverse: d.auto_reverse, recurring: d.recurring, ...period }).where('id', '=', jid).where('status', '=', 'draft').execute();
      await tx.deleteFrom('acct.journal_line').where('journal_id', '=', jid).execute();
    } else {
      jid = (await tx.insertInto('acct.journal').values({ company_id: companyId, journal_no: `DRAFT-${crypto.randomUUID().slice(0, 8)}`, journal_date: d.date, ...period, book: d.book,
        description: d.description, source_document_id: null, reversal_of: null, rule_version_id: null, posted_at: null, auto_reverse: d.auto_reverse, recurring: d.recurring, created_by: null })
        .returning('id').executeTakeFirstOrThrow()).id;
    }
    const lines = d.lines.filter((l) => l.account_code && (Number(l.debit ?? 0) > 0 || Number(l.credit ?? 0) > 0));
    if (lines.length) await tx.insertInto('acct.journal_line').values(lines.map((l, i) => ({ company_id: companyId, journal_id: jid!, line_no: i + 1, account_code: l.account_code,
      contact_id: l.contact_id ?? null, debit: l.debit || '0.00', credit: l.credit || '0.00', project_code: l.project_code ?? null, memo: l.memo ?? null }))).execute();
    return jid!;
  });
}

/** ลงบัญชีร่าง: ตรวจดุล + สิทธิ์งวด · ออกเลข JV · ถ้า auto_reverse สร้างรายการกลับ ณ วันแรกของงวดถัดไป */
export async function postJournalDraft(db: Db, companyId: string, id: string, role: CompanyRole): Promise<{ journalNo: string; reversalNo: string | null }> {
  return db.withCompany(companyId, async (tx) => {
    const j = await tx.selectFrom('acct.journal').selectAll().where('id', '=', id).executeTakeFirst();
    if (!j || j.status !== 'draft') throw new LedgerError('ไม่พบร่าง หรือร่างนี้ลงบัญชีแล้ว');
    const ls = await tx.selectFrom('acct.journal_line').selectAll().where('journal_id', '=', id).orderBy('line_no').execute();
    const lines: JournalLine[] = ls.map((l) => (Money.parse(l.debit).isZero()
      ? { side: 'Cr' as const, account: l.account_code, amount: Money.parse(l.credit), ...(l.contact_id ? { contactId: l.contact_id } : {}) }
      : { side: 'Dr' as const, account: l.account_code, amount: Money.parse(l.debit), ...(l.contact_id ? { contactId: l.contact_id } : {}) }));
    assertBalanced(lines);
    // บัญชีคุมห้ามลงรายวันตรง (ScreenCOA)
    const controls = await tx.selectFrom('acct.account').select('code').where('is_control', '=', true).where('code', 'in', lines.map((l) => l.account)).execute();
    if (controls.length) throw new LedgerError(`บัญชีคุม ${controls.map((c) => c.code).join(', ')} ลงรายวันตรงไม่ได้ ต้องผ่านเอกสารที่ระบุคู่ค้า`);
    // ลบร่างแล้วผ่านรายการใหม่ด้วยเลขจริง (ร่างไม่มีผลบัญชี)
    await tx.deleteFrom('acct.journal_line').where('journal_id', '=', id).execute();
    await tx.deleteFrom('acct.journal').where('id', '=', id).execute();
    const posted = await postJournalTx(tx, companyId, { date: j.journal_date, lines, role, book: j.book as 'GJ', prefix: 'JV', ...(j.description ? { description: j.description } : {}) });
    let reversalNo: string | null = null;
    if (j.auto_reverse) {
      const next = await tx.selectFrom('acct.period').select('starts_on').where('starts_on', '>', j.journal_date).where('period_no', '>=', 1).where('period_no', '<=', 12).orderBy('starts_on').executeTakeFirst();
      if (!next) throw new LedgerError('ไม่มีงวดถัดไปสำหรับกลับรายการอัตโนมัติ');
      const rev = await postJournalTx(tx, companyId, { date: next.starts_on, lines: lines.map((l) => ({ ...l, side: l.side === 'Dr' ? 'Cr' : 'Dr' })), role, book: j.book as 'GJ',
        journalNo: `${posted.journalNo}R`, description: `กลับรายการอัตโนมัติ ${posted.journalNo}`, reversalOf: posted.id });
      reversalNo = rev.journalNo;
    }
    return { journalNo: posted.journalNo, reversalNo };
  });
}

export async function listTemplates(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.journal_template').select(['id', 'name', 'book', 'description', 'lines']).orderBy('name').execute());
}
export async function saveTemplate(db: Db, companyId: string, t: { name: string; book: string; description: string; lines: unknown }) {
  return db.withCompany(companyId, (tx) => tx.insertInto('acct.journal_template').values({ company_id: companyId, ...t, lines: JSON.stringify(t.lines) })
    .onConflict((oc) => oc.columns(['company_id', 'name']).doUpdateSet({ description: t.description, lines: JSON.stringify(t.lines) })).returning('id').executeTakeFirstOrThrow());
}

export { fromTuples, nextNumber };

export interface JournalView {
  id: string; journal_no: string; journal_date: string; book: string; description: string | null; status: string; auto_reverse: boolean; recurring: string | null;
  period: { fiscal_year: number; period_no: number; status: string };
  lines: { line_no: number; account_code: string; account_name: string; memo: string | null; contact_id: string | null; contact_name: string | null; project_code: string | null; debit: string; credit: string }[];
}

export async function getJournal(db: Db, companyId: string, by: { id?: string; no?: string }): Promise<JournalView | null> {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.journal').selectAll();
    q = by.id ? q.where('id', '=', by.id) : q.where('journal_no', '=', by.no ?? '');
    const j = await q.executeTakeFirst();
    if (!j) return null;
    const p = await tx.selectFrom('acct.period').select(['fiscal_year', 'period_no', 'status']).where('fiscal_year', '=', j.fiscal_year).where('period_no', '=', j.period_no).executeTakeFirstOrThrow();
    const lines = await tx.selectFrom('acct.journal_line as l')
      .innerJoin('acct.account as a', (jn) => jn.onRef('a.code', '=', 'l.account_code').onRef('a.company_id', '=', 'l.company_id'))
      .leftJoin('acct.contact as c', (jn) => jn.onRef('c.id', '=', 'l.contact_id').onRef('c.company_id', '=', 'l.company_id'))
      .select(['l.line_no', 'l.account_code', 'a.name as account_name', 'l.memo', 'l.contact_id', 'c.name as contact_name', 'l.project_code', 'l.debit', 'l.credit'])
      .where('l.journal_id', '=', j.id).orderBy('l.line_no').execute();
    return { id: j.id, journal_no: j.journal_no, journal_date: j.journal_date, book: j.book, description: j.description, status: j.status, auto_reverse: j.auto_reverse,
      recurring: j.recurring, period: p, lines: lines.map((l) => ({ ...l, debit: Money.parse(l.debit).toString(), credit: Money.parse(l.credit).toString() })) };
  });
}

/**
 * คู่ค้าสำหรับฟอร์มเอกสาร (GET /v1/contacts) — ข้อมูลที่ฟอร์มขาย/ซื้อใช้ทันทีที่เลือกคู่ค้า
 * ar_outstanding = ยอดลูกหนี้คงค้างตามบัญชีคุม (เฉพาะรายการที่ลงบัญชีแล้ว) · credit_remaining = credit_limit − ar_outstanding
 * TODO(Wei) T4: fixtures C0012.credit_limit_remaining = 452,920 ไม่ตรงกับ 500,000 − ยอดค้างปัจจุบัน 42,800 = 457,200 → คำนวณตามสูตรนี้ (ไม่นับใบรออนุมัติ)
 */
export async function listContacts(db: Db, companyId: string) {
  return db.withCompany(companyId, async (tx) => {
    const rows = await tx.selectFrom('acct.contact').select(['id', 'code', 'name', 'kind', 'roles', 'entity_type', 'tax_id', 'branch_code', 'address', 'contact_person', 'phone', 'email',
      'credit_days', 'credit_limit', 'price_level', 'bank_account', 'default_wht', 'pnd_form', 'external_source', 'external_ref']).orderBy('code').execute();
    const bal = await balancesByContact(tx);
    return rows.map((c) => {
      const ar = bal.get(c.id)?.ar ?? Money.zero();
      return { ...c, ar_outstanding: ar.toString(), credit_remaining: c.credit_limit === null ? null : Money.parse(c.credit_limit).minus(ar).toString() };
    });
  });
}

// ---------- สูตรลงบัญชี (ScreenFormula) · สูตรของบริษัท = version ล่าสุด ทับสูตรตั้งต้น ----------

export async function listRules(db: Db, companyId: string): Promise<(RuleDefinition & { version: number; usage: number })[]> {
  return db.withCompany(companyId, async (tx) => {
    const saved = await tx.selectFrom('acct.posting_rule as r').innerJoin('acct.posting_rule_version as v', (jn) => jn.onRef('v.rule_id', '=', 'r.id').onRef('v.company_id', '=', 'r.company_id'))
      .select(['r.code', 'v.version', 'v.definition', 'v.id']).orderBy('v.version', 'desc').execute();
    const usage = await tx.selectFrom('acct.journal').select(['rule_version_id', sql<string>`count(*)`.as('n')]).where('rule_version_id', 'is not', null).groupBy('rule_version_id').execute();
    const latest = new Map<string, { version: number; def: RuleDefinition; ids: string[] }>();
    for (const s of saved) {
      const cur = latest.get(s.code);
      if (!cur) latest.set(s.code, { version: s.version, def: s.definition as RuleDefinition, ids: [s.id] });
      else cur.ids.push(s.id);
    }
    const use = (code: string) => (latest.get(code)?.ids ?? []).reduce((a, id) => a + Number(usage.find((u) => u.rule_version_id === id)?.n ?? 0), 0);
    const merged = DEFAULT_RULES.map((d) => ({ ...(latest.get(d.code)?.def ?? d), version: latest.get(d.code)?.version ?? 0, usage: use(d.code) }));
    for (const [code, l] of latest) if (!DEFAULT_RULES.some((d) => d.code === code)) merged.push({ ...l.def, version: l.version, usage: use(code) });
    return merged;
  });
}

/** บันทึกสูตร = version ใหม่ (immutable · ADR-002) · มีผลกับเอกสารที่ลงหลังจากนี้ */
export async function saveRule(db: Db, companyId: string, def: RuleDefinition): Promise<{ version: number }> {
  return db.withCompany(companyId, async (tx) => {
    const r = await tx.insertInto('acct.posting_rule').values({ company_id: companyId, code: def.code, doc_type: def.docType, name: def.name } as never)
      .onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: def.name })).returning('id').executeTakeFirstOrThrow();
    const last = await tx.selectFrom('acct.posting_rule_version').select(sql<number>`coalesce(max(version), 0)`.as('v')).where('rule_id', '=', r.id).executeTakeFirstOrThrow();
    const version = Number(last.v) + 1;
    await tx.insertInto('acct.posting_rule_version').values({ company_id: companyId, rule_id: r.id, version, definition: JSON.stringify(def) } as never).execute();
    return { version };
  });
}

/** ยอดยกมาของปีบัญชี (ScreenOpeningBalance): วันที่งวด 0 · สถานะ · บรรทัดที่ลงแล้ว · จำนวนรายใบ */
export async function openingBalance(db: Db, companyId: string, fiscalYear: number) {
  return db.withCompany(companyId, async (tx) => {
    const p0 = await tx.selectFrom('acct.period').select(['starts_on', 'status']).where('period_no', '=', 0).where('fiscal_year', '=', fiscalYear).executeTakeFirst();
    const lines = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(['l.account_code', sql<string>`sum(l.debit)`.as('dr'), sql<string>`sum(l.credit)`.as('cr')]).where('j.period_no', '=', 0).where('j.fiscal_year', '=', fiscalYear)
      .where('j.status', '<>', 'draft').groupBy('l.account_code').execute();
    const items = await tx.selectFrom('acct.document').select(['doc_type', sql<string>`count(*)`.as('n'), sql<string>`sum(grand_total)`.as('total')]).where('doc_type', 'in', ['OB-AR', 'OB-AP']).groupBy('doc_type').execute();
    const it = (t: string) => ({ count: Number(items.find((x) => x.doc_type === t)?.n ?? 0), total: Money.parse(items.find((x) => x.doc_type === t)?.total ?? '0').toString() });
    return { date: p0?.starts_on ?? null, status: p0?.status ?? null, lines: lines.map((l) => ({ account: l.account_code, debit: Money.parse(l.dr).toString(), credit: Money.parse(l.cr).toString() })),
      ar: it('OB-AR'), ap: it('OB-AP') };
  });
}

/** ปีบัญชีของยอดยกมา: ปีแรกที่มีงวด 0 ยังไม่ปิดแข็ง (บริษัทใหม่ = ปีที่เริ่มใช้ระบบ) ไม่มีก็ปีล่าสุด */
export async function openingYear(db: Db, companyId: string): Promise<number | null> {
  return db.withCompany(companyId, async (tx) => {
    const open = await tx.selectFrom('acct.period').select('fiscal_year').where('period_no', '=', 0).where('status', '<>', 'hard_closed').orderBy('fiscal_year').executeTakeFirst();
    if (open) return open.fiscal_year;
    const last = await tx.selectFrom('acct.period').select('fiscal_year').where('period_no', '=', 0).orderBy('fiscal_year', 'desc').executeTakeFirst();
    return last?.fiscal_year ?? null;
  });
}
