// benchmark ผ่าน PgBouncer · ทุกทางใช้ workload และ concurrency เดียวกัน · สุ่มบริษัทแบบ Zipf (บริษัทใหญ่โดนบ่อย)
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { ADMIN_URL, APP_URL, loadCompanies, type CompanyRow } from './db.ts';
import { optionA, optionB, optionC, type TenantOption } from './options.ts';

type W = 'W1' | 'W2' | 'W3' | 'W4';
interface Scenario { w: W; conc: number; secs: number }
const SCEN: Scenario[] = (process.env.SPIKE_SCEN ?? 'W1:50:30,W2:50:30,W3:50:30,W4:50:60,W4:200:60').split(',').map((s) => {
  const [w, c, t] = s.split(':');
  return { w: w as W, conc: Number(c), secs: Number(t) };
});
const OPTS = (process.env.SPIKE_OPTS ?? 'A,B,C').split(',') as ('A' | 'B' | 'C')[];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const companies = await loadCompanies(new pg.Pool({ connectionString: APP_URL, max: 1 }));
// Zipf s=1 · เรียงบริษัทใหญ่ไว้ต้น
const ranked = [...companies].sort((a, b) => (a.size_class === b.size_class ? 0 : a.size_class === 'big' ? -1 : 1));
const weights = ranked.map((_, i) => 1 / (i + 1));
const cum: number[] = [];
weights.reduce((s, w, i) => (cum[i] = s + w), 0);
const total = cum[cum.length - 1]!;
const pick = (): CompanyRow => {
  const r = Math.random() * total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid]! < r) lo = mid + 1; else hi = mid; }
  return ranked[lo]!;
};

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;
async function backends(): Promise<number> {
  const r = await admin.query<{ n: string }>("select count(*) n from pg_stat_activity where usename = 'app' and datname = 'innovera'");
  return Number(r.rows[0]!.n);
}

async function runScenario(opt: TenantOption, s: Scenario) {
  const op = async (co: CompanyRow) => {
    const w = s.w === 'W4' ? (Math.random() < 0.7 ? 'W2' : Math.random() < 0.67 ? 'W1' : 'W3') : s.w;
    if (w === 'W1') await opt.w1(co);
    else if (w === 'W2') await opt.w2(co);
    else await opt.w3(co);
  };
  const lat: number[] = [];
  let errors = 0;
  let firstError = '';
  let maxBackends = 0;
  const end = Date.now() + s.secs * 1000;
  const sampler = setInterval(() => void backends().then((n) => (maxBackends = Math.max(maxBackends, n))), 1000);
  await Promise.all(Array.from({ length: s.conc }, async () => {
    while (Date.now() < end) {
      const t = performance.now();
      try { await op(pick()); lat.push(performance.now() - t); }
      catch (e) { errors++; firstError ||= (e as Error).message.slice(0, 200); }
    }
  }));
  clearInterval(sampler);
  lat.sort((a, b) => a - b);
  return {
    workload: s.w, concurrency: s.conc, seconds: s.secs, ops: lat.length, ops_per_sec: +(lat.length / s.secs).toFixed(1),
    p50_ms: +pct(lat, 50).toFixed(1), p95_ms: +pct(lat, 95).toFixed(1), p99_ms: +pct(lat, 99).toFixed(1),
    errors, first_error: firstError, max_pg_backends_app: maxBackends, rss_mb: Math.round(process.memoryUsage().rss / 1e6),
  };
}

const all: Record<string, unknown[]> = {};
for (const key of OPTS) {
  all[key] = [];
  for (const s of SCEN) {
    const opt = key === 'A' ? optionA(s.conc) : key === 'B' ? optionB(s.conc) : optionC(s.conc);
    // อุ่นเครื่อง: ทุกบริษัท 1 ครั้ง (ทาง ข = สร้าง client ครบ 300)
    for (const co of companies) await opt.w2(co);
    const extra = key === 'B' ? { prisma_clients: (opt as ReturnType<typeof optionB>).clients() } : {};
    const r = { ...(await runScenario(opt, s)), ...extra };
    console.log(key, JSON.stringify(r));
    all[key]!.push(r);
    await opt.close();
  }
}
writeFileSync(new URL('../results/bench.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), companies: companies.length, results: all }, null, 2));
await admin.end();
process.exit(0);
