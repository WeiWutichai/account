// เข้าสู่ระบบผู้ใช้ dev ผ่าน id-api จริง (รหัสผ่าน + TOTP) → บันทึก Playwright storageState ที่ .playwright/dev-session.json · DEV ONLY
// ใช้: pnpm dev:session  (ต้องรัน id-api และ pnpm db:seed ก่อน)
import { totpAt } from '@innovera/auth';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../../.playwright/', import.meta.url));

const ID_API = process.env.ID_API_URL ?? 'http://localhost:4100';
const COMPANY = process.env.DEV_COMPANY_ID ?? '00000000-0000-4000-8000-000000000001';
// DEV_USER=approver → ผู้จัดการบัญชี (ไฟล์ .playwright/dev-session-approver.json) · ตรงกับ apps/id-api/src/dev-seed.ts
const APPROVER = process.env.DEV_USER === 'approver';
const USER = { email: APPROVER ? 'acct.mgr@innovera.co.th' : 'wei@innovera.co.th', password: 'innovera-dev-password-2569', totp: 'JBSWY3DPEHPK3PXP' };

const jar = new Map<string, string>();
const keep = (res: Response) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv!.indexOf('='); jar.set(kv!.slice(0, i), kv!.slice(i + 1)); } };
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function post(path: string, body: unknown) {
  const res = await fetch(`${ID_API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(), 'user-agent': 'dev-session' }, body: JSON.stringify(body) });
  keep(res);
  const j = (await res.json()) as { next?: string; error?: string };
  if (!res.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
const r = await post('/v1/auth/login', { email: USER.email, password: USER.password });
if (r.next === 'mfa') {
  // รอช่วงเวลา TOTP ถัดไปถ้าช่วงนี้ถูกใช้แล้ว (กันใช้รหัสซ้ำ)
  try { await post('/v1/auth/2fa/verify', { code: totpAt(USER.totp, Date.now()) }); } catch { await new Promise((ok) => setTimeout(ok, 31_000)); await post('/v1/auth/2fa/verify', { code: totpAt(USER.totp, Date.now()) }); }
}
const expires = Math.floor(Date.now() / 1000) + 12 * 3600;
const cookies = [...jar].filter(([k]) => k === 'inn_at' || k === 'inn_rt').map(([name, value]) => ({ name, value: decodeURIComponent(value), domain: 'localhost', path: '/', expires, httpOnly: true, secure: false, sameSite: 'Lax' as const }));
cookies.push({ name: 'inn_co', value: COMPANY, domain: 'localhost', path: '/', expires, httpOnly: true, secure: false, sameSite: 'Lax' });
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}${APPROVER ? 'dev-session-approver.json' : 'dev-session.json'}`, JSON.stringify({ cookies, origins: [] }, null, 2));
console.log(`✓ session ของ ${USER.email} → .playwright/dev-session.json (${cookies.length} cookies)`);
