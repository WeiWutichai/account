// ตรวจ dependency จริง: Postgres ผ่าน PgBouncer (transaction mode) + Redis
import pg from 'pg';
import { Redis } from 'ioredis';

export interface DepStatus {
  ok: boolean;
  detail: string;
}
export interface Health {
  status: 'ok' | 'degraded';
  service: string;
  checks: { postgres_via_pgbouncer: DepStatus; redis: DepStatus };
}

const dbUrl = (): string => process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera';
const redisUrl = (): string => process.env.REDIS_URL ?? 'redis://localhost:56379';

async function checkPg(): Promise<DepStatus> {
  const c = new pg.Client({ connectionString: dbUrl(), connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    const r = await c.query<{ v: string }>('select version() as v');
    return { ok: true, detail: r.rows[0]?.v.split(' on ')[0] ?? 'connected' };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function checkRedis(): Promise<DepStatus> {
  const r = new Redis(redisUrl(), { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0 });
  r.on('error', () => undefined); // ผลรายงานผ่าน DepStatus แทน
  try {
    await r.connect();
    return { ok: (await r.ping()) === 'PONG', detail: 'PONG' };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  } finally {
    r.disconnect();
  }
}

export async function health(service: string): Promise<Health> {
  const [p, r] = await Promise.all([checkPg(), checkRedis()]);
  return { status: p.ok && r.ok ? 'ok' : 'degraded', service, checks: { postgres_via_pgbouncer: p, redis: r } };
}
