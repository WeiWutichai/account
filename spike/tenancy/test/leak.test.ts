// ทดสอบรั่วข้ามบริษัท (เกณฑ์ผ่าน = 0 รั่วผ่านทางปกติ) + บันทึก "ช่องโหว่ที่ต้องมีตัวกันชั้น 2" ของแต่ละทาง
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, loadCompanies, type CompanyRow } from '../src/db.ts';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { optionA, optionB, optionC, type TenantOption } from '../src/options.ts';

type Outcome = 'blocked-error' | 'blocked-empty' | 'LEAK' | 'isolated';
const matrix: Record<string, Record<string, Outcome | string>> = { A: {}, B: {}, C: {} };
let A: CompanyRow, B: CompanyRow;
const run = Date.now().toString(36);

beforeAll(async () => {
  const p = new pg.Pool({ connectionString: APP_URL, max: 1 });
  const cos = await loadCompanies(p);
  await p.end();
  if (cos.length < 2) throw new Error('ต้องรัน pnpm setup ก่อน');
  [A, B] = [cos[0]!, cos[1]!];
});

afterAll(() => {
  writeFileSync(new URL('../results/leak-matrix.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), matrix }, null, 2));
});

describe.each([
  ['A', () => optionA(4)],
  ['B', () => optionB(4)],
  ['C', () => optionC(4)],
] as const)('ทางเลือก %s · การใช้งานปกติ', (key, make) => {
  let opt: TenantOption;
  beforeAll(() => { opt = make(); });
  afterAll(() => opt.close());

  it('เขียนในบริษัท A แล้วบริษัท B มองไม่เห็น', async () => {
    const m = `LEAK-${key}-${run}`;
    await opt.w1(A, m);
    expect(await opt.countMarker(A, m)).toBe(1);
    expect(await opt.countMarker(B, m)).toBe(0);
    matrix[key]!['write A → read B'] = 'isolated';
  });
  it('อ่านรายการ/งบทดลองของตัวเองได้', async () => {
    expect(await opt.w2(A)).toBeGreaterThan(0);
    expect(await opt.w3(A)).toBeGreaterThan(0);
  });
});

describe('ทางเลือก A · ลืมตั้ง context / context ค้าง / raw SQL', () => {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 }); // บังคับใช้ connection เดียวกัน
  const db = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) });
  afterAll(() => db.destroy());

  it('ลืม set search_path → error (ไม่รั่ว)', async () => {
    await expect(db.transaction().execute((t) => sql`select count(*) from document`.execute(t))).rejects.toThrow(/does not exist/u);
    matrix.A!['no context'] = 'blocked-error';
  });
  it('search_path แบบ LOCAL ไม่ค้างข้าม transaction ใน connection เดียวกัน', async () => {
    await db.transaction().execute(async (t) => {
      await sql`select set_config('search_path', ${A.schema_name}, true)`.execute(t);
      await sql`select count(*) from document`.execute(t);
    });
    await expect(db.transaction().execute((t) => sql`select count(*) from document`.execute(t))).rejects.toThrow(/does not exist/u);
    matrix.A!['context sticky across tx'] = 'blocked-error';
  });
  it('raw SQL อ้าง schema บริษัทอื่นตรงๆ → อ่านได้ (ช่องโหว่ ต้องกันด้วย lint/ห้าม raw SQL)', async () => {
    const r = await db.transaction().execute(async (t) => {
      await sql`select set_config('search_path', ${A.schema_name}, true)`.execute(t);
      return sql<{ n: string }>`select count(*) n from ${sql.table(`${B.schema_name}.document`)}`.execute(t);
    });
    expect(Number(r.rows[0]!.n)).toBeGreaterThan(0);
    matrix.A!['raw SQL to other schema'] = 'LEAK';
  });
});

