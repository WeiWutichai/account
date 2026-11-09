// 3 ทางเลือก tenancy ภายใต้ interface เดียวกัน · ทุกทางต่อผ่าน PgBouncer (transaction mode)
import { PrismaPg } from '@prisma/adapter-pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { PrismaClient } from './generated/prisma/client.ts';
import { APP_URL, type CompanyRow } from './db.ts';

interface Doc { id: string; company_id?: string; doc_no: string; doc_type: string; doc_date: string; status: string; subtotal: string; vat: string; grand_total: string }
interface Line { company_id?: string; document_id: string; line_no: number; description: string; qty: string; unit_price: string; amount: string }
interface Jnl { id: string; company_id?: string; journal_no: string; journal_date: string; document_id: string }
interface JLine { company_id?: string; journal_id: string; line_no: number; account_code: string; debit: string; credit: string }
interface TenantDB { document: Doc; document_line: Line; journal: Jnl; journal_line: JLine }

export interface TenantOption {
  readonly key: 'A' | 'B' | 'C';
  readonly label: string;
  w1(co: CompanyRow, marker?: string): Promise<void>; // สร้างเอกสาร + journal 4 บรรทัด
  w2(co: CompanyRow): Promise<number>; // รายการเอกสาร 25 แถว
  w3(co: CompanyRow): Promise<number>; // งบทดลอง
  countMarker(co: CompanyRow, marker: string): Promise<number>;
  close(): Promise<void>;
}

const SCHEMA_RE = /^co_[0-9a-z]{26}$/u;
const today = '2026-11-30';
const amounts = { sub: '1000.00', vat: '70.00', gt: '1070.00', half: '500.00' };

// ---------- (ก) Prisma public + Kysely tenant · SET LOCAL search_path ----------
export function optionA(poolMax: number): TenantOption {
  const pool = new pg.Pool({ connectionString: APP_URL, max: poolMax });
  const db = new Kysely<TenantDB>({ dialect: new PostgresDialect({ pool }) });
  // ทางเดียวที่เข้าถึงตาราง tenant ได้: ตั้ง search_path แบบ LOCAL ใน transaction (ไม่ค้างใน connection ของ pgbouncer)
  const withCompany = <T>(co: CompanyRow, fn: (trx: Transaction<TenantDB>) => Promise<T>) => {
    if (!SCHEMA_RE.test(co.schema_name)) throw new Error('schema name ไม่ถูกต้อง');
    return db.transaction().execute(async (trx) => {
      await sql`select set_config('search_path', ${co.schema_name}, true)`.execute(trx);
      return fn(trx);
    });
  };
  return {
    key: 'A',
    label: 'Prisma (public) + Kysely (tenant) · search_path',
    w1: (co, marker = 'IV-BENCH') =>
      withCompany(co, async (trx) => {
        const d = await trx.insertInto('document').values({ doc_no: marker, doc_type: 'IV', doc_date: today, status: 'draft', subtotal: amounts.sub, vat: amounts.vat, grand_total: amounts.gt } as never).returning('id').executeTakeFirstOrThrow();
        await trx.insertInto('document_line').values([1, 2].map((n) => ({ document_id: d.id, line_no: n, description: 'x', qty: '1', unit_price: amounts.half, amount: amounts.half }))).execute();
        const j = await trx.insertInto('journal').values({ journal_no: marker, journal_date: today, document_id: d.id } as never).returning('id').executeTakeFirstOrThrow();
        await trx.insertInto('journal_line').values(jl(j.id)).execute();
      }),
    w2: (co) => withCompany(co, async (trx) => (await trx.selectFrom('document').selectAll().where('status', '=', 'posted').orderBy('doc_date', 'desc').limit(25).execute()).length),
    w3: (co) => withCompany(co, async (trx) => (await trx.selectFrom('journal_line').select(['account_code', sql<string>`sum(debit)`.as('dr'), sql<string>`sum(credit)`.as('cr')]).groupBy('account_code').execute()).length),
    countMarker: (co, m) => withCompany(co, async (trx) => Number((await trx.selectFrom('document').select(sql<string>`count(*)`.as('n')).where('doc_no', '=', m).executeTakeFirstOrThrow()).n)),
    close: () => db.destroy(),
  };
}

