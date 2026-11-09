// Innovera ID บน DB + Redis จริง (ฐานข้อมูลแยก innovera_test_id) — TP M3 §6 ข้อ 2
import { generateSecret, newSigningKey, totpAt, verifyAccess } from '@innovera/auth';
import { createDb, type Db } from '@innovera/db';
import { migrateDown, migrateUp } from '@innovera/db/migrate';
import { Redis } from 'ioredis';
import { createLocalJWKSet } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IdConfig } from '../src/config.ts';
import { IdError, Identity, type LoginResult } from '../src/identity.ts';
import { redisLimiter } from '../src/limiter.ts';
import { Orgs, validTaxId } from '../src/org.ts';
import { randomBytes } from 'node:crypto';

const MIGRATE = process.env.TEST_ID_MIGRATE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera_test_id';
const APP = process.env.TEST_ID_DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera_test_id';
const client = { ip: '203.0.113.7', ua: 'vitest' };

let db: Db;
let redis: Redis;
let id: Identity;
let orgs: Orgs;
let cfg: IdConfig;
let clock = Date.parse('2026-11-30T03:00:00Z');

async function sql<T extends pg.QueryResultRow>(q: string, p: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: MIGRATE });
  await c.connect();
  try { return (await c.query<T>(q, p)).rows; } finally { await c.end(); }
}
const lastOutbox = async (email: string, template: string) =>
  (await sql<{ payload: Record<string, string> }>('select payload from public.outbox_email where to_email = $1 and template = $2 order by id desc limit 1', [email, template]))[0]?.payload;
const pendingOf = (r: LoginResult) => { if (r.kind !== 'pending') throw new Error(`คาดว่า pending ได้ ${r.kind}`); return r; };
const sessionOf = (r: LoginResult) => { if (r.kind !== 'session') throw new Error(`คาดว่า session ได้ ${r.kind}`); return r; };
const PW = 'ม้าลายกินหญ้า-ริมน้ำ-2569';

/** สมัคร → ยืนยันอีเมล → ตั้ง 2FA → ได้ session + รหัสสำรอง */
async function onboard(email: string) {
  const s = pendingOf(await id.signup({ name: 'ทดสอบ ระบบ', email, password: PW, acceptTerms: true }, client));
  const { code } = (await lastOutbox(email, 'verify_email'))!;
  const v = pendingOf(await id.verifyEmail(s.pending, code!, client));
  expect(v.stage).toBe('setup');
  const setup = await id.startMfaSetup({ pending: v.pending, client });
  const en = await id.enableMfa({ pending: v.pending, client }, totpAt(setup.secret, clock));
  const me = (await sql<{ id: string }>('select id from public.app_user where email = $1', [email]))[0]!;
  return { userId: me.id, secret: setup.secret, backupCodes: en.backupCodes, tokens: en.tokens! };
}

beforeAll(async () => {
  const c = new pg.Client({ connectionString: MIGRATE });
  await c.connect();
  if ((await c.query("select to_regclass('public.company') t")).rows[0]?.t) await c.query('TRUNCATE public.company, public.organization, public.app_user CASCADE');
  await c.end();
  await migrateDown(MIGRATE, Number.POSITIVE_INFINITY);
  await migrateUp(MIGRATE);
  db = createDb(APP, 4);
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:56379');
  const prefix = `test:${randomBytes(4).toString('hex')}:`;
  cfg = { signingKey: (await newSigningKey('t')).key, dataKey: randomBytes(32).toString('base64'), cookieKey: 'k', audience: ['id', 'accounting'], secureCookies: false, cookieDomain: undefined, now: () => new Date(clock) };
  id = new Identity(db, redisLimiter(redis, prefix), cfg);
  orgs = new Orgs(db, cfg.now);
}, 120_000);
afterAll(async () => { await db.close(); redis.disconnect(); });

