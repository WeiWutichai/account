// สร้างข้อมูลจำลอง: 300 บริษัท · (ก/ข) schema ละบริษัท co_<ulid> · (ค) ตารางรวม cshared + RLS
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { ulid } from 'ulid';
import { ADMIN_URL, J_BIG, J_SMALL, N_BIG, N_COMPANIES } from './db.ts';

const tpl = readFileSync(new URL('../sql/tenant-template.sql', import.meta.url), 'utf8') +
  readFileSync(new URL('../sql/tenant-filler.sql', import.meta.url), 'utf8');
const render = (cid: string, cidk: string) => tpl.replaceAll('{{CID}}', cid).replaceAll('{{CIDK}}', cidk);

// ข้อมูลต่อบริษัท · ใช้ได้ทั้งแบบ schema (prefix='') และตารางรวม (prefix=company_id)
function dataSql(n: number, cidCol: string, cidVal: string): string {
  const c = cidCol ? `${cidCol}, ` : '';
  const v = cidCol ? `'${cidVal}'::uuid, ` : '';
  return `
INSERT INTO account (${c}code, name, type) SELECT ${v}code, 'บัญชี ' || code, 'x' FROM unnest(ARRAY['1100100','1130100','2150100','2150400','4100100','4100200','5301200','5401100']) code
  UNION ALL SELECT ${v}(1200000 + g)::text, 'บัญชีเติม ' || g, 'x' FROM generate_series(1, 52) g;
INSERT INTO contact (${c}code, name, tax_id) SELECT ${v}'C' || lpad(g::text, 4, '0'), 'ลูกค้า ' || g, '0105' || lpad(g::text, 9, '0') FROM generate_series(1, 50) g;
INSERT INTO document (${c}id, doc_no, doc_type, doc_date, status, subtotal, vat, grand_total)
  SELECT ${v}g, 'IV' || lpad(g::text, 7, '0'), 'IV', date '2026-01-01' + (g % 330),
    (ARRAY['draft','pending_approval','posted','posted','posted','paid'])[1 + g % 6],
    (1000 + g % 9000)::numeric(18,2), round((1000 + g % 9000) * 0.07, 2), (1000 + g % 9000) + round((1000 + g % 9000) * 0.07, 2)
  FROM generate_series(1, ${n}) g;
INSERT INTO document_line (${c}document_id, line_no, description, qty, unit_price, amount)
  SELECT ${v}d.id, l, 'บรรทัด ' || l, 1, d.subtotal / 2, d.subtotal / 2 FROM document d, generate_series(1, 2) l ${cidCol ? `WHERE d.company_id = '${cidVal}'` : ''};
INSERT INTO journal (${c}id, journal_no, journal_date, document_id)
  SELECT ${v}d.id, 'JV' || lpad(d.id::text, 7, '0'), d.doc_date, d.id FROM document d ${cidCol ? `WHERE d.company_id = '${cidVal}'` : ''};
INSERT INTO journal_line (${c}journal_id, line_no, account_code, debit, credit)
  SELECT ${v}d.id, x.n, x.acc, x.dr, x.cr FROM document d,
  LATERAL (VALUES (1, '1130100', d.grand_total, 0::numeric), (2, '4100200', 0, round(d.subtotal / 2, 2)),
                  (3, '4100100', 0, d.subtotal - round(d.subtotal / 2, 2)), (4, '2150400', 0, d.vat)) x(n, acc, dr, cr)
  ${cidCol ? `WHERE d.company_id = '${cidVal}'` : ''};`;
}

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

log('ล้างข้อมูล spike เดิม');
const old = await admin.query<{ s: string }>("select nspname s from pg_namespace where nspname like 'co\\_%' or nspname = 'cshared'");
for (const { s } of old.rows) await admin.query(`DROP SCHEMA ${s} CASCADE`);
await admin.query('DROP TABLE IF EXISTS public.company');
await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
await admin.query(`CREATE TABLE public.company (id uuid PRIMARY KEY, schema_name text NOT NULL UNIQUE, name text NOT NULL, size_class text NOT NULL)`);
await admin.query('GRANT USAGE ON SCHEMA public TO app; GRANT SELECT ON public.company TO app');

