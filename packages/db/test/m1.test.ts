// Gate ของ M1 (TP M1 §8)
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { listMigrations, migrateDown, migrateUp } from '../src/migrate.ts';
import { seedCompany } from '../src/seed.ts';
import { admin, APP_URL, appDb, CONSOLE_URL, freshSchema, MIGRATE_URL } from './helpers.ts';

let db: Db;
let A: string, B: string;

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด', taxId: '0105xxxxxxxxx' });
  B = await createCompany(db, { orgId: org, nameTh: 'บริษัท ข จำกัด' });
  await seedCompany(db, A);
  await seedCompany(db, B);
});
afterAll(() => db.close());

describe('migration', () => {
  it('ย้อนได้ทั้งหมดแล้วรันใหม่ได้ (up → down → up)', async () => {
    const ids = listMigrations().map((m) => m.id);
    await db.close();
    expect(await migrateDown(MIGRATE_URL, Number.POSITIVE_INFINITY)).toEqual([...ids].reverse());
    expect(await migrateUp(MIGRATE_URL)).toEqual(ids);
    expect(await migrateUp(MIGRATE_URL)).toEqual([]);
    // สร้างข้อมูลใหม่หลังรันซ้ำ
    db = appDb();
    const org = await createOrganization(db, 'Innovera Group');
    A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด', taxId: '0105xxxxxxxxx' });
    B = await createCompany(db, { orgId: org, nameTh: 'บริษัท ข จำกัด' });
    await seedCompany(db, A);
    await seedCompany(db, B);
  });
});

describe('ทุกตารางบัญชีมี company_id + RLS + policy (ADR-001)', () => {
  it('สแกน catalog', async () => {
    const rows = await admin(async (c) => (await c.query<{ t: string; rls: boolean; force: boolean; owner: string; has_cid: boolean; policies: number }>(`
      select c.relname t, c.relrowsecurity rls, c.relforcerowsecurity force, pg_get_userbyid(c.relowner) owner,
        exists (select 1 from information_schema.columns k where k.table_schema = 'acct' and k.table_name = c.relname and k.column_name = 'company_id') has_cid,
        (select count(*)::int from pg_policies p where p.schemaname = 'acct' and p.tablename = c.relname) policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'acct' and c.relkind = 'r' order by 1`)).rows);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect({ t: r.t, rls: r.rls, force: r.force, cid: r.has_cid, pol: r.policies > 0, ownerNotApp: r.owner !== 'app' })
        .toEqual({ t: r.t, rls: true, force: true, cid: true, pol: true, ownerNotApp: true });
    }
  });
  it('index ทุกตัวของตารางบัญชีขึ้นต้นด้วย company_id (ยกเว้น primary key uuid/serial)', async () => {
    const bad = await admin(async (c) => (await c.query<{ i: string }>(`
      select i.relname i from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
      where n.nspname = 'acct' and not x.indisprimary and a.attname <> 'company_id'`)).rows.map((r) => r.i));
    expect(bad).toEqual([]);
  });
});

describe('seed', () => {
  it('ผังบัญชี/งวด/คู่ค้า/สินค้า จาก fixtures · รันซ้ำแล้วจำนวนเท่าเดิม', async () => {
    const first = await seedCompany(db, A);
    const again = await seedCompany(db, A);
    expect(again).toEqual(first);
    expect(first.periods).toBe(14);
    expect(first.accounts).toBeGreaterThanOrEqual(50);
  });
});

