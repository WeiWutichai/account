// Innovera ID — ขั้นตอนยืนยันตัวตน (docs/technical-plan-M3.md §2)
// ไม่พึ่ง HTTP: controller แปลง cookie/IP/UA เป็นอาร์กิวเมนต์ · test เรียกตรงได้
import {
  ACCESS_TTL_S, bindingOf, checkPassword, decrypt, encrypt, formatSecret, generateBackupCodes, generateSecret, hashBackupCode, hashPassword, HISTORY, ISSUE_TEXT,
  matchBackupCode, needsRehash, numericCode, otpauthUri, randomToken, sha256, sign, signAccess, unsign, verifyPassword, verifyTotp,
} from '@innovera/auth';
import type { Db } from '@innovera/db';
import { randomUUID } from 'node:crypto';
import type { IdConfig } from './config.ts';
import type { Limiter } from './limiter.ts';

/** ข้อผิดพลาดที่แสดงผู้ใช้ได้ (ข้อความไทย) · status ตาม HTTP */
export class IdError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 423 | 429, message: string, public readonly code?: string) { super(message); }
}

export interface ClientInfo { ip: string; ua: string }
/** ผลที่ controller ต้องตั้ง cookie ให้ */
export interface Tokens { access: string; refresh: string; refreshExpires: Date; amr: string[] }
export type PendingStage = 'verify' | 'mfa' | 'setup';
export type LoginResult =
  | { kind: 'session'; tokens: Tokens; trustedDevice?: string }
  | { kind: 'pending'; stage: PendingStage; pending: string; email: string };

// ค่าตามแบบร่าง
export const LIMITS = {
  passwordFailsPerAccount: 10, passwordFailsPerIp: 50, passwordWindowS: 15 * 60,  // ล็อก 15 นาที
  mfaFails: 5, mfaWindowS: 15 * 60,                                               // ScreenTwoFactor: "ผิดได้ 5 ครั้งแล้วล็อก 15 นาที"
  pendingTtlMs: 5 * 60_000,
  trustedDeviceDays: 30,                                                          // "เชื่อถืออุปกรณ์นี้ 30 วัน"
  verifyCodeTtlMs: 15 * 60_000, verifyCodeAttempts: 5,
  resetTtlMs: 30 * 60_000,                                                        // ScreenPasswordReset: "หมดอายุใน 30 นาที ใช้ได้ครั้งเดียว"
  resendCooldownS: 60,
  defaultSessionHours: 12,                                                        // "เซสชัน 12 ชม."
} as const;

export class Identity {
  constructor(private readonly db: Db, private readonly limiter: Limiter, private readonly cfg: IdConfig) {}

  private now(): Date { return this.cfg.now(); }

  // ---------- สมัคร + ยืนยันอีเมล ----------

