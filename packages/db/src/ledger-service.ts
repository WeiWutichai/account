// บริการบัญชีบน DB: ผ่านรายการ journal · void + reversal · งบทดลอง · เลขที่เอกสาร · ร่างเอกสารจากภายนอก (idempotent)
import { assertBalanced, canPost, Money, type CompanyRole, type JournalLine, type PeriodStatus } from '@innovera/ledger';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';

export class LedgerError extends Error {}

/** งวดของวันที่ (งวดปกติ 1–12) · งวด 13 ต้องระบุเอง */
async function periodOf(tx: CompanyTx, date: string, periodNo?: number) {
  let q = tx.selectFrom('acct.period').selectAll().where('starts_on', '<=', date).where('ends_on', '>=', date);
  q = periodNo !== undefined ? q.where('period_no', '=', periodNo) : q.where('period_no', '>=', 1).where('period_no', '<=', 12);
  const p = await q.executeTakeFirst();
  if (!p) throw new LedgerError(`ไม่มีงวดบัญชีสำหรับวันที่ ${date}`);
  return p;
}

/** เลขที่ถัดไปแบบ {PREFIX}{YY}{MM}-{####} (YY = ค.ศ. 2 หลัก ตามเลขเอกสารในแบบร่าง เช่น IV2611-0052) · ล็อกแถวด้วย UPDATE ใน transaction เดียวกัน */
export async function nextNumber(tx: CompanyTx, companyId: string, prefix: string, date: string): Promise<string> {
  const [y, m] = date.split('-') as [string, string];
  const key = `${y.slice(2)}${m}`;
  const r = await sql<{ n: number }>`
    insert into acct.number_series (company_id, doc_type, pattern, prefix, period_key, next_no)
    values (${companyId}, ${prefix}, '{PREFIX}{YY}{MM}-{SEQ:4}', ${prefix}, ${key}, 2)
    on conflict (company_id, doc_type, period_key) do update set next_no = acct.number_series.next_no + 1
    returning next_no - 1 as n`.execute(tx);
  return `${prefix}${key}-${String(r.rows[0]!.n).padStart(4, '0')}`;
}

/**
 * เลขที่ที่ระบุเอง (นำเข้าเอกสารเดิม / seed) ต้องเลื่อนตัวนับให้เกินเลขนั้น — กันเลขย้อน/ซ้ำ (ใบกำกับภาษีต้องเรียงต่อเนื่อง ม.86/4)
 * รูปแบบที่ไม่ใช่ {PREFIX}{YYMM}-{SEQ} ไม่แตะตัวนับ
 */
export async function reserveNumber(tx: CompanyTx, companyId: string, docNo: string): Promise<void> {
  const m = /^([A-Z]+)(\d{4})-(\d+)$/u.exec(docNo);
  if (!m) return;
  const [, prefix, key, seq] = m as unknown as [string, string, string, string];
  await sql`
    insert into acct.number_series (company_id, doc_type, pattern, prefix, period_key, next_no)
    values (${companyId}, ${prefix}, '{PREFIX}{YY}{MM}-{SEQ:4}', ${prefix}, ${key}, ${Number(seq) + 1})
    on conflict (company_id, doc_type, period_key) do update set next_no = greatest(acct.number_series.next_no, excluded.next_no)`.execute(tx);
}

export interface PostJournalInput {
  date: string; // YYYY-MM-DD (ค.ศ.)
  lines: readonly JournalLine[];
  role: CompanyRole;
  book?: 'SJ' | 'PJ' | 'RJ' | 'PV' | 'GJ';
  prefix?: string; // ค่าตั้งต้น JV
  description?: string;
  sourceDocumentId?: string;
  periodNo?: number; // 13 = ปรับปรุงปิดปี
  journalNo?: string;
  reversalOf?: string;
  ruleVersionId?: string; // สูตรที่ใช้ลง (ADR-002: journal เก็บ rule_version_id)
}

