// ตัวนับสำหรับ lockout / rate limit (Redis: INCR + EXPIRE แบบ atomic ใน MULTI)
import type { Redis } from 'ioredis';

export interface Limiter {
  hit(key: string, windowS: number): Promise<number>;
  count(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  reset(key: string): Promise<void>;
  /** ตั้งค่าแบบครั้งเดียวภายในช่วงเวลา (เช่น ส่งอีเมลซ้ำได้ทุก 60 วิ) — true = ตั้งได้ */
  once(key: string, windowS: number): Promise<boolean>;
}

export function redisLimiter(r: Redis, prefix = 'id:'): Limiter {
  return {
    async hit(key, windowS) {
      const res = await r.multi().incr(prefix + key).expire(prefix + key, windowS, 'NX').exec();
      return Number(res?.[0]?.[1] ?? 0);
    },
    async count(key) { return Number((await r.get(prefix + key)) ?? 0); },
    async ttl(key) { return Math.max(0, await r.ttl(prefix + key)); },
    async reset(key) { await r.del(prefix + key); },
    async once(key, windowS) { return (await r.set(prefix + key, '1', 'EX', windowS, 'NX')) === 'OK'; },
  };
}

/** ตัวนับในหน่วยความจำ — ใช้ใน unit test เท่านั้น */
export function memoryLimiter(now: () => number = Date.now): Limiter {
  const m = new Map<string, { n: number; exp: number }>();
  const live = (k: string) => { const v = m.get(k); if (v && v.exp <= now()) { m.delete(k); return undefined; } return v; };
  return {
    async hit(k, w) { const v = live(k) ?? { n: 0, exp: now() + w * 1000 }; v.n++; m.set(k, v); return v.n; },
    async count(k) { return live(k)?.n ?? 0; },
    async ttl(k) { const v = live(k); return v ? Math.ceil((v.exp - now()) / 1000) : 0; },
    async reset(k) { m.delete(k); },
    async once(k, w) { if (live(k)) return false; m.set(k, { n: 1, exp: now() + w * 1000 }); return true; },
  };
}