  async signup(input: { name: string; email: string; password: string; acceptTerms: boolean; marketing?: boolean; inviteToken?: string }, client: ClientInfo): Promise<LoginResult> {
    const email = normEmail(input.email);
    const name = input.name.trim();
    if (!name) throw new IdError(422, 'กรุณากรอกชื่อ-นามสกุล');
    if (!isEmail(email)) throw new IdError(422, 'อีเมลไม่ถูกต้อง');
    if (!input.acceptTerms) throw new IdError(422, 'ต้องยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว');
    const issues = await checkPassword(input.password, { email });
    if (issues.length) throw new IdError(422, issues.map((i) => ISSUE_TEXT[i]).join(' · '), 'password_policy');
    const passwordHash = await hashPassword(input.password);
    const existing = await this.db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'email_verified_at']).where('email', '=', email).executeTakeFirst());
    if (existing) {
      // ไม่บอกว่ามีบัญชีแล้ว (กันเดาบัญชี) — แจ้งเจ้าของอีเมลแทน และตอบแบบเดียวกับสมัครใหม่
      await this.db.withPublic((tx) => tx.insertInto('public.outbox_email').values({ to_email: email, template: 'signup_existing', payload: '{}' }).execute());
      return { kind: 'pending', stage: 'verify', pending: this.pending(randomUUID(), 'verify', client), email };
    }
    const id = await this.db.withPublic(async (tx) => {
      const u = await tx.insertInto('public.app_user').values({
        email, display_name: name, password_hash: passwordHash, marketing_opt_in: input.marketing ?? false, terms_accepted_at: this.now(),
      }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('public.password_history').values({ user_id: u.id, password_hash: passwordHash }).execute();
      return u.id;
    });
    await this.sendVerifyCode(id, email);
    return { kind: 'pending', stage: 'verify', pending: this.pending(id, 'verify', client), email };
  }

  private async sendVerifyCode(userId: string, email: string): Promise<void> {
    const code = numericCode();
    await this.db.withPublic(async (tx) => {
      await tx.updateTable('public.email_token').set({ used_at: this.now() }).where('user_id', '=', userId).where('purpose', '=', 'verify_email').where('used_at', 'is', null).execute();
      await tx.insertInto('public.email_token').values({ user_id: userId, purpose: 'verify_email', token_hash: sha256(`${userId}:${code}`), expires_at: new Date(this.now().getTime() + LIMITS.verifyCodeTtlMs) }).execute();
      await tx.insertInto('public.outbox_email').values({ to_email: email, template: 'verify_email', payload: JSON.stringify({ code }) }).execute();
    });
  }

  async resendVerifyCode(pending: string, client: ClientInfo): Promise<void> {
    const p = this.readPending(pending, client, 'verify');
    if (!(await this.limiter.once(`resend:verify:${p.userId}`, LIMITS.resendCooldownS))) throw new IdError(429, 'ส่งรหัสใหม่ได้อีกครั้งในอีกสักครู่');
    const u = await this.userById(p.userId);
    if (u && !u.email_verified_at) await this.sendVerifyCode(u.id, u.email);
  }

  async verifyEmail(pending: string, code: string, client: ClientInfo): Promise<LoginResult> {
    const p = this.readPending(pending, client, 'verify');
    const tok = await this.db.withPublic((tx) => tx.selectFrom('public.email_token').selectAll().where('user_id', '=', p.userId).where('purpose', '=', 'verify_email')
      .where('used_at', 'is', null).orderBy('created_at', 'desc').executeTakeFirst());
    if (!tok || tok.expires_at.getTime() < this.now().getTime() || tok.attempts >= LIMITS.verifyCodeAttempts) throw new IdError(410, 'รหัสยืนยันหมดอายุ — ขอรหัสใหม่');
    if (tok.token_hash !== sha256(`${p.userId}:${code.trim()}`)) {
      await this.db.withPublic((tx) => tx.updateTable('public.email_token').set((eb) => ({ attempts: eb('attempts', '+', 1) })).where('id', '=', tok.id).execute());
      throw new IdError(422, 'รหัสยืนยันไม่ถูกต้อง');
    }
    await this.db.withPublic(async (tx) => {
      await tx.updateTable('public.email_token').set({ used_at: this.now() }).where('id', '=', tok.id).execute();
      await tx.updateTable('public.app_user').set({ email_verified_at: this.now() }).where('id', '=', p.userId).execute();
    });
    return this.afterPassword(p.userId, client, null);
  }

  // ---------- เข้าสู่ระบบ ----------

  async login(input: { email: string; password: string }, client: ClientInfo, trustedDevice: string | null): Promise<LoginResult> {
    const email = normEmail(input.email);
    const accKey = `pw:acc:${email}`;
    const ipKey = `pw:ip:${sha256(client.ip).slice(0, 16)}`;
    if ((await this.limiter.count(accKey)) >= LIMITS.passwordFailsPerAccount || (await this.limiter.count(ipKey)) >= LIMITS.passwordFailsPerIp) {
      await this.event(null, email, 'locked', client);
      throw new IdError(423, `ล็อกชั่วคราว ${Math.ceil((await this.limiter.ttl(accKey)) / 60) || 15} นาที เพราะใส่รหัสผ่านผิดหลายครั้ง`);
    }
    const u = await this.db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'password_hash', 'status']).where('email', '=', email).executeTakeFirst());
    // ตรวจ hash เสมอแม้ไม่มีผู้ใช้ (เวลาตอบใกล้เคียงกัน)
    const ok = await verifyPassword(u?.password_hash ?? DUMMY_HASH, input.password);
    if (!u || !ok || u.status !== 'active') {
      await this.limiter.hit(accKey, LIMITS.passwordWindowS);
      await this.limiter.hit(ipKey, LIMITS.passwordWindowS);
      await this.event(u?.id ?? null, email, 'login_fail', client);
      throw new IdError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }
    await this.limiter.reset(accKey);
    if (u.password_hash && needsRehash(u.password_hash)) {
      const h = await hashPassword(input.password);
      await this.db.withPublic((tx) => tx.updateTable('public.app_user').set({ password_hash: h }).where('id', '=', u.id).execute());
    }
    await this.event(u.id, email, 'login_ok', client);
    return this.afterPassword(u.id, client, trustedDevice);
  }

  /** หลังรหัสผ่าน/ยืนยันอีเมลผ่าน: ต้องยืนยันอีเมล → 2FA (ยืนยัน หรือ ตั้งค่าครั้งแรก) → session */
  private async afterPassword(userId: string, client: ClientInfo, trustedDevice: string | null): Promise<LoginResult> {
    const u = await this.userById(userId);
    if (!u) throw new IdError(401, 'ไม่พบบัญชี');
    if (!u.email_verified_at) {
      await this.sendVerifyCode(u.id, u.email);
      return { kind: 'pending', stage: 'verify', pending: this.pending(u.id, 'verify', client), email: u.email };
    }
    if (u.mfa_enabled) {
      if (trustedDevice && (await this.isTrusted(u.id, trustedDevice))) return { kind: 'session', tokens: await this.issue(u.id, u.email, ['pwd', 'trusted_device'], client) };
      return { kind: 'pending', stage: 'mfa', pending: this.pending(u.id, 'mfa', client), email: u.email };
    }
    if (await this.requires2fa(u.id)) return { kind: 'pending', stage: 'setup', pending: this.pending(u.id, 'setup', client), email: u.email };
    return { kind: 'session', tokens: await this.issue(u.id, u.email, ['pwd'], client) };
  }

  /** นโยบาย: ผู้ใช้ที่ยังไม่มีองค์กร หรืออยู่ในองค์กรที่บังคับ 2FA → ต้องตั้ง 2FA (ScreenTwoFactor "บังคับใช้ 2FA ทุกผู้ใช้") */
  async requires2fa(userId: string): Promise<boolean> {
    const orgs = await this.db.withPublic((tx) => tx.selectFrom('public.org_membership as m').innerJoin('public.organization as o', 'o.id', 'm.org_id')
      .select('o.security_policy').where('m.user_id', '=', userId).execute());
    if (orgs.length === 0 || orgs.some((o) => o.security_policy.require_2fa)) return true;
    return (await this.enforcing2faCompanies(userId)).length > 0;
  }
  /** บริษัท (ที่ผู้ใช้เป็นสมาชิก) ที่ตั้ง "บังคับ 2FA ทุกผู้ใช้" ในหน้าตั้งค่าบริษัท (acct.company_setting company.defaults.enforce2fa) — อ่านผ่าน withCompany (RLS) */
  async enforcing2faCompanies(userId: string): Promise<{ id: string; name_th: string }[]> {
    const cs = await this.db.withPublic((tx) => tx.selectFrom('public.company_membership as cm').innerJoin('public.company as c', 'c.id', 'cm.company_id')
      .select(['c.id', 'c.name_th']).where('cm.user_id', '=', userId).where('c.status', '=', 'active').orderBy('c.created_at').execute());
    const out = [];
    for (const c of cs) {
      const s = await this.db.withCompany(c.id, (tx) => tx.selectFrom('acct.company_setting').select('value').where('key', '=', 'company.defaults').executeTakeFirst());
      if ((s?.value as { enforce2fa?: unknown } | undefined)?.enforce2fa === true) out.push(c);
    }
    return out;
  }

  // ---------- 2FA ----------

  async verifyMfa(pending: string, input: { code?: string; backupCode?: string; trust?: boolean }, client: ClientInfo): Promise<LoginResult & { kind: 'session' }> {
    const p = this.readPending(pending, client, 'mfa');
    const key = `mfa:${p.userId}`;
    if ((await this.limiter.count(key)) >= LIMITS.mfaFails) throw new IdError(423, 'ใส่รหัสผิด 5 ครั้ง — ล็อก 15 นาที');
    const u = await this.db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'email', 'totp_secret_enc', 'totp_last_step']).where('id', '=', p.userId).executeTakeFirstOrThrow());
    let amr: string[] | null = null;
    if (input.code && u.totp_secret_enc) {
      const step = verifyTotp(decrypt(u.totp_secret_enc, this.cfg.dataKey), input.code, this.now().getTime(), u.totp_last_step === null ? null : Number(u.totp_last_step));
      if (step !== null) {
        await this.db.withPublic((tx) => tx.updateTable('public.app_user').set({ totp_last_step: step }).where('id', '=', u.id).execute());
        amr = ['pwd', 'otp'];
      }
    } else if (input.backupCode) {
      const rows = await this.db.withPublic((tx) => tx.selectFrom('public.backup_code').select(['idx', 'code_hash']).where('user_id', '=', u.id).orderBy('idx').execute());
      const i = await matchBackupCode(input.backupCode, rows.map((r) => r.code_hash));
      if (i >= 0) {
        await this.db.withPublic((tx) => tx.updateTable('public.backup_code').set({ code_hash: null, used_at: this.now() }).where('user_id', '=', u.id).where('idx', '=', rows[i]!.idx).execute());
        await this.event(u.id, u.email, 'backup_code_used', client);
        amr = ['pwd', 'backup_code'];
      }
    }
    if (!amr) {
      const n = await this.limiter.hit(key, LIMITS.mfaWindowS);
      await this.event(u.id, u.email, 'mfa_fail', client);
      throw new IdError(n >= LIMITS.mfaFails ? 423 : 401, n >= LIMITS.mfaFails ? 'ใส่รหัสผิด 5 ครั้ง — ล็อก 15 นาที' : 'รหัสไม่ถูกต้อง');
    }
    await this.limiter.reset(key);
    await this.event(u.id, u.email, 'mfa_ok', client);
    const tokens = await this.issue(u.id, u.email, amr, client);
    return { kind: 'session', tokens, ...(input.trust ? { trustedDevice: await this.trustDevice(u.id, client) } : {}) };
  }

  /** เริ่มตั้ง 2FA: ได้คีย์ + otpauth URI (QR) · ยังไม่เปิดจนกว่าจะยืนยันรหัส */
  async startMfaSetup(who: { pending: string; client: ClientInfo } | { userId: string }): Promise<{ secret: string; secretFormatted: string; uri: string; account: string }> {
    const userId = 'userId' in who ? who.userId : this.readPending(who.pending, who.client, 'setup').userId;
    const u = await this.userById(userId);
    if (!u) throw new IdError(401, 'ไม่พบบัญชี');
    if (u.mfa_enabled) throw new IdError(409, 'เปิด 2FA อยู่แล้ว');
    const secret = generateSecret();
    await this.db.withPublic((tx) => tx.updateTable('public.app_user').set({ totp_secret_enc: encrypt(secret, this.cfg.dataKey), totp_last_step: null }).where('id', '=', userId).execute());
    return { secret, secretFormatted: formatSecret(secret), uri: otpauthUri(secret, u.email), account: u.email };
  }

  /** ยืนยันรหัสแรก → เปิด 2FA + รหัสสำรอง 10 ชุด (แสดงครั้งเดียว) · ถ้ามาจากขั้นเข้าสู่ระบบ ได้ session ด้วย */
  async enableMfa(who: { pending: string; client: ClientInfo } | { userId: string }, code: string): Promise<{ backupCodes: string[]; tokens?: Tokens }> {
    const fromPending = !('userId' in who);
    const userId = 'userId' in who ? who.userId : this.readPending(who.pending, who.client, 'setup').userId;
    const u = await this.db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'email', 'mfa_enabled', 'totp_secret_enc']).where('id', '=', userId).executeTakeFirstOrThrow());
    if (u.mfa_enabled) throw new IdError(409, 'เปิด 2FA อยู่แล้ว');
    if (!u.totp_secret_enc) throw new IdError(422, 'ยังไม่ได้เริ่มตั้งค่า 2FA');
    const step = verifyTotp(decrypt(u.totp_secret_enc, this.cfg.dataKey), code, this.now().getTime());
    if (step === null) throw new IdError(422, 'รหัสไม่ถูกต้อง — ตรวจเวลาในโทรศัพท์แล้วลองใหม่');
    const backupCodes = generateBackupCodes();
    const hashes = await Promise.all(backupCodes.map(hashBackupCode));
    await this.db.withPublic(async (tx) => {
      await tx.updateTable('public.app_user').set({ mfa_enabled: true, totp_last_step: step }).where('id', '=', userId).execute();
      await tx.deleteFrom('public.backup_code').where('user_id', '=', userId).execute();
      await tx.insertInto('public.backup_code').values(hashes.map((h, idx) => ({ user_id: userId, idx, code_hash: h, used_at: null }))).execute();
    });
    await this.event(userId, u.email, 'mfa_enabled', 'userId' in who ? null : who.client);
    if (fromPending) return { backupCodes, tokens: await this.issue(userId, u.email, ['pwd', 'otp'], (who as { client: ClientInfo }).client) };
    return { backupCodes };
  }

  private async trustDevice(userId: string, client: ClientInfo): Promise<string> {
    const d = await this.db.withPublic((tx) => tx.insertInto('public.trusted_device').values({ user_id: userId, label: client.ua.slice(0, 120), expires_at: new Date(this.now().getTime() + LIMITS.trustedDeviceDays * 86_400_000) })
      .returning('id').executeTakeFirstOrThrow());
    return sign(`${userId}|${d.id}`, this.cfg.cookieKey);
  }
  private async isTrusted(userId: string, cookie: string): Promise<boolean> {
    const v = unsign(cookie, this.cfg.cookieKey);
    const [uid, id] = v?.split('|') ?? [];
    if (uid !== userId || !id) return false;
    const d = await this.db.withPublic((tx) => tx.selectFrom('public.trusted_device').select(['expires_at', 'revoked_at']).where('id', '=', id).where('user_id', '=', userId).executeTakeFirst());
    return !!d && !d.revoked_at && d.expires_at.getTime() > this.now().getTime();
  }

  // ---------- session (access JWT + refresh หมุน) ----------

  private async issue(userId: string, email: string, amr: string[], client: ClientInfo, family?: { id: string; expires: Date }): Promise<Tokens> {
    const familyId = family?.id ?? randomUUID();
    const expires = family?.expires ?? new Date(this.now().getTime() + (await this.sessionHours(userId)) * 3_600_000);
    const refresh = randomToken();
    const row = await this.db.withPublic(async (tx) => {
      if (!family) await tx.updateTable('public.app_user').set({ last_login_at: this.now() }).where('id', '=', userId).execute();
      return tx.insertInto('public.auth_session').values({ family_id: familyId, user_id: userId, token_hash: sha256(refresh), amr, ip_hash: sha256(client.ip).slice(0, 16), user_agent: client.ua.slice(0, 300), expires_at: expires })
        .returning('id').executeTakeFirstOrThrow();
    });
    const access = await signAccess(this.cfg.signingKey, { sub: userId, sid: familyId, amr, email }, this.cfg.audience, Math.floor(this.now().getTime() / 1000));
    void row;
    return { access, refresh, refreshExpires: expires, amr };
  }

  private async sessionHours(userId: string): Promise<number> {
    const orgs = await this.db.withPublic((tx) => tx.selectFrom('public.org_membership as m').innerJoin('public.organization as o', 'o.id', 'm.org_id').select('o.security_policy').where('m.user_id', '=', userId).execute());
    return Math.min(LIMITS.defaultSessionHours, ...orgs.map((o) => o.security_policy.session_hours ?? LIMITS.defaultSessionHours));
  }

  /** หมุน refresh token · ใช้ token ที่หมุนไปแล้วซ้ำ = ถูกขโมย → เพิกถอนทั้ง family */
  async refresh(refresh: string, client: ClientInfo): Promise<Tokens> {
    const s = await this.db.withPublic((tx) => tx.selectFrom('public.auth_session as s').innerJoin('public.app_user as u', 'u.id', 's.user_id')
      .select(['s.id', 's.family_id', 's.user_id', 's.amr', 's.expires_at', 's.rotated_at', 's.revoked_at', 'u.email', 'u.status']).where('s.token_hash', '=', sha256(refresh)).executeTakeFirst());
    if (!s) throw new IdError(401, 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
    if (s.rotated_at || s.revoked_at) {
      if (s.rotated_at && !s.revoked_at) {
        await this.revokeFamily(s.family_id, 'refresh_reuse');
        await this.event(s.user_id, s.email, 'refresh_reuse', client);
      }
      throw new IdError(401, 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
    }
    if (s.expires_at.getTime() <= this.now().getTime() || s.status !== 'active') throw new IdError(401, 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
    // หมุนแบบ atomic: แถวเดิมต้องยังไม่ถูกหมุน (กัน request ซ้อน)
    const upd = await this.db.withPublic((tx) => tx.updateTable('public.auth_session').set({ rotated_at: this.now() }).where('id', '=', s.id).where('rotated_at', 'is', null).executeTakeFirst());
    if (Number(upd.numUpdatedRows) !== 1) throw new IdError(401, 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
    return this.issue(s.user_id, s.email, s.amr, client, { id: s.family_id, expires: s.expires_at });
  }

  async logout(refresh: string | null, client: ClientInfo): Promise<void> {
    if (!refresh) return;
    const s = await this.db.withPublic((tx) => tx.selectFrom('public.auth_session as s').innerJoin('public.app_user as u', 'u.id', 's.user_id').select(['s.family_id', 's.user_id', 'u.email'])
      .where('s.token_hash', '=', sha256(refresh)).executeTakeFirst());
    if (!s) return;
    await this.revokeFamily(s.family_id, 'logout');
    await this.event(s.user_id, s.email, 'logout', client);
  }
  async isSessionActive(familyId: string): Promise<boolean> {
    const r = await this.db.withPublic((tx) => tx.selectFrom('public.auth_session').select('id').where('family_id', '=', familyId).where('revoked_at', 'is', null)
      .where('expires_at', '>', this.now()).executeTakeFirst());
    return !!r;
  }
  private revokeFamily(familyId: string, reason: string) {
    return this.db.withPublic((tx) => tx.updateTable('public.auth_session').set({ revoked_at: this.now(), revoke_reason: reason }).where('family_id', '=', familyId).where('revoked_at', 'is', null).execute());
  }
  private revokeAllExcept(userId: string, keepFamily: string | null, reason: string) {
    return this.db.withPublic((tx) => {
      let q = tx.updateTable('public.auth_session').set({ revoked_at: this.now(), revoke_reason: reason }).where('user_id', '=', userId).where('revoked_at', 'is', null);
      if (keepFamily) q = q.where('family_id', '<>', keepFamily);
      return q.execute();
    });
  }

  // ---------- ลืมรหัสผ่าน (ScreenPasswordReset) ----------

  /** ตอบเหมือนกันเสมอไม่ว่ามีบัญชีหรือไม่ · ส่งซ้ำได้ทุก 60 วินาที */
  async forgotPassword(emailIn: string, client: ClientInfo): Promise<{ resendInS: number }> {
    const email = normEmail(emailIn);
    if (!(await this.limiter.once(`resend:reset:${email}`, LIMITS.resendCooldownS))) return { resendInS: await this.limiter.ttl(`resend:reset:${email}`) };
    const u = await this.db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'email']).where('email', '=', email).where('status', '=', 'active').executeTakeFirst());
    if (u) {
      const token = randomToken();
      await this.db.withPublic(async (tx) => {
        await tx.updateTable('public.email_token').set({ used_at: this.now() }).where('user_id', '=', u.id).where('purpose', '=', 'reset_password').where('used_at', 'is', null).execute();
        await tx.insertInto('public.email_token').values({ user_id: u.id, purpose: 'reset_password', token_hash: sha256(token), expires_at: new Date(this.now().getTime() + LIMITS.resetTtlMs) }).execute();
        await tx.insertInto('public.outbox_email').values({ to_email: u.email, template: 'reset_password', payload: JSON.stringify({ token }) }).execute();
      });
      await this.event(u.id, u.email, 'password_reset_requested', client);
    }
    return { resendInS: LIMITS.resendCooldownS };
  }

  async resetPassword(input: { token: string; password: string; confirm: string; logoutOthers: boolean }, client: ClientInfo): Promise<LoginResult> {
    const tok = await this.db.withPublic((tx) => tx.selectFrom('public.email_token as t').innerJoin('public.app_user as u', 'u.id', 't.user_id')
      .select(['t.id', 't.user_id', 't.expires_at', 't.used_at', 'u.email']).where('t.token_hash', '=', sha256(input.token)).where('t.purpose', '=', 'reset_password').executeTakeFirst());
    if (!tok || tok.used_at || tok.expires_at.getTime() < this.now().getTime()) throw new IdError(410, 'ลิงก์หมดอายุหรือถูกใช้แล้ว — ขอลิงก์ใหม่');
    const history = await this.db.withPublic((tx) => tx.selectFrom('public.password_history').select('password_hash').where('user_id', '=', tok.user_id).orderBy('created_at', 'desc').limit(HISTORY).execute());
    const issues = await checkPassword(input.password, { email: tok.email, confirm: input.confirm, history: history.map((h) => h.password_hash) });
    if (issues.length) throw new IdError(422, issues.map((i) => ISSUE_TEXT[i]).join(' · '), 'password_policy');
    const h = await hashPassword(input.password);
    await this.db.withPublic(async (tx) => {
      await tx.updateTable('public.email_token').set({ used_at: this.now() }).where('id', '=', tok.id).execute();
      await tx.updateTable('public.app_user').set({ password_hash: h, email_verified_at: this.now() }).where('id', '=', tok.user_id).execute();
      await tx.insertInto('public.password_history').values({ user_id: tok.user_id, password_hash: h }).execute();
      await tx.insertInto('public.outbox_email').values({ to_email: tok.email, template: 'password_changed', payload: '{}' }).execute(); // "ระบบแจ้งเจ้าของบัญชีทุกครั้ง"
    });
    if (input.logoutOthers) await this.revokeAllExcept(tok.user_id, null, 'password_reset');
    await this.limiter.reset(`pw:acc:${tok.email}`);
    await this.event(tok.user_id, tok.email, 'password_reset', client);
    // "หลังตั้งใหม่ระบบจะขอรหัส 2FA ตามปกติ"
    return this.afterPassword(tok.user_id, client, null);
  }

  // ---------- pending cookie (หลังรหัสผ่าน ก่อน 2FA) ผูก IP/UA · อายุ 5 นาที ----------

  pending(userId: string, stage: PendingStage, client: ClientInfo): string {
    return sign(`${userId}|${stage}|${bindingOf(client.ip, client.ua)}|${this.now().getTime() + LIMITS.pendingTtlMs}`, this.cfg.cookieKey);
  }
  readPending(cookie: string | null | undefined, client: ClientInfo, stage: PendingStage): { userId: string } {
    const v = cookie ? unsign(cookie, this.cfg.cookieKey) : null;
    const [userId, st, bind, exp] = v?.split('|') ?? [];
    if (!userId || st !== stage || bind !== bindingOf(client.ip, client.ua) || Number(exp) < this.now().getTime()) throw new IdError(401, 'ขั้นตอนหมดเวลา — กรุณาเข้าสู่ระบบใหม่', 'pending_expired');
    return { userId };
  }
  /** อีเมลแบบย่อสำหรับหน้า 2FA ("wei@innovera…") */
  async pendingEmail(cookie: string | null | undefined, client: ClientInfo, stage: PendingStage): Promise<string> {
    const { userId } = this.readPending(cookie, client, stage);
    return (await this.userById(userId))?.email ?? '';
  }

  /** ชื่อบริษัทที่บังคับ 2FA (หัวการ์ด "ตั้งค่า 2FA" ใน ScreenTwoFactor: "บริษัท [ชื่อบริษัท] บังคับใช้ 2FA ทุกผู้ใช้") · ไม่มี = null */
  async requiringCompany(userId: string): Promise<string | null> {
    const r = await this.db.withPublic((tx) => tx.selectFrom('public.company_membership as cm').innerJoin('public.company as c', 'c.id', 'cm.company_id').innerJoin('public.organization as o', 'o.id', 'c.org_id')
      .select(['c.name_th', 'o.security_policy']).where('cm.user_id', '=', userId).where('c.status', '=', 'active').orderBy('c.created_at').execute());
    return r.find((x) => x.security_policy.require_2fa)?.name_th ?? (await this.enforcing2faCompanies(userId))[0]?.name_th ?? null;
  }

  // ---------- บัญชีของฉัน (ScreenProfile) ----------

  /** ข้อมูลหน้าโปรไฟล์: ผู้ใช้ · เปลี่ยนรหัสผ่านล่าสุด · รหัสสำรองเหลือ · เซสชันที่ใช้อยู่ · อุปกรณ์ที่เชื่อถือ */
  async profile(userId: string, currentSid: string) {
    return this.db.withPublic(async (tx) => {
      const user = await tx.selectFrom('public.app_user').select(['id', 'email', 'display_name', 'email_verified_at', 'mfa_enabled', 'phone_masked', 'locale', 'created_at'])
        .where('id', '=', userId).executeTakeFirst();
      if (!user) throw new IdError(401, 'ไม่พบบัญชี');
      const pw = await tx.selectFrom('public.password_history').select('created_at').where('user_id', '=', userId).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      const codes = await tx.selectFrom('public.backup_code').select(['code_hash']).where('user_id', '=', userId).execute();
      const now = this.now();
      const sessions = await tx.selectFrom('public.auth_session').select((eb) => ['family_id', eb.fn.max('user_agent').as('user_agent'), eb.fn.min('created_at').as('started_at'), eb.fn.max('created_at').as('last_used_at')])
        .where('user_id', '=', userId).where('revoked_at', 'is', null).where('expires_at', '>', now).groupBy('family_id').execute();
      const devices = await tx.selectFrom('public.trusted_device').select(['id', 'label', 'created_at', 'expires_at']).where('user_id', '=', userId).where('revoked_at', 'is', null)
        .where('expires_at', '>', now).orderBy('created_at', 'desc').execute();
      return {
        user, passwordChangedAt: pw?.created_at ?? null,
        backupCodes: { left: codes.filter((c) => c.code_hash !== null).length, issued: codes.length },
        sessions: sessions.map((s) => ({ id: s.family_id, userAgent: s.user_agent, startedAt: s.started_at, lastUsedAt: s.last_used_at, current: s.family_id === currentSid,
          trustedUntil: devices.find((d) => d.label && d.label === s.user_agent?.slice(0, 120))?.expires_at ?? null }))
          .sort((a, b) => Number(b.current) - Number(a.current) || new Date(b.lastUsedAt as Date).getTime() - new Date(a.lastUsedAt as Date).getTime()),
        trustedDevices: devices,
      };
    });
  }

  /** แก้ชื่อ/ภาษา (ปุ่ม "บันทึกโปรไฟล์") */
  async updateProfile(userId: string, input: { displayName: string; locale: 'th' | 'en' }): Promise<void> {
    const name = (input.displayName ?? '').trim();
    if (!name) throw new IdError(422, 'กรุณากรอกชื่อ-นามสกุล');
    if (name.length > 120) throw new IdError(422, 'ชื่อยาวเกินไป');
    if (input.locale !== 'th' && input.locale !== 'en') throw new IdError(422, 'ภาษาไม่ถูกต้อง');
    await this.db.withPublic((tx) => tx.updateTable('public.app_user').set({ display_name: name, locale: input.locale }).where('id', '=', userId).execute());
  }

  /** "รหัสสำรองใหม่" — ออกชุดใหม่ 10 ชุด ชุดเดิมใช้ไม่ได้ทันที (แสดงครั้งเดียว) */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const u = await this.userById(userId);
    if (!u?.mfa_enabled) throw new IdError(409, 'ยังไม่ได้เปิด 2FA');
    const backupCodes = generateBackupCodes();
    const hashes = await Promise.all(backupCodes.map(hashBackupCode));
    await this.db.withPublic(async (tx) => {
      await tx.deleteFrom('public.backup_code').where('user_id', '=', userId).execute();
      await tx.insertInto('public.backup_code').values(hashes.map((h, idx) => ({ user_id: userId, idx, code_hash: h, used_at: null }))).execute();
    });
    return backupCodes;
  }

  /** ออกจากระบบอุปกรณ์หนึ่ง (เซสชัน = refresh family) · ต้องเป็นของตัวเอง */
  async revokeSession(userId: string, familyId: string): Promise<void> {
    const r = await this.db.withPublic((tx) => tx.updateTable('public.auth_session').set({ revoked_at: this.now(), revoke_reason: 'user_revoked' })
      .where('user_id', '=', userId).where('family_id', '=', familyId).where('revoked_at', 'is', null).executeTakeFirst());
    if (Number(r.numUpdatedRows) === 0) throw new IdError(404, 'ไม่พบเซสชัน');
  }
  /** "ออกจากระบบทุกอุปกรณ์อื่น" — เก็บเซสชันปัจจุบันไว้ */
  async revokeOtherSessions(userId: string, currentSid: string): Promise<void> {
    await this.revokeAllExcept(userId, currentSid, 'user_revoked_others');
  }

  // ---------- ช่วย ----------

  userById(id: string) {
    return this.db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'email', 'display_name', 'email_verified_at', 'mfa_enabled', 'status']).where('id', '=', id).executeTakeFirst());
  }
  private event(userId: string | null, email: string, event: string, client: ClientInfo | null) {
    return this.db.withPublic((tx) => tx.insertInto('public.login_event').values({ user_id: userId, email, event, ip_hash: client ? sha256(client.ip).slice(0, 16) : null, user_agent: client?.ua.slice(0, 300) ?? null }).execute());
  }
}

export const ACCESS_COOKIE_MAX_AGE_S = ACCESS_TTL_S;
export const normEmail = (e: string): string => e.trim().toLowerCase();
const isEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(e) && e.length <= 254;
// hash ของรหัสสุ่ม — ใช้ตรวจเมื่อไม่มีผู้ใช้ เพื่อให้เวลาตอบใกล้เคียงกัน
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI';
