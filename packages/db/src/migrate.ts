// migration runner: ไฟล์ SQL คู่ NNNN_name.up.sql / .down.sql · ทำใน transaction · ต่อตรงด้วย role migrator (ไม่ผ่าน PgBouncer)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface Migration { id: string; up: string; down: string }

export function listMigrations(): Migration[] {
  const ids = [...new Set(readdirSync(DIR).filter((f) => /^\d{4}_.+\.(up|down)\.sql$/u.test(f)).map((f) => f.replace(/\.(up|down)\.sql$/u, '')))].sort();
  return ids.map((id) => ({ id, up: readFileSync(`${DIR}${id}.up.sql`, 'utf8'), down: readFileSync(`${DIR}${id}.down.sql`, 'utf8') }));
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function applied(c: pg.Client): Promise<string[]> {
  return (await c.query<{ id: string }>('SELECT id FROM public.schema_migrations ORDER BY id')).rows.map((r) => r.id);
}

/** รันทุก migration ที่ยังไม่ได้รัน · คืนรายการที่รัน */
export async function migrateUp(url: string): Promise<string[]> {
  return withClient(url, async (c) => {
    const done = new Set(await applied(c));
    const ran: string[] = [];
    for (const m of listMigrations()) {
      if (done.has(m.id)) continue;
      await c.query('BEGIN');
      try {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('innovera.migrate'))");
        await c.query(m.up);
        await c.query('INSERT INTO public.schema_migrations (id) VALUES ($1)', [m.id]);
        await c.query('COMMIT');
        ran.push(m.id);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`migration ${m.id} ล้มเหลว: ${(e as Error).message}`);
      }
    }
    return ran;
  });
}

/** ย้อน migration ล่าสุด `steps` ขั้น (Infinity = ทั้งหมด) */
export async function migrateDown(url: string, steps = 1): Promise<string[]> {
  return withClient(url, async (c) => {
    const done = (await applied(c)).reverse().slice(0, steps);
    const all = new Map(listMigrations().map((m) => [m.id, m]));
    const ran: string[] = [];
    for (const id of done) {
      const m = all.get(id);
      if (!m) throw new Error(`ไม่พบไฟล์ down ของ ${id}`);
      await c.query('BEGIN');
      try {
        await c.query(m.down);
        await c.query('DELETE FROM public.schema_migrations WHERE id = $1', [id]);
        await c.query('COMMIT');
        ran.push(id);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`ย้อน ${id} ล้มเหลว: ${(e as Error).message}`);
      }
    }
    return ran;
  });
}