describe('แยกบริษัท (leak tests ถาวร)', () => {
  it('บริษัท B ไม่เห็นข้อมูลของ A', async () => {
    await db.withCompany(A, (tx) => tx.insertInto('acct.contact').values({ company_id: A, code: 'LEAK-A', name: 'x', kind: 'customer', tax_id: null, branch_code: null, external_source: null, external_ref: null }).execute());
    const inB = await db.withCompany(B, (tx) => tx.selectFrom('acct.contact').select('code').where('code', '=', 'LEAK-A').execute());
    expect(inB).toEqual([]);
  });
  it('ปลอม company_id ของบริษัทอื่น → ถูกปฏิเสธ', async () => {
    await expect(db.withCompany(A, (tx) => tx.insertInto('acct.contact').values({ company_id: B, code: 'FORGE', name: 'x', kind: 'customer', tax_id: null, branch_code: null, external_source: null, external_ref: null }).execute()))
      .rejects.toThrow(/row-level security/u);
  });
  describe('นอก withCompany', () => {
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    const raw = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) });
    afterAll(() => raw.destroy());
    it('ไม่ตั้ง context → เห็น 0 แถว · insert ไม่ได้', async () => {
      expect((await sql<{ n: string }>`select count(*) n from acct.account`.execute(raw)).rows[0]!.n).toBe('0');
      await expect(sql`insert into acct.contact (company_id, code, name, kind) values (${A}, 'NOCTX', 'x', 'customer')`.execute(raw)).rejects.toThrow(/row-level security/u);
    });
    it('context ไม่ค้างข้าม transaction ใน connection เดียวกัน (PgBouncer transaction mode)', async () => {
      await raw.transaction().execute(async (t) => {
        await sql`select set_config('app.company_id', ${A}, true)`.execute(t);
        expect(Number((await sql<{ n: string }>`select count(*) n from acct.account`.execute(t)).rows[0]!.n)).toBeGreaterThan(0);
      });
      expect((await sql<{ n: string }>`select count(*) n from acct.account`.execute(raw)).rows[0]!.n).toBe('0');
    });
    it('raw SQL ขอข้อมูลบริษัทอื่นตรงๆ ใน context ของ A → 0 แถว', async () => {
      const n = await raw.transaction().execute(async (t) => {
        await sql`select set_config('app.company_id', ${A}, true)`.execute(t);
        return (await sql<{ n: string }>`select count(*) n from acct.account where company_id = ${B}`.execute(t)).rows[0]!.n;
      });
      expect(n).toBe('0');
    });
  });
  it('withCompany ปฏิเสธ company_id ที่ไม่ใช่ uuid', async () => {
    await expect(db.withCompany("x' or 1=1 --", async () => 1)).rejects.toThrow(/uuid/u);
  });
  it('console_reader อ่านข้ามบริษัทได้ (BYPASSRLS · สำหรับ Console เท่านั้น)', async () => {
    const c = new pg.Client({ connectionString: CONSOLE_URL });
    await c.connect();
    const r = await c.query<{ n: number }>('select count(distinct company_id)::int n from acct.account');
    await c.end();
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});

