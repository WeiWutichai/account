// export / import ข้อมูลรายบริษัท (เงื่อนไขของ ADR-001 ก่อน M3.5): backup รายบริษัท · ย้ายไป DB แยก · ส่งออกตาม PDPA
// export: role console_reader (BYPASSRLS · อ่านอย่างเดียว) · import: role migrator ใน transaction เดียว + set_config(app.company_id) ให้ผ่าน RLS
// ไม่ปิด trigger ใด ๆ: journal ใส่เป็นร่าง → ใส่บรรทัด → คืนสถานะเดิม · งวดใส่เป็น open → คืนสถานะเดิมตอนท้าย (Dr=Cr ตรวจตอน commit ตามปกติ)
import pg from 'pg';
import { listMigrations } from './migrate.ts';

export interface CompanyDump {
  format: 'innovera-company-dump';
  schemaVersion: string;            // migration ล่าสุดของต้นทาง — ปลายทางต้องตรงกัน
  exportedAt: string;
  companyId: string;
  public: { company: Record<string, unknown>[]; organization: Record<string, unknown>[]; company_membership: Record<string, unknown>[] };
  acct: Record<string, Record<string, unknown>[]>;   // ตาราง → แถว (เรียงตาม FK แล้ว)
}

async function acctTablesInFkOrder(c: pg.Client): Promise<string[]> {
  const tables = (await c.query<{ t: string }>("select tablename t from pg_tables where schemaname = 'acct' order by tablename")).rows.map((r) => r.t);
  const deps = (await c.query<{ child: string; parent: string }>(`
    select cl.relname child, pcl.relname parent from pg_constraint k
    join pg_class cl on cl.oid = k.conrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_class pcl on pcl.oid = k.confrelid join pg_namespace pn on pn.oid = pcl.relnamespace
    where k.contype = 'f' and n.nspname = 'acct' and pn.nspname = 'acct' and cl.relname <> pcl.relname`)).rows;
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t)) return;
    if (stack.has(t)) throw new Error(`FK วนรอบที่ ${t}`);
    stack.add(t);
    // document ↔ journal อ้างกันสองทาง: ตัดขอบ document → journal (เติม journal_id ทีหลังตอน import)
    for (const d of deps.filter((x) => x.child === t && !(x.child === 'document' && x.parent === 'journal'))) visit(d.parent, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}
/** เรียงแถวที่อ้างตัวเอง (journal.reversal_of / document.ref_document_id) ให้ต้นทางมาก่อน */
function selfOrder(rows: Record<string, unknown>[], ref: string): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const out: Record<string, unknown>[] = [];
  const done = new Set<string>();
  const add = (r: Record<string, unknown>) => {
    if (done.has(r.id as string)) return;
    const p = r[ref] as string | null;
    if (p && byId.has(p)) add(byId.get(p)!);
    done.add(r.id as string);
    out.push(r);
  };
  rows.forEach(add);
  return out;
}

export async function exportCompany(readerUrl: string, companyId: string): Promise<CompanyDump> {
  const c = new pg.Client({ connectionString: readerUrl });
  await c.connect();
  try {
    await c.query('begin isolation level repeatable read read only'); // snapshot เดียวทั้งชุด
    const one = async (sql: string) => (await c.query(sql, [companyId])).rows as Record<string, unknown>[];
    const company = await one('select * from public.company where id = $1');
    if (!company.length) throw new Error('ไม่พบบริษัท');
    const acct: CompanyDump['acct'] = {};
    for (const t of await acctTablesInFkOrder(c)) {
      let rows = await one(`select * from acct.${t} where company_id = $1`);
      if (t === 'journal') rows = selfOrder(rows, 'reversal_of');
      if (t === 'document') rows = selfOrder(rows, 'ref_document_id');
      acct[t] = rows;
    }
    const dump: CompanyDump = {
      format: 'innovera-company-dump', schemaVersion: listMigrations().at(-1)!.id, exportedAt: new Date().toISOString(), companyId,
      public: { company, organization: await one('select o.* from public.organization o join public.company c on c.org_id = o.id where c.id = $1'), company_membership: await one('select * from public.company_membership where company_id = $1') },
      acct,
    };
    await c.query('commit');
    return dump;
  } finally {
    await c.end();
  }
}