describe('สมัคร → ยืนยันอีเมล → 2FA → session (ScreenSignup → ScreenTwoFactor)', () => {
  it('ครบขั้น · access token มี amr pwd+otp · TOTP secret ไม่เก็บ plaintext', async () => {
    const o = await onboard('wei@innovera.co.th');
    const claims = await verifyAccess(o.tokens.access, createLocalJWKSet({ keys: [cfg.signingKey.publicJwk] }), 'accounting', new Date(clock));
    expect(claims).toMatchObject({ sub: o.userId, amr: ['pwd', 'otp'], email: 'wei@innovera.co.th' });
    expect(o.backupCodes).toHaveLength(10);
    const [u] = await sql<{ totp_secret_enc: string; mfa_enabled: boolean }>('select totp_secret_enc, mfa_enabled from public.app_user where id = $1', [o.userId]);
    expect(u!.mfa_enabled).toBe(true);
    expect(u!.totp_secret_enc).not.toContain(o.secret);
  });
  it('นโยบายรหัสผ่าน · ต้องยอมรับเงื่อนไข', async () => {
    await expect(id.signup({ name: 'ก', email: 'short@x.co', password: 'สั้น', acceptTerms: true }, client)).rejects.toThrow(/12 ตัวอักษร/u);
    await expect(id.signup({ name: 'ก', email: 'terms@x.co', password: PW, acceptTerms: false }, client)).rejects.toThrow(/ยอมรับ/u);
  });
  it('สมัครด้วยอีเมลที่มีแล้ว → ตอบเหมือนสมัครใหม่ (ไม่บอกว่ามีบัญชี) + แจ้งเจ้าของอีเมล', async () => {
    const r = pendingOf(await id.signup({ name: 'อื่น', email: 'WEI@innovera.co.th', password: PW, acceptTerms: true }, client));
    expect(r.stage).toBe('verify');
    expect(await lastOutbox('wei@innovera.co.th', 'signup_existing')).toBeDefined();
  });
  it('รหัสยืนยันอีเมลผิด 5 ครั้ง → ต้องขอใหม่', async () => {
    const s = pendingOf(await id.signup({ name: 'ข', email: 'verify@x.co', password: PW, acceptTerms: true }, client));
    for (let i = 0; i < 5; i++) await expect(id.verifyEmail(s.pending, '000000', client)).rejects.toThrow(/ไม่ถูกต้อง/u);
    const { code } = (await lastOutbox('verify@x.co', 'verify_email'))!;
    await expect(id.verifyEmail(s.pending, code!, client)).rejects.toThrow(/หมดอายุ/u);
  });
  it('pending cookie ผูก IP/UA และหมดอายุ 5 นาที', async () => {
    const s = pendingOf(await id.signup({ name: 'ค', email: 'bind@x.co', password: PW, acceptTerms: true }, client));
    expect(() => id.readPending(s.pending, { ip: '198.51.100.1', ua: 'vitest' }, 'verify')).toThrow(IdError);
    expect(() => id.readPending(s.pending, client, 'mfa')).toThrow(IdError);
    clock += 6 * 60_000;
    expect(() => id.readPending(s.pending, client, 'verify')).toThrow(/หมดเวลา/u);
  });
});