describe('journal: Dr=Cr · ผ่านรายการแล้วแก้ไม่ได้ · ล็อกงวด', () => {
  const journal = (no: string, lines: [string, string, string][], status: 'draft' | 'posted' = 'posted', period = 11) =>
    db.withCompany(A, async (tx) => {
      const j = await tx.insertInto('acct.journal').values({ company_id: A, journal_no: no, journal_date: '2026-11-04', fiscal_year: 2569, period_no: period,
        description: null, source_document_id: null, reversal_of: null, rule_version_id: null, posted_at: null }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('acct.journal_line').values(lines.map(([acc, dr, cr], i) => ({ company_id: A, journal_id: j.id, line_no: i + 1, account_code: acc,
        debit: dr, credit: cr, contact_id: null, project_code: null, memo: null }))).execute();
      if (status === 'posted') await tx.updateTable('acct.journal').set({ status: 'posted', posted_at: new Date() }).where('id', '=', j.id).execute();
      return j.id;
    });

  it('ดุล → ผ่านรายการได้ (golden 1)', async () => {
    const id = await journal('JV-G1', [['1130100', '10700.00', '0'], ['4100200', '0', '10000.00'], ['2150400', '0', '700.00']]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  });
  it('ไม่ดุล → ผ่านรายการไม่ได้ (ถูกปฏิเสธตอน commit)', async () => {
    await expect(journal('JV-BAD', [['1130100', '100.00', '0'], ['4100200', '0', '99.99']])).rejects.toThrow(/ไม่ดุล/u);
  });
  it('ร่างไม่ดุลบันทึกได้ (ผู้ใช้ยังกรอกไม่เสร็จ)', async () => {
    await expect(journal('JV-DRAFT-UNBAL', [['1130100', '100.00', '0'], ['4100200', '0', '99.99']], 'draft')).resolves.toBeTruthy();
  });
  it('บรรทัดเดียวมีทั้ง Dr และ Cr / ติดลบ → ถูกปฏิเสธ', async () => {
    await expect(journal('JV-BOTH', [['1130100', '1.00', '1.00'], ['4100200', '0', '0']], 'draft')).rejects.toThrow(/check constraint/u);
  });
  it('แก้บรรทัด/หัว journal ที่ผ่านรายการแล้วไม่ได้ · ลบไม่ได้ · void ได้', async () => {
    const id = await journal('JV-LOCK', [['1100100', '50.00', '0'], ['4100200', '0', '50.00']]);
    await expect(db.withCompany(A, (tx) => tx.updateTable('acct.journal_line').set({ debit: '60.00' }).where('journal_id', '=', id).where('line_no', '=', 1).execute())).rejects.toThrow(/ไม่ใช่ร่าง/u);
    await expect(db.withCompany(A, (tx) => tx.updateTable('acct.journal').set({ journal_date: '2026-11-05' }).where('id', '=', id).execute())).rejects.toThrow(/void \+ reversal/u);
    await expect(db.withCompany(A, (tx) => tx.deleteFrom('acct.journal').where('id', '=', id).execute())).rejects.toThrow(/ลบ journal/u);
    await db.withCompany(A, (tx) => tx.updateTable('acct.journal').set({ status: 'voided' }).where('id', '=', id).execute());
  });
  it('ผ่านรายการโดยไม่มีบรรทัด → ถูกปฏิเสธ', async () => {
    await expect(journal('JV-EMPTY', [])).rejects.toThrow();
  });
  it('งวดปิดแข็ง → ลงรายการไม่ได้', async () => {
    await db.withCompany(A, (tx) => tx.updateTable('acct.period').set({ status: 'hard_closed' }).where('fiscal_year', '=', 2569).where('period_no', '=', 1).execute());
    await expect(journal('JV-CLOSED', [['1100100', '1.00', '0'], ['4100200', '0', '1.00']], 'posted', 1)).rejects.toThrow(/ปิดแข็ง/u);
  });
  it('audit_log append-only', async () => {
    await db.withCompany(A, (tx) => tx.insertInto('acct.audit_log').values({ company_id: A, action: 'test', entity: 'x', entity_id: '1', actor_id: null, before: null, after: null, prev_hash: null, hash: null }).execute());
    await expect(db.withCompany(A, (tx) => tx.deleteFrom('acct.audit_log').execute())).rejects.toThrow();
  });
});

describe('type ใน src/types.ts ตรงกับ DB', () => {
  it.each([
    ['journal_line', ['company_id', 'id', 'journal_id', 'line_no', 'account_code', 'contact_id', 'debit', 'credit', 'branch_code', 'project_code', 'memo']],
    ['journal', ['company_id', 'id', 'journal_no', 'journal_date', 'fiscal_year', 'period_no', 'book', 'description', 'source_document_id', 'status', 'reversal_of', 'rule_version_id', 'posted_at', 'created_at', 'auto_reverse', 'recurring', 'created_by']],
    ['account', ['company_id', 'code', 'name', 'type', 'parent_code', 'is_control', 'control_kind', 'requires_contact', 'active', 'created_at', 'category', 'binding']],
  ])('acct.%s', async (t, cols) => {
    const got = await admin(async (c) => (await c.query<{ c: string }>("select column_name c from information_schema.columns where table_schema = 'acct' and table_name = $1 order by ordinal_position", [t])).rows.map((r) => r.c));
    expect(got).toEqual(cols);
  });
});
