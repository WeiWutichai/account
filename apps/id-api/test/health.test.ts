import { afterEach, describe, expect, it } from 'vitest';
import { health } from '../src/health.js';

const saved = { db: process.env.DATABASE_URL, redis: process.env.REDIS_URL };
afterEach(() => {
  process.env.DATABASE_URL = saved.db;
  process.env.REDIS_URL = saved.redis;
});

describe('health', () => {
  it('รายงาน degraded (ไม่ throw) เมื่อ dependency ต่อไม่ได้', async () => {
    process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/none';
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const r = await health('t');
    expect(r.status).toBe('degraded');
    expect(r.service).toBe('t');
    expect(r.checks.postgres_via_pgbouncer.ok).toBe(false);
    expect(r.checks.redis.ok).toBe(false);
  });
});
