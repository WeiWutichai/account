import pg from 'pg';
import { migrateDown, migrateUp } from './migrate.ts';

const url = process.env.MIGRATE_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera';
const cmd = process.argv[2];
if (cmd === 'reset') {
  // DEV ONLY: ล้างข้อมูลทั้งหมด (TRUNCATE ไม่เรียก trigger ระดับแถว) แล้วย้อน/รัน migration ใหม่ — ห้ามใช้กับ production
  if (process.env.NODE_ENV === 'production' || !/localhost|127\.0\.0\.1/u.test(url)) throw new Error('reset ใช้ได้กับ DB ในเครื่องเท่านั้น');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  if ((await c.query("select to_regclass('public.company') t")).rows[0]?.t) await c.query('TRUNCATE public.company, public.organization, public.app_user CASCADE');
  await c.end();
  await migrateDown(url, Number.POSITIVE_INFINITY);
}
const ran = cmd === 'down' ? await migrateDown(url, Number(process.argv[3] ?? 1)) : await migrateUp(url);
console.log(ran.length ? `${cmd}: ${ran.join(', ')}` : `${cmd}: ไม่มีอะไรต้องรัน`);
