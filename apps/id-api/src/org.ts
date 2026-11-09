// องค์กร · บริษัท · สมาชิก · คำเชิญ (ScreenCompanyPicker / ScreenCompanyCreate / ScreenOrgMembers / ScreenInviteAccept / ScreenUsers)
import { COMPANY_ROLES, COMPANY_ROLE_LABEL, countsSeat, effectivePermissions, randomToken, sha256, type CompanyRole, type OrgRole } from '@innovera/auth';
import type { Db } from '@innovera/db';
import { seedCompany } from '@innovera/db/seed';
import { IdError, normEmail } from './identity.ts';

export const INVITE_TTL_DAYS = 7; // ScreenInviteAccept: "ลิงก์หมดอายุ … (อีก 7 วัน)"
/** v1: ทุกองค์กรได้แผน Business แบบ trial 30 วัน (ScreenSignup กล่อง Phase 2) · ตัวเลขแผนตาม ScreenOrgMembers/ScreenCompanyCreate */
export const TRIAL = { plan: 'business', days: 30, companyLimit: 3, seatLimit: 10 } as const;

/** เลขผู้เสียภาษี 13 หลัก ตรวจ checksum (FR-TN-02) */
export function validTaxId(id: string): boolean {
  if (!/^\d{13}$/u.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export class Orgs {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  // ---------- บริษัทของผู้ใช้ (ScreenCompanyPicker) ----------

  async companiesOf(userId: string) {
    return this.db.withPublic(async (tx) => {
      const rows = await tx.selectFrom('public.company_membership as m').innerJoin('public.company as c', 'c.id', 'm.company_id').innerJoin('public.organization as o', 'o.id', 'c.org_id')
        .leftJoin('public.subscription as s', 's.org_id', 'o.id')
        .select(['c.id', 'c.name_th', 'c.branch_code', 'c.fiscal_year_start', 'c.setup_step', 'c.setup_done', 'c.created_at', 'c.status', 'o.id as org_id', 'o.name as org_name',
          'm.company_role', 'm.expires_at', 'm.last_used_at', 's.plan_code', 's.company_limit', 's.seat_limit'])
        .where('m.user_id', '=', userId).where('c.status', '=', 'active').orderBy('o.name').orderBy('c.created_at').execute();
      const today = this.now().toISOString().slice(0, 10);
      const orgRoles = await tx.selectFrom('public.org_membership').select(['org_id', 'org_role']).where('user_id', '=', userId).execute();
      return rows.filter((r) => !r.expires_at || r.expires_at >= today).map((r) => ({ ...r, org_role: orgRoles.find((o) => o.org_id === r.org_id)?.org_role ?? null }));
    });
  }

  /** ตรวจสิทธิ์เข้าบริษัท — accounting-api เรียกทุก request */
  async membership(userId: string, companyId: string) {
    const m = await this.db.withPublic((tx) => tx.selectFrom('public.company_membership').select(['company_role', 'permissions', 'expires_at', 'require_2fa'])
      .where('user_id', '=', userId).where('company_id', '=', companyId).executeTakeFirst());
    if (!m) return null;
    if (m.expires_at && m.expires_at < this.now().toISOString().slice(0, 10)) return null;
    const role = m.company_role as CompanyRole;
    return { role, permissions: effectivePermissions(role, m.permissions), require2fa: m.require_2fa };
  }

  // ---------- สร้างบริษัท (ScreenCompanyCreate) ----------

  async createCompany(userId: string, input: { nameTh: string; taxId?: string; branchCode?: string; fiscalYearStart?: string; goLive: string; template: 'service' | 'trading' | 'dbd' | 'import'; modules: Record<string, boolean>; orgId?: string }) {
    if (!input.nameTh.trim()) throw new IdError(422, 'กรุณากรอกชื่อบริษัท');
    if (input.taxId && !validTaxId(input.taxId)) throw new IdError(422, 'เลขผู้เสียภาษีไม่ถูกต้อง (ตรวจ checksum ไม่ผ่าน)');
    // TODO(Wei) T1: มีผังบัญชีจริงแค่แม่แบบ "ธุรกิจบริการ" (fixtures 53 บัญชี) · แม่แบบอื่นยังไม่มีรายการ
    if (input.template !== 'service') throw new IdError(422, 'แม่แบบนี้ยังไม่พร้อมใช้ — เลือก "ธุรกิจบริการ / ขนส่ง"');
    const fiscalYear = Number(input.goLive.slice(0, 4)) + 543;
    const companyId = await this.db.withPublic(async (tx) => {
      let orgId = input.orgId;
      if (orgId) {
        const r = await tx.selectFrom('public.org_membership').select('org_role').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
        if (r?.org_role !== 'owner') throw new IdError(403, 'สร้างบริษัทได้เฉพาะเจ้าขององค์กร');
      } else {
        const own = await tx.selectFrom('public.org_membership').select('org_id').where('user_id', '=', userId).where('org_role', '=', 'owner').orderBy('created_at').executeTakeFirst();
        if (own) orgId = own.org_id;
        else {
          // องค์กรแรกของผู้สมัคร — TODO(Wei) T7: แบบร่างไม่มีหน้ากรอกชื่อองค์กร (Signup ขั้น 3) → ใช้ชื่อบริษัทแรกไปก่อน
          const o = await tx.insertInto('public.organization').values({ name: input.nameTh.trim() }).returning('id').executeTakeFirstOrThrow();
          orgId = o.id;
          await tx.insertInto('public.org_membership').values({ org_id: orgId, user_id: userId, org_role: 'owner', expires_at: null }).execute();
          const trialEnd = new Date(this.now().getTime() + TRIAL.days * 86_400_000).toISOString().slice(0, 10);
          await tx.insertInto('public.subscription').values({ org_id: orgId, plan_code: TRIAL.plan, status: 'trialing', renews_at: trialEnd, company_limit: TRIAL.companyLimit, seat_limit: TRIAL.seatLimit, trial_ends_at: trialEnd }).execute();
        }
      }
      // Phase 2 (FR-TN-05): เกินจำนวนบริษัทของแผน = คิดเพิ่ม — v1 ยังไม่บล็อก (ScreenCompanyCreate "บริษัทถัดไปคิดเพิ่มตามแผน")
      const c = await tx.insertInto('public.company').values({
        org_id: orgId, name_th: input.nameTh.trim(), name_en: null, tax_id: input.taxId ?? null, db_dsn: null, branch_code: input.branchCode ?? '00000', fiscal_year_start: input.fiscalYearStart ?? '01-01',
        setup_step: 3, setup_done: false, chart_template: input.template, modules: JSON.stringify(input.modules), go_live_date: input.goLive, created_by: userId,
      }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('public.company_membership').values({ company_id: c.id, user_id: userId, company_role: 'owner', approval_limit: null, permissions: null, expires_at: null, last_used_at: null }).execute();
      return c.id;
    });
    await seedCompany(this.db, companyId, fiscalYear, { sample: false }); // ผังบัญชี + งวด เท่านั้น ไม่ใส่คู่ค้าตัวอย่าง
    return { id: companyId, fiscalYear };
  }

  async setSetupStep(userId: string, companyId: string, step: number) {
    const m = await this.membership(userId, companyId);
    if (!m || (m.role !== 'owner' && m.role !== 'accounting_manager')) throw new IdError(403, 'ไม่มีสิทธิ์ตั้งค่าบริษัทนี้');
    await this.db.withPublic((tx) => tx.updateTable('public.company').set({ setup_step: Math.min(5, Math.max(1, step)), setup_done: step >= 5 }).where('id', '=', companyId).execute());
  }

  // ---------- องค์กรและสมาชิก (ScreenOrgMembers) ----------

  private async orgRole(userId: string, orgId: string): Promise<OrgRole | null> {
    const r = await this.db.withPublic((tx) => tx.selectFrom('public.org_membership').select('org_role').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst());
    return r?.org_role ?? null;
  }
  private async requireOrgAdmin(userId: string, orgId: string) {
    const r = await this.orgRole(userId, orgId);
    if (r !== 'owner' && r !== 'admin') throw new IdError(403, 'เฉพาะ Owner/Admin ขององค์กร');
  }

  async orgOverview(userId: string, orgId: string) {
    const role = await this.orgRole(userId, orgId);
    if (!role || role === 'guest') throw new IdError(403, 'ไม่มีสิทธิ์ดูองค์กรนี้');
    return this.db.withPublic(async (tx) => {
      const org = await tx.selectFrom('public.organization').selectAll().where('id', '=', orgId).executeTakeFirstOrThrow();
      const sub = await tx.selectFrom('public.subscription').selectAll().where('org_id', '=', orgId).executeTakeFirst();
      const companies = await tx.selectFrom('public.company').select(['id', 'name_th']).where('org_id', '=', orgId).where('status', '=', 'active').orderBy('created_at').execute();
      const members = await tx.selectFrom('public.org_membership as m').innerJoin('public.app_user as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.email', 'u.display_name', 'u.mfa_enabled', 'u.last_login_at', 'm.org_role', 'm.expires_at']).where('m.org_id', '=', orgId).orderBy('m.created_at').execute();
      const cms = await tx.selectFrom('public.company_membership as cm').innerJoin('public.company as c', 'c.id', 'cm.company_id')
        .select(['cm.user_id', 'cm.company_id', 'cm.company_role']).where('c.org_id', '=', orgId).execute();
      const invites = await tx.selectFrom('public.invite').select(['id', 'email', 'role', 'company_id', 'kind', 'org_role', 'created_at', 'expires_at', 'access_until'])
        .where('org_id', '=', orgId).where('accepted_at', 'is', null).where('revoked_at', 'is', null).where('declined_at', 'is', null).where('expires_at', '>', this.now()).execute();
      const seats = members.filter((m) => countsSeat(m.org_role)).length;
      return {
        org: { id: org.id, name: org.name, policy: org.security_policy }, myRole: role,
        subscription: sub ? { plan: sub.plan_code, planName: (await tx.selectFrom('public.plan').select('name').where('code', '=', sub.plan_code).executeTakeFirst())?.name ?? sub.plan_code,
          status: sub.status, renewsAt: sub.renews_at, trialEndsAt: sub.trial_ends_at, companyLimit: sub.company_limit, seatLimit: sub.seat_limit } : null,
        companies, seats: { used: seats, pending: invites.filter((i) => i.kind === 'member').length },
        members: members.map((m) => ({ ...m, companies: companies.map((c) => cms.find((x) => x.user_id === m.id && x.company_id === c.id)?.company_role ?? null) })),
        invites,
      };
    });
  }

  /** องค์กรของผู้ใช้ (ScreenProfile "องค์กรและบริษัทที่เข้าถึง") · บทบาทองค์กร · บริษัทที่เข้าถึงพร้อมบทบาท · วันหมดอายุ (Guest) */
  async myOrgs(userId: string) {
    return this.db.withPublic(async (tx) => {
      const orgs = await tx.selectFrom('public.org_membership as m').innerJoin('public.organization as o', 'o.id', 'm.org_id')
        .select(['o.id', 'o.name', 'm.org_role', 'm.expires_at']).where('m.user_id', '=', userId).orderBy('m.created_at').execute();
      const cms = await tx.selectFrom('public.company_membership as cm').innerJoin('public.company as c', 'c.id', 'cm.company_id')
        .select(['c.org_id', 'c.id', 'c.name_th', 'cm.company_role', 'cm.expires_at']).where('cm.user_id', '=', userId).where('c.status', '=', 'active').execute();
      return orgs.map((o) => ({ ...o, companies: cms.filter((c) => c.org_id === o.id).map((c) => ({ id: c.id, name: c.name_th, role: c.company_role, expiresAt: c.expires_at })) }));
    });
  }

  /** ชื่อแผนจากตาราง plan ("business" → "Business") */
  async planName(code: string | null): Promise<string | null> {
    if (!code) return null;
    const p = await this.db.withPublic((tx) => tx.selectFrom('public.plan').select('name').where('code', '=', code).executeTakeFirst());
    return p?.name ?? code;
  }

  /** บันทึกการเข้าสู่ระบบของสมาชิกองค์กร (ScreenOrgMembers แท็บ "บันทึกการเข้าสู่ระบบ") · เฉพาะ Owner/Admin · ล่าสุดก่อน */
  async loginEvents(userId: string, orgId: string, limit = 100) {
    await this.requireOrgAdmin(userId, orgId);
    return this.db.withPublic((tx) => tx.selectFrom('public.login_event as e').innerJoin('public.org_membership as m', (j) => j.onRef('m.user_id', '=', 'e.user_id').on('m.org_id', '=', orgId))
      .select(['e.id', 'e.at', 'e.email', 'e.event', 'e.user_agent']).orderBy('e.at', 'desc').orderBy('e.id', 'desc').limit(Math.min(Math.max(1, limit), 500)).execute());
  }

  // ---------- คำเชิญ ----------

  async invite(userId: string, input: { orgId: string; companyId: string; email: string; role: CompanyRole; kind?: 'member' | 'auditor'; accessUntil?: string }) {
    const email = normEmail(input.email);
    if (!COMPANY_ROLES.includes(input.role) || input.role === 'owner') throw new IdError(422, 'บทบาทไม่ถูกต้อง');
    const orgRole = await this.orgRole(userId, input.orgId);
    const cm = await this.membership(userId, input.companyId);
    // Owner/Admin องค์กร หรือผู้มีสิทธิ์ตั้งค่าผู้ใช้ของบริษัท (Acct. Manager "ผู้ใช้")
    if (orgRole !== 'owner' && orgRole !== 'admin' && !(cm && cm.permissions.settings.write)) throw new IdError(403, 'ไม่มีสิทธิ์เชิญผู้ใช้');
    const company = await this.db.withPublic((tx) => tx.selectFrom('public.company').select(['org_id']).where('id', '=', input.companyId).executeTakeFirst());
    if (company?.org_id !== input.orgId) throw new IdError(422, 'บริษัทไม่อยู่ในองค์กรนี้');
    const kind = input.kind ?? (input.role === 'auditor' ? 'auditor' : 'member');
    const token = randomToken();
    const row = await this.db.withPublic(async (tx) => {
      await tx.updateTable('public.invite').set({ revoked_at: this.now() }).where('org_id', '=', input.orgId).where('company_id', '=', input.companyId).where('email', '=', email)
        .where('accepted_at', 'is', null).where('revoked_at', 'is', null).execute();
      const inv = await tx.insertInto('public.invite').values({
        org_id: input.orgId, company_id: input.companyId, email, role: input.role, token_hash: sha256(token), expires_at: new Date(this.now().getTime() + INVITE_TTL_DAYS * 86_400_000),
        accepted_at: null, kind, org_role: kind === 'auditor' ? 'guest' : 'member', invited_by: userId, access_until: input.accessUntil ?? null, revoked_at: null, declined_at: null,
      }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('public.outbox_email').values({ to_email: email, template: 'invite', payload: JSON.stringify({ token }) }).execute();
      return inv;
    });
    return { id: row.id, token };
  }

  async revokeInvite(userId: string, inviteId: string) {
    const inv = await this.db.withPublic((tx) => tx.selectFrom('public.invite').select(['org_id']).where('id', '=', inviteId).executeTakeFirst());
    if (!inv) throw new IdError(404, 'ไม่พบคำเชิญ');
    await this.requireOrgAdmin(userId, inv.org_id);
    await this.db.withPublic((tx) => tx.updateTable('public.invite').set({ revoked_at: this.now() }).where('id', '=', inviteId).execute());
  }

  /** รายละเอียดคำเชิญ (ScreenInviteAccept) · สถานะ: ok / expired / revoked / accepted / declined · อีเมลตรงกับผู้ที่เข้าสู่ระบบอยู่หรือไม่ */
  async inviteInfo(token: string, viewer: { userId: string; email: string } | null) {
    const r = await this.db.withPublic((tx) => tx.selectFrom('public.invite as i').innerJoin('public.organization as o', 'o.id', 'i.org_id').leftJoin('public.company as c', 'c.id', 'i.company_id')
      .leftJoin('public.app_user as by', 'by.id', 'i.invited_by').leftJoin('public.subscription as s', 's.org_id', 'o.id')
      .select(['i.id', 'i.email', 'i.role', 'i.kind', 'i.expires_at', 'i.accepted_at', 'i.revoked_at', 'i.declined_at', 'o.name as org_name', 'o.security_policy', 'c.name_th as company_name',
        'by.display_name as by_name', 'by.email as by_email', 's.plan_code', 'i.created_at'])
      .where('i.token_hash', '=', sha256(token)).executeTakeFirst());
    if (!r) throw new IdError(404, 'ไม่พบคำเชิญ');
    const status = r.accepted_at ? 'accepted' : r.declined_at ? 'declined' : r.revoked_at ? 'revoked' : r.expires_at.getTime() < this.now().getTime() ? 'expired' : 'ok';
    const hasAccount = !!(await this.db.withPublic((tx) => tx.selectFrom('public.app_user').select('id').where('email', '=', r.email).executeTakeFirst()));
    return {
      status, email: r.email, role: r.role as CompanyRole, roleLabel: COMPANY_ROLE_LABEL[r.role as CompanyRole] ?? r.role, kind: r.kind, orgName: r.org_name, companyName: r.company_name,
      invitedBy: { name: r.by_name, email: r.by_email }, plan: r.plan_code, planName: await this.planName(r.plan_code), createdAt: r.created_at, expiresAt: r.expires_at, policy: r.security_policy, hasAccount,
      emailMatches: viewer ? viewer.email === r.email : null,
    };
  }

  async acceptInvite(user: { userId: string; email: string }, token: string) {
    const info = await this.inviteInfo(token, user);
    if (info.status !== 'ok') throw new IdError(410, 'ลิงก์หมดอายุหรือถูกเพิกถอน — ขอคำเชิญใหม่');
    if (!info.emailMatches) throw new IdError(403, `คำเชิญนี้ส่งถึง ${info.email} — สลับบัญชีก่อน`);
    return this.db.withPublic(async (tx) => {
      const inv = await tx.selectFrom('public.invite').selectAll().where('token_hash', '=', sha256(token)).executeTakeFirstOrThrow();
      // ใช้ได้ครั้งเดียว: update แบบมีเงื่อนไข
      const upd = await tx.updateTable('public.invite').set({ accepted_at: this.now() }).where('id', '=', inv.id).where('accepted_at', 'is', null).executeTakeFirst();
      if (Number(upd.numUpdatedRows) !== 1) throw new IdError(410, 'คำเชิญถูกใช้แล้ว');
      await tx.insertInto('public.org_membership').values({ org_id: inv.org_id, user_id: user.userId, org_role: inv.org_role, expires_at: inv.access_until })
        .onConflict((oc) => oc.columns(['org_id', 'user_id']).doNothing()).execute();
      if (inv.company_id) {
        await tx.insertInto('public.company_membership').values({ company_id: inv.company_id, user_id: user.userId, company_role: inv.role, approval_limit: null, permissions: null, expires_at: inv.access_until, last_used_at: null })
          .onConflict((oc) => oc.columns(['company_id', 'user_id']).doUpdateSet({ company_role: inv.role, expires_at: inv.access_until })).execute();
      }
      if (inv.invited_by) {
        const by = await tx.selectFrom('public.app_user').select('email').where('id', '=', inv.invited_by).executeTakeFirst();
        if (by) await tx.insertInto('public.outbox_email').values({ to_email: by.email, template: 'invite_accepted', payload: JSON.stringify({ email: user.email }) }).execute();
      }
      return { companyId: inv.company_id };
    });
  }

  async declineInvite(user: { userId: string; email: string }, token: string) {
    const info = await this.inviteInfo(token, user);
    if (info.status !== 'ok') throw new IdError(410, 'ลิงก์หมดอายุหรือถูกเพิกถอน');
    if (!info.emailMatches) throw new IdError(403, `คำเชิญนี้ส่งถึง ${info.email} — สลับบัญชีก่อน`);
    await this.db.withPublic((tx) => tx.updateTable('public.invite').set({ declined_at: this.now() }).where('token_hash', '=', sha256(token)).where('accepted_at', 'is', null).execute());
  }

  // ---------- ผู้ใช้และสิทธิ์ของบริษัท (ScreenUsers / ScreenUserEdit) ----------

  async companyUsers(userId: string, companyId: string) {
    const me = await this.membership(userId, companyId);
    if (!me || !me.permissions.settings.read) throw new IdError(403, 'ไม่มีสิทธิ์ดูผู้ใช้ของบริษัทนี้');
    return this.db.withPublic(async (tx) => {
      const c = await tx.selectFrom('public.company').select(['org_id']).where('id', '=', companyId).executeTakeFirstOrThrow();
      const users = await tx.selectFrom('public.company_membership as m').innerJoin('public.app_user as u', 'u.id', 'm.user_id')
        .leftJoin('public.org_membership as om', (j) => j.onRef('om.user_id', '=', 'm.user_id').on('om.org_id', '=', c.org_id))
        .select(['u.id', 'u.email', 'u.display_name', 'u.mfa_enabled', 'u.last_login_at', 'm.company_role', 'm.scope', 'm.approval_limit', 'm.expires_at', 'm.permissions', 'm.require_2fa', 'om.org_role'])
        .where('m.company_id', '=', companyId).orderBy('m.created_at').execute();
      const others = await tx.selectFrom('public.company_membership as m').innerJoin('public.company as c2', 'c2.id', 'm.company_id')
        .select(['m.user_id', 'c2.id', 'c2.name_th', 'm.company_role']).where('c2.org_id', '=', c.org_id).where('m.company_id', '<>', companyId).execute();
      const invites = await tx.selectFrom('public.invite').select(['id', 'email', 'role', 'kind', 'created_at', 'expires_at']).where('company_id', '=', companyId)
        .where('accepted_at', 'is', null).where('revoked_at', 'is', null).where('declined_at', 'is', null).where('expires_at', '>', this.now()).execute();
      const sub = await tx.selectFrom('public.subscription').select(['seat_limit', 'plan_code']).where('org_id', '=', c.org_id).executeTakeFirst();
      const seats = await tx.selectFrom('public.org_membership').select('org_role').where('org_id', '=', c.org_id).execute();
      return {
        orgId: c.org_id, myRole: me.role, seats: { used: seats.filter((s) => countsSeat(s.org_role)).length, limit: sub?.seat_limit ?? null, plan: sub?.plan_code ?? null },
        users: users.map((u) => ({ ...u, effective: effectivePermissions(u.company_role as CompanyRole, u.permissions), otherCompanies: others.filter((o) => o.user_id === u.id) })),
        invites,
      };
    });
  }

  async updateCompanyUser(actorId: string, companyId: string, targetId: string, input: { role: CompanyRole; scope: string; approvalLimit: string | null; expiresAt: string | null; require2fa: boolean; permissions: Record<string, Record<string, boolean>> | null }) {
    const me = await this.membership(actorId, companyId);
    if (!me || !me.permissions.settings.write) throw new IdError(403, 'ไม่มีสิทธิ์แก้ผู้ใช้ของบริษัทนี้');
    if (!COMPANY_ROLES.includes(input.role)) throw new IdError(422, 'บทบาทไม่ถูกต้อง');
    if (input.role === 'owner' && me.role !== 'owner') throw new IdError(403, 'ตั้งเป็น Owner ได้เฉพาะ Owner');
    // null หรือว่าง = ไม่จำกัด (ScreenUsers "ไม่จำกัด")
    const limit = input.approvalLimit === null || input.approvalLimit.trim() === '' ? null : input.approvalLimit.trim();
    if (limit !== null && !/^\d+(\.\d{1,2})?$/u.test(limit)) throw new IdError(422, 'วงเงินอนุมัติไม่ถูกต้อง');
    const target = await this.membership(targetId, companyId);
    if (!target) throw new IdError(404, 'ไม่พบผู้ใช้ในบริษัทนี้');
    if (target.role === 'owner' && me.role !== 'owner') throw new IdError(403, 'แก้สิทธิ์ของ Owner ได้เฉพาะ Owner');
    await this.db.withPublic((tx) => tx.updateTable('public.company_membership').set({
      company_role: input.role, scope: input.scope, approval_limit: limit, expires_at: input.expiresAt, require_2fa: input.require2fa,
      permissions: input.permissions ? JSON.stringify(input.permissions) : null,
    }).where('company_id', '=', companyId).where('user_id', '=', targetId).execute());
    // TODO(M7): บันทึกการเปลี่ยนสิทธิ์ใน audit log (hash chain) ของบริษัท
  }

  async revokeCompanyAccess(actorId: string, companyId: string, targetId: string) {
    const me = await this.membership(actorId, companyId);
    if (!me || !me.permissions.settings.write) throw new IdError(403, 'ไม่มีสิทธิ์');
    const target = await this.membership(targetId, companyId);
    if (target?.role === 'owner') throw new IdError(422, 'ถอด Owner ไม่ได้ — โอนความเป็นเจ้าของก่อน');
    await this.db.withPublic((tx) => tx.deleteFrom('public.company_membership').where('company_id', '=', companyId).where('user_id', '=', targetId).execute());
  }
}
