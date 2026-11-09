// @innovera/db — ทางเดียวที่แอปเข้าถึงฐานข้อมูล (ADR-001 ทาง ค)
//   withCompany(): ตาราง acct.* ใน context ของบริษัท (RLS) · withPublic(): ตาราง public.*
//   ไม่ export Kysely instance ดิบ — กันการ query ตารางบัญชีนอก context
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { AcctDB, PublicDB } from './types.ts';

export type { AccountType, AcctDB, PublicDB } from './types.ts';
export type CompanyTx = Transaction<AcctDB>;
export type PublicTx = Transaction<PublicDB>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// NUMERIC/DATE ให้เป็น string เสมอ (ห้ามแปลงเป็น number/Date ที่คลาดเคลื่อน)
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1082, (v) => v);

export interface Db {
  withCompany<T>(companyId: string, fn: (tx: CompanyTx) => Promise<T>): Promise<T>;
  withPublic<T>(fn: (tx: PublicTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDb(url = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera', max = 10): Db {
  const pool = new pg.Pool({ connectionString: url, max });
  const kysely = new Kysely<AcctDB & PublicDB>({ dialect: new PostgresDialect({ pool }) });
  return {
    withCompany: (companyId, fn) => {
      if (!UUID_RE.test(companyId)) return Promise.reject(new Error(`company_id ไม่ใช่ uuid: ${companyId}`));
      return kysely.transaction().execute(async (tx) => {
        await sql`select set_config('app.company_id', ${companyId}, true)`.execute(tx);
        return fn(tx as unknown as CompanyTx);
      });
    },
    withPublic: (fn) => kysely.transaction().execute((tx) => fn(tx as unknown as PublicTx)),
    close: () => kysely.destroy(),
  };
}

export { sql };