// ---------- (ข) Prisma client ต่อบริษัท · ใช้ pg.Pool ร่วมกัน (Prisma 7 adapter รับ schema) ----------
export function optionB(poolMax: number, cacheSize = 1000): TenantOption & { clients(): number } {
  const pool = new pg.Pool({ connectionString: APP_URL, max: poolMax });
  const cache = new Map<string, PrismaClient>();
  const client = (co: CompanyRow): PrismaClient => {
    if (!SCHEMA_RE.test(co.schema_name)) throw new Error('schema name ไม่ถูกต้อง');
    let c = cache.get(co.schema_name);
    if (c) {
      cache.delete(co.schema_name);
      cache.set(co.schema_name, c); // LRU
      return c;
    }
    c = new PrismaClient({ adapter: new PrismaPg(pool, { schema: co.schema_name }) });
    cache.set(co.schema_name, c);
    if (cache.size > cacheSize) {
      const [oldKey, oldClient] = cache.entries().next().value as [string, PrismaClient];
      cache.delete(oldKey);
      void oldClient.$disconnect();
    }
    return c;
  };
  return {
    key: 'B',
    label: 'Prisma client ต่อบริษัท (shared pg.Pool)',
    clients: () => cache.size,
    w1: async (co, marker = 'IV-BENCH') => {
      await client(co).$transaction(async (tx) => {
        const d = await tx.document.create({
          data: { docNo: marker, docType: 'IV', docDate: new Date(today), status: 'draft', subtotal: amounts.sub, vat: amounts.vat, grandTotal: amounts.gt,
            lines: { create: [1, 2].map((n) => ({ lineNo: n, description: 'x', qty: '1', unitPrice: amounts.half, amount: amounts.half })) } },
        });
        await tx.journal.create({ data: { journalNo: marker, journalDate: new Date(today), documentId: d.id,
          lines: { create: jl('0').map(({ line_no, account_code, debit, credit }) => ({ lineNo: line_no, accountCode: account_code, debit, credit })) } } });
      });
    },
    w2: async (co) => (await client(co).document.findMany({ where: { status: 'posted' }, orderBy: { docDate: 'desc' }, take: 25 })).length,
    w3: async (co) => (await client(co).journalLine.groupBy({ by: ['accountCode'], _sum: { debit: true, credit: true } })).length,
    countMarker: async (co, m) => client(co).document.count({ where: { docNo: m } }),
    close: async () => {
      await Promise.all([...cache.values()].map((c) => c.$disconnect()));
      await pool.end();
    },
  };
}

// ---------- (ค) ตารางรวม + company_id + Row-Level Security · Kysely ----------
export function optionC(poolMax: number): TenantOption {
  const pool = new pg.Pool({ connectionString: APP_URL, max: poolMax });
  const db = new Kysely<TenantDB>({ dialect: new PostgresDialect({ pool }) }).withSchema('cshared');
  const withCompany = <T>(co: CompanyRow, fn: (trx: Transaction<TenantDB>) => Promise<T>) =>
    db.transaction().execute(async (trx) => {
      await sql`select set_config('app.company_id', ${co.id}, true)`.execute(trx);
      return fn(trx);
    });
  return {
    key: 'C',
    label: 'ตารางรวม + company_id + RLS (Kysely)',
    w1: (co, marker = 'IV-BENCH') =>
      withCompany(co, async (trx) => {
        const d = await trx.insertInto('document').values({ company_id: co.id, doc_no: marker, doc_type: 'IV', doc_date: today, status: 'draft', subtotal: amounts.sub, vat: amounts.vat, grand_total: amounts.gt } as never).returning('id').executeTakeFirstOrThrow();
        await trx.insertInto('document_line').values([1, 2].map((n) => ({ company_id: co.id, document_id: d.id, line_no: n, description: 'x', qty: '1', unit_price: amounts.half, amount: amounts.half }))).execute();
        const j = await trx.insertInto('journal').values({ company_id: co.id, journal_no: marker, journal_date: today, document_id: d.id } as never).returning('id').executeTakeFirstOrThrow();
        await trx.insertInto('journal_line').values(jl(j.id).map((l) => ({ ...l, company_id: co.id }))).execute();
      }),
    // หมายเหตุ: ไม่ใส่ where company_id เอง — พึ่ง RLS ล้วน เพื่อทดสอบว่า RLS กันได้จริง
    w2: (co) => withCompany(co, async (trx) => (await trx.selectFrom('document').selectAll().where('status', '=', 'posted').orderBy('doc_date', 'desc').limit(25).execute()).length),
    w3: (co) => withCompany(co, async (trx) => (await trx.selectFrom('journal_line').select(['account_code', sql<string>`sum(debit)`.as('dr'), sql<string>`sum(credit)`.as('cr')]).groupBy('account_code').execute()).length),
    countMarker: (co, m) => withCompany(co, async (trx) => Number((await trx.selectFrom('document').select(sql<string>`count(*)`.as('n')).where('doc_no', '=', m).executeTakeFirstOrThrow()).n)),
    close: () => db.destroy(),
  };
}

function jl(journalId: string): JLine[] {
  return [
    { journal_id: journalId, line_no: 1, account_code: '1130100', debit: amounts.gt, credit: '0.00' },
    { journal_id: journalId, line_no: 2, account_code: '4100200', debit: '0.00', credit: amounts.half },
    { journal_id: journalId, line_no: 3, account_code: '4100100', debit: '0.00', credit: amounts.half },
    { journal_id: journalId, line_no: 4, account_code: '2150400', debit: '0.00', credit: amounts.vat },
  ];
}