describe('เข้าสู่ระบบ + 2FA (ScreenLogin → ScreenTwoFactor)', () => {
  let o: Awaited<ReturnType<typeof onboard>>;
  beforeAll(async () => { o = await onboard('login@x.co'); });

  it('รหัสผ่านถูก → ขอ 2FA → TOTP ถูก → session · ใช้รหัสเดิมซ้ำไม่ได้', async () => {
    clock += 60_000;
    const p = pendingOf(await id.login({ email: 'login@x.co', password: PW }, client, null));
    expect(p.stage).toBe('mfa');
    const code = totpAt(o.secret, clock);
    sessionOf(await id.verifyMfa(p.pending, { code }, client));
    const p2 = pendingOf(await id.login({ email: 'login@x.co', password: PW }, client, null));
    await expect(id.verifyMfa(p2.pending, { code }, client)).rejects.toThrow(/ไม่ถูกต้อง/u);
  });
  it('รหัสสำรองใช้ได้ครั้งเดียว', async () => {
    const p = pendingOf(await id.login({ email: 'login@x.co', password: PW }, client, null));
    const s = sessionOf(await id.verifyMfa(p.pending, { backupCode: o.backupCodes[3]! }, client));
    expect(s.tokens.amr).toEqual(['pwd', 'backup_code']);
    const p2 = pendingOf(await id.login({ email: 'login@x.co', password: PW }, client, null));
    await expect(id.verifyMfa(p2.pending, { backupCode: o.backupCodes[3]! }, client)).rejects.toThrow(IdError);
  });
  it('เชื่อถืออุปกรณ์ 30 วัน → ครั้งถัดไปไม่ถาม 2FA', async () => {
    clock += 60_000;
    const p = pendingOf(await id.login({ email: 'login@x.co', password: PW }, client, null));
    const s = sessionOf(await id.verifyMfa(p.pending, { code: totpAt(o.secret, clock), trust: true }, client));
    expect(s.trustedDevice).toBeDefined();
    const again = sessionOf(await id.login({ email: 'login@x.co', password: PW }, client, s.trustedDevice!));
    expect(again.tokens.amr).toEqual(['pwd', 'trusted_device']);
    expect((await id.login({ email: 'login@x.co', password: PW }, client, `${s.trustedDevice!}x`)).kind).toBe('pending');
  });
  it('2FA ผิด 5 ครั้ง → ล็อก 15 นาที (ScreenTwoFactor)', async () => {
    const p = pendingOf(await id.login({ email: 'login@x.co', password: PW }, client, null));
    for (let i = 0; i < 4; i++) await expect(id.verifyMfa(p.pending, { code: '000000' }, client)).rejects.toMatchObject({ status: 401 });
    await expect(id.verifyMfa(p.pending, { code: '000000' }, client)).rejects.toMatchObject({ status: 423 });
    await expect(id.verifyMfa(p.pending, { code: totpAt(o.secret, clock) }, client)).rejects.toMatchObject({ status: 423 });
  });
  it('รหัสผ่านผิด 10 ครั้ง → ล็อกบัญชี · ข้อความไม่บอกว่ามีบัญชีหรือไม่', async () => {
    await expect(id.login({ email: 'nobody@x.co', password: PW }, client, null)).rejects.toThrow('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    for (let i = 0; i < 10; i++) await expect(id.login({ email: 'verify@x.co', password: 'ผิดผิดผิดผิด1' }, client, null)).rejects.toThrow('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    await expect(id.login({ email: 'verify@x.co', password: PW }, client, null)).rejects.toMatchObject({ status: 423 });
  });
});

describe('session: refresh หมุน · ใช้ซ้ำ = เพิกถอนทั้ง family · logout', () => {
  it('หมุนได้ · token เก่าใช้ซ้ำ → family ถูกเพิกถอน', async () => {
    const o = await onboard('rt@x.co');
    const t1 = await id.refresh(o.tokens.refresh, client);
    expect(t1.refresh).not.toBe(o.tokens.refresh);
    await expect(id.refresh(o.tokens.refresh, client)).rejects.toMatchObject({ status: 401 });
    await expect(id.refresh(t1.refresh, client)).rejects.toMatchObject({ status: 401 }); // ทั้ง family ถูกเพิกถอน
    const ev = await sql<{ event: string }>("select event from public.login_event where email = 'rt@x.co' and event = 'refresh_reuse'");
    expect(ev).toHaveLength(1);
  });
  it('หมดอายุตามนโยบาย 12 ชม. · logout เพิกถอน', async () => {
    const o = await onboard('exp@x.co');
    const sid = (await verifyAccess(o.tokens.access, createLocalJWKSet({ keys: [cfg.signingKey.publicJwk] }), 'id', new Date(clock))).sid;
    expect(await id.isSessionActive(sid)).toBe(true);
    await id.logout(o.tokens.refresh, client);
    expect(await id.isSessionActive(sid)).toBe(false);
    const o2 = await onboard('exp2@x.co');
    clock += 13 * 3_600_000;
    await expect(id.refresh(o2.tokens.refresh, client)).rejects.toMatchObject({ status: 401 });
  });
});

describe('ลืมรหัสผ่าน (ScreenPasswordReset)', () => {
  it('ตอบเหมือนกันทุกกรณี · ลิงก์ใช้ครั้งเดียว · ห้ามซ้ำรหัสเดิม · ออกจากทุกอุปกรณ์', async () => {
    const o = await onboard('reset@x.co');
    expect(await id.forgotPassword('none@x.co', client)).toEqual({ resendInS: 60 });
    expect(await id.forgotPassword('reset@x.co', client)).toEqual({ resendInS: 60 });
    const { token } = (await lastOutbox('reset@x.co', 'reset_password'))!;
    await expect(id.resetPassword({ token: token!, password: PW, confirm: PW, logoutOthers: true }, client)).rejects.toThrow(/ห้ามซ้ำ/u);
    const NEW = 'กาแฟดำไม่ใส่น้ำตาล-30';
    await expect(id.resetPassword({ token: token!, password: NEW, confirm: 'อื่น', logoutOthers: true }, client)).rejects.toThrow(/ไม่ตรงกัน/u);
    const r = pendingOf(await id.resetPassword({ token: token!, password: NEW, confirm: NEW, logoutOthers: true }, client));
    expect(r.stage).toBe('mfa'); // "หลังตั้งใหม่ระบบจะขอรหัส 2FA ตามปกติ"
    await expect(id.refresh(o.tokens.refresh, client)).rejects.toMatchObject({ status: 401 });
    await expect(id.resetPassword({ token: token!, password: 'อีกรหัสหนึ่ง-ยาวพอ-1', confirm: 'อีกรหัสหนึ่ง-ยาวพอ-1', logoutOthers: false }, client)).rejects.toMatchObject({ status: 410 });
    expect(await lastOutbox('reset@x.co', 'password_changed')).toBeDefined();
    expect((await id.login({ email: 'reset@x.co', password: NEW }, client, null)).kind).toBe('pending');
  });
  it('ส่งซ้ำได้ทุก 60 วินาที', async () => {
    await id.forgotPassword('cool@x.co', client);
    const r = await id.forgotPassword('cool@x.co', client);
    expect(r.resendInS).toBeGreaterThan(0);
    expect(r.resendInS).toBeLessThanOrEqual(60);
  });
});

describe('บริษัท · คำเชิญ · สิทธิ์ (ScreenCompanyCreate / ScreenInviteAccept / ScreenUsers)', () => {
  let owner: Awaited<ReturnType<typeof onboard>>;
  let companyId = '';
  let orgId = '';
  beforeAll(async () => {
    owner = await onboard('owner@x.co');
  });

  it('เลขผู้เสียภาษีตรวจ checksum', () => {
    expect(validTaxId('0105536044442')).toBe(true);
    expect(validTaxId('0105536044443')).toBe(false);
    expect(validTaxId('12345')).toBe(false);
  });
  it('สร้างบริษัทแรก → องค์กร + trial Business 30 วัน + Owner + ผังบัญชี/งวด (ไม่มีคู่ค้าตัวอย่าง) · ค้างที่ขั้น 3 ยอดยกมา', async () => {
    const r = await orgs.createCompany(owner.userId, { nameTh: 'หจก. ทดสอบ', taxId: '0105536044442', goLive: '2027-01-01', template: 'service', modules: { core: true } });
    companyId = r.id;
    expect(r.fiscalYear).toBe(2570);
    const list = await orgs.companiesOf(owner.userId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name_th: 'หจก. ทดสอบ', company_role: 'owner', setup_step: 3, setup_done: false, plan_code: 'business', company_limit: 3, seat_limit: 10, org_role: 'owner' });
    orgId = list[0]!.org_id;
    const n = await db.withCompany(companyId, async (tx) => ({
      accounts: (await tx.selectFrom('acct.account').select('code').execute()).length, contacts: (await tx.selectFrom('acct.contact').select('id').execute()).length,
      p0: await tx.selectFrom('acct.period').select('starts_on').where('period_no', '=', 0).executeTakeFirst() }));
    expect(n.accounts).toBeGreaterThan(0);
    expect(n.contacts).toBe(0);
    expect(n.p0?.starts_on).toBe('2026-12-31');
    await expect(orgs.createCompany(owner.userId, { nameTh: 'x', taxId: '0105536044443', goLive: '2027-01-01', template: 'service', modules: {} })).rejects.toThrow(/checksum/u);
    await expect(orgs.createCompany(owner.userId, { nameTh: 'x', goLive: '2027-01-01', template: 'trading', modules: {} })).rejects.toThrow(/ยังไม่พร้อม/u);
  });
  it('เชิญ → ผู้ไม่มีบัญชี: info บอกให้สมัคร → สมัคร → รับคำเชิญ → เห็นบริษัท · ใช้ซ้ำไม่ได้', async () => {
    const inv = await orgs.invite(owner.userId, { orgId, companyId, email: 'New.Staff@x.co', role: 'accountant' });
    const anon = await orgs.inviteInfo(inv.token, null);
    expect(anon).toMatchObject({ status: 'ok', email: 'new.staff@x.co', roleLabel: 'Accountant', hasAccount: false, emailMatches: null, companyName: 'หจก. ทดสอบ' });
    const staff = await onboard('new.staff@x.co');
    const wrong = await onboard('other@x.co');
    await expect(orgs.acceptInvite({ userId: wrong.userId, email: 'other@x.co' }, inv.token)).rejects.toMatchObject({ status: 403 });
    expect((await orgs.acceptInvite({ userId: staff.userId, email: 'new.staff@x.co' }, inv.token)).companyId).toBe(companyId);
    await expect(orgs.acceptInvite({ userId: staff.userId, email: 'new.staff@x.co' }, inv.token)).rejects.toMatchObject({ status: 410 });
    expect((await orgs.companiesOf(staff.userId)).map((c) => c.company_role)).toEqual(['accountant']);
    expect(await orgs.membership(wrong.userId, companyId)).toBeNull();
    expect(await lastOutbox('owner@x.co', 'invite_accepted')).toBeDefined();
  });
  it('คำเชิญหมดอายุ 7 วัน · ปฏิเสธได้ · ผู้ไม่มีสิทธิ์เชิญไม่ได้', async () => {
    const a = await orgs.invite(owner.userId, { orgId, companyId, email: 'late@x.co', role: 'viewer' });
    clock += 8 * 86_400_000;
    expect((await orgs.inviteInfo(a.token, null)).status).toBe('expired');
    const b = await orgs.invite(owner.userId, { orgId, companyId, email: 'no@x.co', role: 'viewer' });
    const no = await onboard('no@x.co');
    await orgs.declineInvite({ userId: no.userId, email: 'no@x.co' }, b.token);
    expect((await orgs.inviteInfo(b.token, null)).status).toBe('declined');
    const staffId = (await sql<{ id: string }>("select id from public.app_user where email = 'new.staff@x.co'"))[0]!.id;
    await expect(orgs.invite(staffId, { orgId, companyId, email: 'z@x.co', role: 'viewer' })).rejects.toMatchObject({ status: 403 });
    await expect(orgs.invite(owner.userId, { orgId, companyId, email: 'z@x.co', role: 'owner' })).rejects.toMatchObject({ status: 422 });
  });
  it('ผู้สอบบัญชี = Guest ไม่นับที่นั่ง · มีวันหมดอายุ', async () => {
    const a = await orgs.invite(owner.userId, { orgId, companyId, email: 'auditor@x.co', role: 'auditor', accessUntil: '2027-03-31' });
    const au = await onboard('auditor@x.co');
    await orgs.acceptInvite({ userId: au.userId, email: 'auditor@x.co' }, a.token);
    const ov = await orgs.orgOverview(owner.userId, orgId);
    expect(ov.members.find((m) => m.email === 'auditor@x.co')?.org_role).toBe('guest');
    expect(ov.seats.used).toBe(2); // owner + new.staff (auditor ไม่นับ)
    await expect(orgs.orgOverview(au.userId, orgId)).rejects.toMatchObject({ status: 403 });
    clock = Date.parse('2027-04-02T00:00:00Z');
    expect(await orgs.membership(au.userId, companyId)).toBeNull();
  });
  it('แก้สิทธิ์รายคน (ScreenUserEdit) · Accountant แก้ผู้ใช้ไม่ได้ · ถอด Owner ไม่ได้', async () => {
    const staffId = (await sql<{ id: string }>("select id from public.app_user where email = 'new.staff@x.co'"))[0]!.id;
    await orgs.updateCompanyUser(owner.userId, companyId, staffId, { role: 'ar_clerk', scope: 'all', approvalLimit: '0.00', expiresAt: null, require2fa: true, permissions: { sales: { post: true } } });
    const m = await orgs.membership(staffId, companyId);
    expect(m?.role).toBe('ar_clerk');
    expect(m?.permissions.sales).toEqual({ read: true, write: true, post: true });
    await expect(orgs.updateCompanyUser(staffId, companyId, owner.userId, { role: 'viewer', scope: 'all', approvalLimit: '0', expiresAt: null, require2fa: true, permissions: null })).rejects.toMatchObject({ status: 403 });
    await expect(orgs.revokeCompanyAccess(owner.userId, companyId, owner.userId)).rejects.toThrow(/Owner/u);
    const list = await orgs.companyUsers(owner.userId, companyId);
    expect(list.users.map((u) => u.email)).toEqual(['owner@x.co', 'new.staff@x.co', 'auditor@x.co']);
    await orgs.revokeCompanyAccess(owner.userId, companyId, staffId);
    expect(await orgs.membership(staffId, companyId)).toBeNull();
  });
});

