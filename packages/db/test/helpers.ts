import pg from 'pg';
import { createDb, type Db } from '../src/index.ts';
import { migrateDown, migrateUp } from '../src/migrate.ts';

export const MIGRATE_URL = process.env.TEST_MIGRATE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera_test';
export const CONSOLE_URL = process.env.TEST_CONSOLE_URL ?? 'postgres://console_reader:console_reader@localhost:56432/innovera_test';

/** ฐานข้อมูล test สะอาด: ย้อนทุก migration แล้วรันใหม่ */
export async function freshSchema(): Promise<void> {
  // ล้างข้อมูลทดสอบก่อนย้อน (migration บางตัวย้อนไม่ได้ถ้ามีข้อมูลที่พึ่งโครงใหม่ เช่น journal งวด 0)
  const c = new pg.Client({ connectionString: MIGRATE_URL });
  await c.connect();
  try {
    const has = await c.query("select to_regclass('public.company') as t");
    if (has.rows[0]?.t) {
      // TRUNCATE ไม่เรียก trigger ระดับแถว (กันลบ journal/audit) — ใช้เฉพาะ DB ทดสอบ
      await c.query('TRUNCATE public.company, public.organization CASCADE');
    }
  } finally {
    await c.end();
  }
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