const companies = Array.from({ length: N_COMPANIES }, (_, i) => ({
  id: crypto.randomUUID(),
  schema: `co_${ulid().toLowerCase()}`,
  big: i < N_BIG,
}));
for (const co of companies)
  await admin.query('INSERT INTO public.company VALUES ($1, $2, $3, $4)', [co.id, co.schema, `บริษัท ${co.schema.slice(-6)}`, co.big ? 'big' : 'small']);

log(`(ก/ข) สร้าง ${N_COMPANIES} schema × 38 ตาราง + ข้อมูล`);
const tenantDdl = render('', '');
let i = 0;
for (const co of companies) {
  await admin.query('BEGIN');
  await admin.query(`CREATE SCHEMA ${co.schema}; SET LOCAL search_path TO ${co.schema};`);
  await admin.query(tenantDdl);
  await admin.query(dataSql(co.big ? J_BIG : J_SMALL, '', ''));
  await admin.query(`SELECT setval(pg_get_serial_sequence('document','id'), (SELECT max(id) FROM document));
                     SELECT setval(pg_get_serial_sequence('journal','id'), (SELECT max(id) FROM journal));`);
  await admin.query(`GRANT USAGE ON SCHEMA ${co.schema} TO app;
                     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${co.schema} TO app;
                     GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${co.schema} TO app;`);
  await admin.query('COMMIT');
  if (++i % 50 === 0) log(`  ${i}/${N_COMPANIES}`);
}

log('(ค) สร้าง cshared (ตารางรวม + company_id + RLS) + ข้อมูล');
await admin.query('CREATE SCHEMA cshared');
await admin.query('SET search_path TO cshared');
// ตารางรวม: id ไม่ซ้ำข้ามบริษัท จึงใช้ sequence ปกติ ไม่กำหนด id เอง
await admin.query(render('company_id uuid NOT NULL,', 'company_id,'));
const tables = (await admin.query<{ t: string }>("select tablename t from pg_tables where schemaname='cshared'")).rows.map((r) => r.t);
let k = 0;
for (const co of companies) {
  const n = co.big ? J_BIG : J_SMALL;
  // ใน cshared id ของ document/journal ต้องไม่ชนข้ามบริษัท → offset ต่อบริษัท
  const off = k * 100000;
  const sql = dataSql(n, 'company_id', co.id)
    .replace('SELECT ' + `'${co.id}'::uuid, g, 'IV'`, `SELECT '${co.id}'::uuid, ${off} + g, 'IV'`)
    .replace(/WHERE d\.company_id = '([0-9a-f-]+)'/gu, "WHERE d.company_id = '$1'");
  await admin.query(sql);
  k++;
}
await admin.query(`SELECT setval(pg_get_serial_sequence('cshared.document','id'), (SELECT max(id) FROM cshared.document));
                   SELECT setval(pg_get_serial_sequence('cshared.journal','id'), (SELECT max(id) FROM cshared.journal));`);
for (const t of tables) {
  await admin.query(`ALTER TABLE cshared.${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE cshared.${t} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant ON cshared.${t} USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
      WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);`);
}
await admin.query(`GRANT USAGE ON SCHEMA cshared TO app;
                   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cshared TO app;
                   GRANT USAGE ON ALL SEQUENCES IN SCHEMA cshared TO app;`);
log('ANALYZE');
await admin.query('RESET search_path; ANALYZE');
const size = await admin.query<{ s: string }>("select pg_size_pretty(pg_database_size('innovera')) s");
log(`เสร็จ · ขนาด DB ${size.rows[0]?.s}`);
await admin.end();