/** นำเข้า (บริษัทต้องยังไม่มีในปลายทาง) · options.withMemberships: ใส่สมาชิกด้วยถ้าผู้ใช้มีอยู่ในปลายทาง */
export async function importCompany(migratorUrl: string, dump: CompanyDump, options: { withMemberships?: boolean } = {}): Promise<Record<string, number>> {
  if (dump.format !== 'innovera-company-dump') throw new Error('ไม่ใช่ไฟล์ข้อมูลบริษัท');
  const target = listMigrations().at(-1)!.id;
  if (dump.schemaVersion !== target) throw new Error(`โครงสร้างไม่ตรง: ไฟล์ ${dump.schemaVersion} · ปลายทาง ${target} — migrate ให้ตรงกันก่อน`);
  const c = new pg.Client({ connectionString: migratorUrl });
  await c.connect();
  const counts: Record<string, number> = {};
  const insert = async (table: string, rows: Record<string, unknown>[], override: (r: Record<string, unknown>) => Record<string, unknown> = (r) => r) => {
    for (const raw of rows) {
      const r = override(raw);
      const cols = Object.keys(r);
      const vals = cols.map((k) => { const v = r[k]; return v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : v; });
      await c.query(`insert into ${table} (${cols.map((x) => `"${x}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
    }
    counts[table] = rows.length;
  };
  try {
    await c.query('begin');
    await c.query("select set_config('app.company_id', $1, true)", [dump.companyId]);
    for (const o of dump.public.organization) {
      const exists = (await c.query('select 1 from public.organization where id = $1', [o.id])).rowCount;
      if (!exists) await insert('public.organization', [o]);
    }
    await insert('public.company', dump.public.company);
    // journal → ร่างก่อน · งวด → open ก่อน (เพื่อใส่บรรทัดได้โดยไม่ปิด trigger) แล้วคืนสถานะเดิม
    const journals = dump.acct.journal ?? [];
    const periods = dump.acct.period ?? [];
    for (const [t, rows] of Object.entries(dump.acct)) {
      if (t === 'journal') await insert(`acct.${t}`, rows, (r) => ({ ...r, status: 'draft' }));
      else if (t === 'period') await insert(`acct.${t}`, rows, (r) => ({ ...r, status: 'open' }));
      else if (t === 'journal_line') continue; // หลัง journal ทั้งหมด
      else if (t === 'document') await insert(`acct.${t}`, rows, (r) => ({ ...r, journal_id: null, void_journal_id: null }));
      else await insert(`acct.${t}`, rows);
      if (t === 'journal') await insert('acct.journal_line', dump.acct.journal_line ?? []);
    }
    for (const d of dump.acct.document ?? []) {
      if (d.journal_id || d.void_journal_id) await c.query('update acct.document set journal_id = $1, void_journal_id = $2 where company_id = $3 and id = $4', [d.journal_id, d.void_journal_id, dump.companyId, d.id]);
    }
    for (const j of journals) if (j.status !== 'draft') await c.query('update acct.journal set status = $1 where company_id = $2 and id = $3', [j.status, dump.companyId, j.id]);
    for (const p of periods) if (p.status !== 'open') await c.query('update acct.period set status = $1 where company_id = $2 and fiscal_year = $3 and period_no = $4', [p.status, dump.companyId, p.fiscal_year, p.period_no]);
    // คอลัมน์ serial (document_event.id, audit_log.id …): เลื่อน sequence ให้เกินค่าที่นำเข้า
    const serials = (await c.query<{ t: string; col: string; seq: string }>(`select c.table_name t, c.column_name col, pg_get_serial_sequence('acct.' || c.table_name, c.column_name) seq
      from information_schema.columns c where c.table_schema = 'acct' and c.column_default like 'nextval%'`)).rows;
    for (const x of serials) await c.query(`select setval($1, greatest((select last_value from ${x.seq}), coalesce((select max(${x.col}) from acct.${x.t}), 1)))`, [x.seq]);
    if (options.withMemberships) {
      for (const m of dump.public.company_membership) {
        if ((await c.query('select 1 from public.app_user where id = $1', [m.user_id])).rowCount) await insert('public.company_membership', [m]);
      }
    }
    await c.query('commit'); // constraint trigger (Dr=Cr, posted ต้องมีบรรทัด) ตรวจตรงนี้
    return counts;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}