describe('ทางเลือก B · client ผิดตัว / raw SQL', () => {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
  let ca: PrismaClient;
  beforeAll(() => { ca = new PrismaClient({ adapter: new PrismaPg(pool, { schema: A.schema_name }) }); });
  afterAll(async () => { await ca.$disconnect(); await pool.end(); });

  it('client ของ A query ได้เฉพาะ schema ของ A', async () => {
    expect(await ca.document.count()).toBeGreaterThan(0);
    matrix.B!['client bound to schema'] = 'isolated';
  });
  it('raw SQL อ้าง schema บริษัทอื่นตรงๆ → อ่านได้ (ช่องโหว่)', async () => {
    const r = await ca.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) n from "${B.schema_name}".document`);
    expect(Number(r[0]!.n)).toBeGreaterThan(0);
    matrix.B!['raw SQL to other schema'] = 'LEAK';
  });
});

describe('ทางเลือก C · ลืมตั้ง context / context ค้าง / raw SQL / ปลอม company_id', () => {
  const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
  const db = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) });
  afterAll(() => db.destroy());
  const count = (t: Parameters<Parameters<ReturnType<typeof db.transaction>['execute']>[0]>[0], where = sql``) =>
    sql<{ n: string }>`select count(*) n from cshared.document ${where}`.execute(t).then((r) => Number(r.rows[0]!.n));

  it('ลืม set company → เห็น 0 แถว (ไม่รั่ว)', async () => {
    expect(await db.transaction().execute((t) => count(t))).toBe(0);
    matrix.C!['no context'] = 'blocked-empty';
  });
  it('ลืม set company แล้ว insert → ถูกปฏิเสธ', async () => {
    await expect(db.transaction().execute((t) => sql`insert into cshared.account (company_id, code, name, type) values (${A.id}, 'X', 'x', 'x')`.execute(t))).rejects.toThrow(/row-level security/u);
    matrix.C!['insert without context'] = 'blocked-error';
  });
  it('context แบบ LOCAL ไม่ค้างข้าม transaction', async () => {
    await db.transaction().execute(async (t) => {
      await sql`select set_config('app.company_id', ${A.id}, true)`.execute(t);
      expect(await count(t)).toBeGreaterThan(0);
    });
    expect(await db.transaction().execute((t) => count(t))).toBe(0);
    matrix.C!['context sticky across tx'] = 'blocked-empty';
  });
  it('raw SQL ขอข้อมูลบริษัทอื่นตรงๆ → 0 แถว (RLS กัน)', async () => {
    const n = await db.transaction().execute(async (t) => {
      await sql`select set_config('app.company_id', ${A.id}, true)`.execute(t);
      return count(t, sql`where company_id = ${B.id}`);
    });
    expect(n).toBe(0);
    matrix.C!['raw SQL to other company'] = 'blocked-empty';
  });
  it('ปลอม company_id ของบริษัทอื่นตอน insert → ถูกปฏิเสธ', async () => {
    await expect(db.transaction().execute(async (t) => {
      await sql`select set_config('app.company_id', ${A.id}, true)`.execute(t);
      await sql`insert into cshared.account (company_id, code, name, type) values (${B.id}, 'X', 'x', 'x')`.execute(t);
    })).rejects.toThrow(/row-level security/u);
    matrix.C!['forged company_id on insert'] = 'blocked-error';
  });
});

describe('คำถามข้อ 1 (PLAN §9): Prisma + SET LOCAL search_path', () => {
  it('SQL ที่ Prisma สร้างใส่ชื่อ schema กำกับ จึงสลับบริษัทด้วย search_path ไม่ได้', async () => {
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    const queries: string[] = [];
    const p = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
    p.$on('query', (e) => queries.push(e.query));
    let error = '';
    try {
      await p.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('search_path', '${A.schema_name}', true)`);
        await tx.document.count();
      });
    } catch (e) {
      error = (e as Error).message.split('\n').slice(-2).join(' ').trim();
    }
    await p.$disconnect();
    // เทียบกับทาง ข: client ที่ผูก schema → SQL ใส่ชื่อ schema ของบริษัทกำกับ (เก็บจาก query ที่สำเร็จ)
    const qb: string[] = [];
    const pb = new PrismaClient({ adapter: new PrismaPg(pool, { schema: A.schema_name }), log: [{ emit: 'event', level: 'query' }] });
    pb.$on('query', (e) => qb.push(e.query));
    await pb.document.count();
    await pb.$disconnect();
    await pool.end();
    const optionBSql = qb.find((q) => q.includes('document')) ?? '';
    writeFileSync(new URL('../results/prisma-search-path.json', import.meta.url),
      JSON.stringify({ withSearchPath: { queriesLogged: queries, error }, optionB: { sql: optionBSql } }, null, 2));
    expect(error).toMatch(/public\.document/u); // Prisma หา "public"."document" แม้ตั้ง search_path แล้ว
    expect(optionBSql).toContain(`"${A.schema_name}"."document"`);
  });
});