describe('บัญชีของฉัน (ScreenProfile) · องค์กร (ScreenOrgMembers)', () => {
  const sidOf = async (access: string) => (await verifyAccess(access, createLocalJWKSet({ keys: [cfg.signingKey.publicJwk] }), 'id', new Date(clock))).sid;

  it('โปรไฟล์: รหัสสำรองเหลือ · เซสชัน (ปัจจุบันก่อน) · ออกจากระบบอุปกรณ์อื่น', async () => {
    const o = await onboard('me@x.co');
    const sid = await sidOf(o.tokens.access);
    clock += 60_000;
    const p = pendingOf(await id.login({ email: 'me@x.co', password: PW }, { ip: '198.51.100.9', ua: 'Mozilla/5.0 (Windows NT 10.0) Edg/140' }, null));
    const other = sessionOf(await id.verifyMfa(p.pending, { code: totpAt(o.secret, clock) }, { ip: '198.51.100.9', ua: 'Mozilla/5.0 (Windows NT 10.0) Edg/140' }));
    const otherSid = await sidOf(other.tokens.access);
    const pr = await id.profile(o.userId, sid);
    expect(pr.user.email).toBe('me@x.co');
    expect(pr.backupCodes).toEqual({ left: 10, issued: 10 });
    expect(pr.passwordChangedAt).not.toBeNull();
    expect(pr.sessions.map((s) => s.current)).toEqual([true, false]);
    await expect(id.revokeSession(o.userId, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
    await id.revokeSession(o.userId, otherSid);
    expect(await id.isSessionActive(otherSid)).toBe(false);
    expect((await id.profile(o.userId, sid)).sessions).toHaveLength(1);
    const o2 = sessionOf(await id.verifyMfa(pendingOf(await id.login({ email: 'me@x.co', password: PW }, client, null)).pending, { backupCode: o.backupCodes[0]! }, client));
    await id.revokeOtherSessions(o.userId, sid);
    expect(await id.isSessionActive(await sidOf(o2.tokens.access))).toBe(false);
    expect(await id.isSessionActive(sid)).toBe(true);
    expect((await id.profile(o.userId, sid)).backupCodes.left).toBe(9);
  });
  it('รหัสสำรองใหม่: ชุดเดิมใช้ไม่ได้ · แก้ชื่อ/ภาษา', async () => {
    const o = await onboard('codes@x.co');
    const fresh = await id.regenerateBackupCodes(o.userId);
    expect(fresh).toHaveLength(10);
    const p = pendingOf(await id.login({ email: 'codes@x.co', password: PW }, client, null));
    await expect(id.verifyMfa(p.pending, { backupCode: o.backupCodes[0]! }, client)).rejects.toMatchObject({ status: 401 });
    sessionOf(await id.verifyMfa(p.pending, { backupCode: fresh[0]! }, client));
    await expect(id.updateProfile(o.userId, { displayName: '  ', locale: 'th' })).rejects.toMatchObject({ status: 422 });
    await id.updateProfile(o.userId, { displayName: 'ชื่อ ใหม่', locale: 'en' });
    expect((await id.profile(o.userId, 'x')).user).toMatchObject({ display_name: 'ชื่อ ใหม่', locale: 'en' });
    pendingOf(await id.signup({ name: 'ไม่มี 2FA', email: 'nomfa@x.co', password: PW, acceptTerms: true }, client));
    const nomfa = (await sql<{ user_id: string }>("select id as user_id from public.app_user where email = 'nomfa@x.co'"))[0]!.user_id;
    await expect(id.regenerateBackupCodes(nomfa)).rejects.toMatchObject({ status: 409 });
  });
  it('องค์กรของฉัน · บริษัทที่บังคับ 2FA · บันทึกการเข้าสู่ระบบเฉพาะ Owner/Admin', async () => {
    const o = await onboard('org.owner@x.co');
    expect(await id.requiringCompany(o.userId)).toBeNull();
    const c = await orgs.createCompany(o.userId, { nameTh: 'บริษัท ทดสอบ จำกัด', goLive: '2027-01-01', template: 'service', modules: {} });
    expect(await id.requiringCompany(o.userId)).toBe('บริษัท ทดสอบ จำกัด');
    const mine = await orgs.myOrgs(o.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ org_role: 'owner', companies: [{ id: c.id, name: 'บริษัท ทดสอบ จำกัด', role: 'owner' }] });
    const ev = await orgs.loginEvents(o.userId, mine[0]!.id);
    expect(ev.map((e) => e.event)).toContain('mfa_enabled');
    expect(ev.every((e) => e.email === 'org.owner@x.co')).toBe(true);
    const ov = await orgs.orgOverview(o.userId, mine[0]!.id);
    expect(ov.subscription).toMatchObject({ plan: 'business', planName: 'Business', companyLimit: 3, seatLimit: 10 });
    const stranger = await onboard('stranger@x.co');
    await expect(orgs.loginEvents(stranger.userId, mine[0]!.id)).rejects.toMatchObject({ status: 403 });
    const inv = await orgs.invite(o.userId, { orgId: mine[0]!.id, companyId: c.id, email: 'invitee@x.co', role: 'accountant' });
    expect(await orgs.inviteInfo(inv.token, null)).toMatchObject({ planName: 'Business', companyName: 'บริษัท ทดสอบ จำกัด' });
  });
});

it('ตั้ง 2FA ได้ด้วยคีย์ที่สร้างเอง (ตรวจ helper)', () => { expect(generateSecret()).toHaveLength(32); });
