import pg from 'pg';
import { createDb, type Db } from '../src/index.ts';
import { migrateDown, migrateUp } from '../src/migrate.ts';

export const MIGRATE_URL = process.env.TEST_MIGRATE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera_test';
export const CONSOLE_URL = process.env.TEST_CONSOLE_URL ?? 'postgres://console_reader:console_reader@localhost:56432/innovera_test';

/** ฐานข้อมูล test สะอาด: ย้อนทุก migration แล้วรันใหม่ */
export async function freshSchema(): Promise<void> {
  await migrateDown(MIGRATE_URL, Number.POSITIVE_INFINITY);
  await migrateUp(MIGRATE_URL);
}

export function appDb(max = 4): Db {
  return createDb(APP_URL, max);
}

export async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: MIGRATE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
