// งาน ops ที่ต่างกันระหว่าง schema-per-company (ก/ข) กับตารางรวม (ค): migrate · สร้างบริษัท · backup/restore · query ข้ามบริษัท
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { ADMIN_URL, loadCompanies } from './db.ts';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
const cos = await loadCompanies(admin);
const big = cos.find((c) => c.size_class === 'big')!;
const ms = async (f: () => Promise<unknown>) => { const t = performance.now(); await f(); return Math.round(performance.now() - t); };
const sh = (args: string[]) => execFileSync('docker', ['exec', 'innovera-postgres-1', ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
const out: Record<string, unknown> = { at: new Date().toISOString(), companies: cos.length };

// 1) migration: เพิ่ม 1 คอลัมน์ + 1 index
out.migrate_schema_per_company_ms = await ms(async () => {
  for (const c of cos) await admin.query(`ALTER TABLE ${c.schema_name}.document ADD COLUMN memo text; CREATE INDEX ON ${c.schema_name}.document (doc_no);`);
});
out.migrate_shared_table_ms = await ms(() => admin.query('ALTER TABLE cshared.document ADD COLUMN memo text; CREATE INDEX ON cshared.document (company_id, doc_no);'));
for (const c of cos) await admin.query(`ALTER TABLE ${c.schema_name}.document DROP COLUMN memo; DROP INDEX IF EXISTS ${c.schema_name}.document_doc_no_idx;`);
await admin.query('ALTER TABLE cshared.document DROP COLUMN memo; DROP INDEX IF EXISTS cshared.document_company_id_doc_no_idx;');

// 2) สร้างบริษัทใหม่ 1 แห่ง (โครงตารางว่าง)
const tpl = (readFileSync(new URL('../sql/tenant-template.sql', import.meta.url), 'utf8') + readFileSync(new URL('../sql/tenant-filler.sql', import.meta.url), 'utf8'))
  .replaceAll('{{CID}}', '').replaceAll('{{CIDK}}', '');
out.create_company_schema_ms = await ms(async () => {
  const c = await admin.connect();
  await c.query('BEGIN; CREATE SCHEMA co_newcompanyprobe0000000000; SET LOCAL search_path TO co_newcompanyprobe0000000000;');
  await c.query(tpl);
  await c.query('ROLLBACK');
  c.release();
});
out.create_company_shared_ms = 'แค่ insert แถวใน public.company (~1 ms)';

// 3) backup/restore บริษัทใหญ่ 1 แห่ง
out.backup_company = big.schema_name;
out.backup_schema_per_company_ms = await ms(async () => { sh(['pg_dump', '-U', 'postgres', '-d', 'innovera', '-n', big.schema_name, '-Fc', '-f', '/tmp/co.dump']); });
out.backup_schema_size = sh(['du', '-h', '/tmp/co.dump']).split('\t')[0];
sh(['psql', '-U', 'postgres', '-c', 'DROP DATABASE IF EXISTS restore_probe', '-c', 'CREATE DATABASE restore_probe']);
out.restore_schema_per_company_ms = await ms(async () => { sh(['pg_restore', '-U', 'postgres', '-d', 'restore_probe', '--no-owner', '--no-acl', '/tmp/co.dump']); });
out.restore_verified_journal_lines = sh(['psql', '-U', 'postgres', '-d', 'restore_probe', '-Atc', `select count(*) from ${big.schema_name}.journal_line`]).trim();
sh(['psql', '-U', 'postgres', '-c', 'DROP DATABASE restore_probe']);
// ตารางรวม: pg_dump กรองแถวไม่ได้ → COPY (query) ต่อตาราง
const tables = (await admin.query<{ t: string }>("select tablename t from pg_tables where schemaname='cshared'")).rows.map((r) => r.t);
out.backup_shared_copy_ms = await ms(async () => {
  for (const t of tables) sh(['psql', '-U', 'postgres', '-d', 'innovera', '-c', `\\copy (select * from cshared.${t} where company_id = '${big.id}') to '/tmp/c_${t}.csv' csv`]);
});
out.backup_shared_note = 'ตารางรวม: backup รายบริษัทต้องเขียนสคริปต์ COPY ต่อตาราง และ restore ต้อง insert กลับโดยไม่ชน id/sequence ของบริษัทอื่น — ไม่มีเครื่องมือมาตรฐาน';

// 4) Console: นับเอกสารต่อบริษัททั้งระบบ
const union = cos.map((c) => `select '${c.id}'::uuid company_id, count(*) n from ${c.schema_name}.document`).join(' union all ');
out.console_count_schema_per_company_ms = await ms(() => admin.query(union));
out.console_count_shared_ms = await ms(() => admin.query('select company_id, count(*) from cshared.document group by company_id'));

// 5) จำนวน object ในแค็ตตาล็อก (ผลต่อ pg_dump ทั้ง DB / planner / autovacuum)
out.catalog_tables = Number((await admin.query<{ n: string }>("select count(*) n from pg_class where relkind = 'r'")).rows[0]!.n);
out.db_size = (await admin.query<{ s: string }>("select pg_size_pretty(pg_database_size('innovera')) s")).rows[0]!.s;

writeFileSync(new URL('../results/ops.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await admin.end();