export async function postJournal(db: Db, companyId: string, j: PostJournalInput): Promise<{ id: string; journalNo: string }> {
  return db.withCompany(companyId, (tx) => postJournalTx(tx, companyId, j));
}

/** ผ่านรายการภายใน transaction ที่มีอยู่ (ใช้เมื่อต้องบันทึกหลายอย่างให้สำเร็จหรือล้มเหลวพร้อมกัน) */
export async function postJournalTx(tx: CompanyTx, companyId: string, j: PostJournalInput): Promise<{ id: string; journalNo: string }> {
  assertBalanced(j.lines); // ชั้นที่ 1
  const p = await periodOf(tx, j.date, j.periodNo);
  const allowed = canPost(p.status as PeriodStatus, j.role);
  if (!allowed.ok) throw new LedgerError(allowed.reason);
  const journalNo = j.journalNo ?? (await nextNumber(tx, companyId, j.prefix ?? 'JV', j.date));
  const row = await tx.insertInto('acct.journal').values({
    company_id: companyId, journal_no: journalNo, journal_date: j.date, fiscal_year: p.fiscal_year, period_no: p.period_no,
    book: j.book ?? 'GJ', description: j.description ?? null, source_document_id: j.sourceDocumentId ?? null,
    reversal_of: j.reversalOf ?? null, rule_version_id: j.ruleVersionId ?? null, posted_at: null,
  }).returning('id').executeTakeFirstOrThrow();
  await tx.insertInto('acct.journal_line').values(j.lines.map((l, i) => ({
    company_id: companyId, journal_id: row.id, line_no: i + 1, account_code: l.account, contact_id: l.contactId ?? null,
    debit: l.side === 'Dr' ? l.amount.toString() : '0.00', credit: l.side === 'Cr' ? l.amount.toString() : '0.00',
    project_code: null, memo: l.memo ?? null,
  }))).execute();
  await tx.updateTable('acct.journal').set({ status: 'posted', posted_at: new Date() }).where('id', '=', row.id).execute();
  return { id: row.id, journalNo };
}

/** ยกเลิก: สร้าง reversal เลขที่เดิม + "R" ลงวันที่ที่ระบุ แล้วตั้งต้นฉบับเป็น voided (golden 8 · ADR-002) */
export async function voidJournal(db: Db, companyId: string, journalId: string, p: { date: string; role: CompanyRole; reason: string; actorId?: string }) {
  return db.withCompany(companyId, (tx) => voidJournalTx(tx, companyId, journalId, p));
}

/** ยกเลิก journal = กลับรายการเลขเดิม + R (ADR-002) · ภายใน transaction ที่มีอยู่ */
export async function voidJournalTx(tx: CompanyTx, companyId: string, journalId: string, p: { date: string; role: CompanyRole; reason: string; actorId?: string }) {
  if (!p.reason.trim()) throw new LedgerError('ต้องระบุเหตุผลการยกเลิก');
  const j = await tx.selectFrom('acct.journal').selectAll().where('id', '=', journalId).executeTakeFirst();
  if (!j) throw new LedgerError('ไม่พบ journal');
  if (j.status !== 'posted') throw new LedgerError(`journal ${j.journal_no} สถานะ ${j.status} ยกเลิกไม่ได้`);
  const lines = await tx.selectFrom('acct.journal_line').selectAll().where('journal_id', '=', journalId).orderBy('line_no').execute();
  const reversed: JournalLine[] = lines.map((l) => ({
    side: Money.parse(l.debit).isZero() ? 'Dr' : 'Cr', account: l.account_code,
    amount: Money.parse(Money.parse(l.debit).isZero() ? l.credit : l.debit), ...(l.contact_id ? { contactId: l.contact_id } : {}),
  }));
  const rev = await postJournalTx(tx, companyId, { date: p.date, lines: reversed, role: p.role, book: j.book as 'GJ', journalNo: `${j.journal_no}R`,
    description: `กลับรายการ ${j.journal_no}: ${p.reason}`, reversalOf: journalId, ...(j.source_document_id ? { sourceDocumentId: j.source_document_id } : {}) });
  await tx.updateTable('acct.journal').set({ status: 'voided' }).where('id', '=', journalId).execute();
  await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: p.actorId ?? null, action: 'journal.void', entity: 'journal', entity_id: journalId,
    before: JSON.stringify({ status: 'posted' }), after: JSON.stringify({ status: 'voided', reversal: rev.journalNo, reason: p.reason }), prev_hash: null, hash: null }).execute();
  return rev;
}

export interface TbRow { account: string; debit: string; credit: string; balance: string }

/** งบทดลอง: ทุก journal ที่ไม่ใช่ร่าง (ต้นฉบับที่ void + reversal หักล้างกันเอง) · balance = Dr − Cr */
export async function trialBalance(db: Db, companyId: string, p: { fiscalYear: number; upToPeriod?: number }): Promise<TbRow[]> {
  return db.withCompany(companyId, async (tx) => {
    const rows = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(['l.account_code as account', sql<string>`sum(l.debit)`.as('debit'), sql<string>`sum(l.credit)`.as('credit')])
      .where('j.status', '<>', 'draft').where('j.fiscal_year', '=', p.fiscalYear).where('j.period_no', '<=', p.upToPeriod ?? 13)
      .groupBy('l.account_code').orderBy('l.account_code').execute();
    return rows.map((r) => {
      const d = Money.parse(r.debit), c = Money.parse(r.credit);
      return { account: r.account, debit: d.toString(), credit: c.toString(), balance: d.minus(c).toString() };
    });
  });
}

export interface DraftLine { description: string; qty?: string; unit_price?: string; amount?: string; account_code?: string; product_code?: string; line_type?: 'item' | 'heading' | 'note' }
export interface DraftDocument {
  doc_type: string; issue_date: string; due_date?: string; contact_code: string; price_incl_vat?: boolean; branch_code?: string;
  lines: DraftLine[]; external_source?: string; external_ref?: string;
}

/** สร้างร่างเอกสาร (API/MCP/TMS สร้างได้แค่ร่าง) · external_source + external_ref ซ้ำ → คืนตัวเดิม ไม่สร้างใหม่ (golden 10) */
export async function createDraftDocument(db: Db, companyId: string, d: DraftDocument): Promise<{ id: string; created: boolean }> {
  if ((d.external_source === undefined) !== (d.external_ref === undefined)) throw new LedgerError('external_source และ external_ref ต้องมาคู่กัน');
  return db.withCompany(companyId, async (tx) => {
    const contact = await tx.selectFrom('acct.contact').select('id').where('code', '=', d.contact_code).executeTakeFirst();
    if (!contact) throw new LedgerError(`ไม่พบคู่ค้า ${d.contact_code}`);
    const ins = await tx.insertInto('acct.document').values({
      company_id: companyId, doc_type: d.doc_type, doc_no: null, issue_date: d.issue_date, due_date: d.due_date ?? null, contact_id: contact.id,
      price_incl_vat: d.price_incl_vat ?? false, branch_code: d.branch_code ?? '00000', external_source: d.external_source ?? null, external_ref: d.external_ref ?? null,
    }).onConflict((oc) => oc.columns(['company_id', 'external_source', 'external_ref']).doNothing()).returning('id').executeTakeFirst();
    if (!ins) {
      const existing = await tx.selectFrom('acct.document').select('id').where('external_source', '=', d.external_source!).where('external_ref', '=', d.external_ref!).executeTakeFirstOrThrow();
      return { id: existing.id, created: false };
    }
    await tx.insertInto('acct.document_line').values(d.lines.map((l, i) => ({
      company_id: companyId, document_id: ins.id, line_no: i + 1, line_type: l.line_type ?? 'item', product_code: l.product_code ?? null, description: l.description,
      qty: l.qty ?? null, unit_price: l.unit_price ?? null, amount: l.amount ?? '0.00', vat_rate: null, account_code: l.account_code ?? null,
    }))).execute();
    return { id: ins.id, created: true };
  });
}
