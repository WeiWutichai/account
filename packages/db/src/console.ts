// M8 Innovera Console (docs/technical-plan-M8.md) — ภาพรวม · องค์กร · support + consent · ops · feature flags
// อ่านข้ามบริษัทผ่าน role console_reader (BYPASSRLS) เท่านั้น · เขียนผ่าน app · ทุกการเข้าดูข้อมูลบริษัทบันทึกทั้ง audit_console และ audit_log ของลูกค้า
import { sql } from 'kysely';
import type { Db } from './index.ts';
import { LedgerError } from './ledger-service.ts';

export type StaffRole = 'support' | 'engineer' | 'billing' | 'ops' | 'admin';
export const MAX_ACCESS_MINUTES = 60;

export async function staffRole(db: Db, userId: string): Promise<StaffRole | null> {
  const s = await db.withPublic((tx) => tx.selectFrom('public.innovera_staff').select(['role', 'active']).where('user_id', '=', userId).executeTakeFirst());
  return s?.active ? s.role : null;
}

// ---------- ภาพรวม / องค์กร / ops (อ่านข้ามบริษัท · console_reader) ----------

export async function consoleOverview(reader: Db, now = new Date()) {
  return reader.withPublic(async (tx) => {
    const one = async <T>(q: Promise<T | undefined>) => (await q) as T;
    const month = now.toISOString().slice(0, 7);
    const counts = await one(sql<{ orgs: string; companies: string; users: string; staff: string; tickets_open: string; consent_pending: string; access_active: string; docs_month: string; dead_webhooks: string; failed_logins_24h: string }>`
      select (select count(*) from public.organization) orgs, (select count(*) from public.company where status = 'active') companies,
        (select count(*) from public.app_user where status = 'active') users, (select count(*) from public.innovera_staff where active) staff,
        (select count(*) from public.support_ticket where status <> 'closed') tickets_open, (select count(*) from public.support_access where status = 'pending') consent_pending,
        (select count(*) from public.support_access where status = 'active' and ends_at > now()) access_active,
        (select count(*) from acct.document where to_char(issue_date, 'YYYY-MM') = ${month}) docs_month,
        (select count(*) from acct.webhook_delivery where status = 'dead') dead_webhooks,
        (select count(*) from public.login_event where event in ('login_fail', 'mfa_fail', 'locked') and at > now() - interval '24 hours') failed_logins_24h`.execute(tx).then((r) => r.rows[0]));
    const plans = await tx.selectFrom('public.subscription').select(['plan_code', 'status', sql<string>`count(*)`.as('n')]).groupBy(['plan_code', 'status']).execute();
    return { counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])), plans: plans.map((p) => ({ ...p, n: Number(p.n) })) };
  });
}

export async function consoleTenants(reader: Db, q?: string) {
  return reader.withPublic(async (tx) => {
    let s = tx.selectFrom('public.organization as o').leftJoin('public.subscription as s', 's.org_id', 'o.id')
      .select(['o.id', 'o.name', 'o.created_at', 's.plan_code', 's.status', 's.renews_at', 's.trial_ends_at', 's.company_limit', 's.seat_limit',
        sql<string>`(select count(*) from public.company c where c.org_id = o.id and c.status = 'active')`.as('companies'),
        sql<string>`(select count(*) from public.org_membership m where m.org_id = o.id and m.org_role <> 'guest')`.as('seats'),
        sql<string>`(select max(u.last_login_at)::text from public.org_membership m join public.app_user u on u.id = m.user_id where m.org_id = o.id)`.as('last_active')])
      .orderBy('o.created_at', 'desc').limit(500);
    if (q) s = s.where('o.name', 'ilike', `%${q}%`);
    return (await s.execute()).map((r) => ({ ...r, companies: Number(r.companies), seats: Number(r.seats) }));
  });
}

export async function consoleOps(reader: Db, migrationsApplied: string[]) {
  return reader.withPublic(async (tx) => {
    const wh = await sql<{ status: string; n: string }>`select status, count(*) n from acct.webhook_delivery group by status`.execute(tx);
    const outbox = await tx.selectFrom('public.outbox_email').select(sql<string>`count(*)`.as('n')).where('sent_at', 'is', null).executeTakeFirstOrThrow();
    const dead = await sql<{ company_id: string; event: string; last_error: string | null; created_at: Date }>`select company_id, event, last_error, created_at from acct.webhook_delivery where status = 'dead' order by created_at desc limit 50`.execute(tx);
    return { schemaVersion: migrationsApplied.at(-1) ?? null, webhooks: Object.fromEntries(wh.rows.map((r) => [r.status, Number(r.n)])), emailQueue: Number(outbox.n), deadLetters: dead.rows };
  });
}

// ---------- ticket + consent (ConsoleSupport) ----------

export async function openTicket(db: Db, staffId: string, input: { orgId: string; companyId?: string | null; subject: string }) {
  return db.withPublic((tx) => tx.insertInto('public.support_ticket').values({ org_id: input.orgId, company_id: input.companyId ?? null, subject: input.subject, assignee: staffId, closed_at: null })
    .returning(['id', 'number']).executeTakeFirstOrThrow());
}
export async function listTickets(db: Db) {
  return db.withPublic((tx) => tx.selectFrom('public.support_ticket as t').innerJoin('public.organization as o', 'o.id', 't.org_id').leftJoin('public.app_user as u', 'u.id', 't.assignee')
    .select(['t.id', 't.number', 't.subject', 't.status', 't.updated_at', 't.company_id', 'o.name as org_name', 'u.display_name as assignee_name']).orderBy('t.number', 'desc').limit(200).execute());
}

/** เจ้าหน้าที่ขอเข้าดู: ต้องมี ticket · เหตุผล + ขอบเขต · ไม่เกิน 60 นาที · support ขอสิทธิ์เขียนไม่ได้ */
export async function requestAccess(db: Db, staff: { userId: string; role: StaffRole }, input: { ticketId: string; reason: string; scope: string; minutes: 30 | 60; write?: boolean }) {
  if (!input.reason.trim() || !input.scope.trim()) throw new LedgerError('ต้องระบุเหตุผลและขอบเขต');
  if (input.minutes > MAX_ACCESS_MINUTES) throw new LedgerError('เข้าดูได้ไม่เกิน 60 นาที');
  if (input.write && staff.role !== 'engineer') throw new LedgerError('สิทธิ์แก้ไขข้อมูลขอได้เฉพาะ engineer (และ Owner ต้องยืนยัน 2FA)');
  return db.withPublic(async (tx) => {
    const t = await tx.selectFrom('public.support_ticket').select(['id', 'company_id', 'status']).where('id', '=', input.ticketId).executeTakeFirst();
    if (!t?.company_id) throw new LedgerError('ticket ต้องระบุบริษัท');
    if (t.status === 'closed') throw new LedgerError('ticket ปิดแล้ว');
    const a = await tx.insertInto('public.support_access').values({ ticket_id: t.id, company_id: t.company_id, requested_by: staff.userId, reason: input.reason, scope: input.scope, minutes: input.minutes,
      write_access: input.write ?? false, decided_by: null, decided_at: null, started_at: null, ends_at: null }).returning('id').executeTakeFirstOrThrow();
    await tx.updateTable('public.support_ticket').set({ status: 'waiting_consent', updated_at: new Date() }).where('id', '=', t.id).execute();
    // แจ้ง Owner ลูกค้า (อีเมล + คิวหน้าแรก)
    const owners = await tx.selectFrom('public.company_membership as m').innerJoin('public.app_user as u', 'u.id', 'm.user_id').select('u.email').where('m.company_id', '=', t.company_id).where('m.company_role', '=', 'owner').execute();
    for (const o of owners) await tx.insertInto('public.outbox_email').values({ to_email: o.email, template: 'support_access_request', payload: JSON.stringify({ accessId: a.id, scope: input.scope, minutes: input.minutes }) }).execute();
    await tx.insertInto('public.audit_console').values({ actor: 'staff', actor_user: staff.userId, action: 'support.request_access', target_company_id: t.company_id, reason: input.reason, consent_ref: a.id, access_id: a.id }).execute();
    return { id: a.id };
  });
}

/** คำขอที่รอ Owner ของบริษัทตัดสิน (คิวหน้าแรกของ accounting-web) */
export async function pendingAccessFor(db: Db, companyId: string) {
  return db.withPublic((tx) => tx.selectFrom('public.support_access as a').innerJoin('public.support_ticket as t', 't.id', 'a.ticket_id').innerJoin('public.app_user as u', 'u.id', 'a.requested_by')
    .select(['a.id', 'a.reason', 'a.scope', 'a.minutes', 'a.write_access', 'a.status', 'a.created_at', 'a.started_at', 'a.ends_at', 't.number', 'u.display_name as staff_name'])
    .where('a.company_id', '=', companyId).where('a.status', 'in', ['pending', 'approved', 'active']).orderBy('a.created_at', 'desc').execute());
}

/** Owner ลูกค้าอนุมัติ/ปฏิเสธ (accounting-web) · อนุมัติแล้ว เจ้าหน้าที่เริ่มเซสชันได้ภายในเวลาที่ขอ */
export async function decideAccess(db: Db, companyId: string, owner: { userId: string; role: string }, accessId: string, approve: boolean) {
  if (owner.role !== 'owner') throw new LedgerError('อนุมัติการเข้าดูได้เฉพาะ Owner ของบริษัท');
  await db.withPublic(async (tx) => {
    const a = await tx.selectFrom('public.support_access').select(['company_id', 'status', 'ticket_id', 'reason']).where('id', '=', accessId).executeTakeFirst();
    if (!a || a.company_id !== companyId) throw new LedgerError('ไม่พบคำขอ');
    if (a.status !== 'pending') throw new LedgerError('คำขอนี้ตัดสินแล้ว');
    await tx.updateTable('public.support_access').set({ status: approve ? 'approved' : 'denied', decided_by: owner.userId, decided_at: new Date() }).where('id', '=', accessId).execute();
    await tx.updateTable('public.support_ticket').set({ status: 'in_progress', updated_at: new Date() }).where('id', '=', a.ticket_id).execute();
    await tx.insertInto('public.audit_console').values({ actor: 'customer_owner', actor_user: owner.userId, action: approve ? 'support.consent_granted' : 'support.consent_denied', target_company_id: companyId, reason: a.reason, consent_ref: accessId, access_id: accessId }).execute();
  });
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: owner.userId, action: approve ? 'support.consent_granted' : 'support.consent_denied', entity: 'support_access', entity_id: accessId,
    before: null, after: JSON.stringify({ approve }), prev_hash: null, hash: null }).execute());
}

export async function startAccess(db: Db, staff: { userId: string }, accessId: string, now = new Date()) {
  return db.withPublic(async (tx) => {
    const a = await tx.selectFrom('public.support_access').select(['status', 'requested_by', 'minutes', 'company_id']).where('id', '=', accessId).executeTakeFirst();
    if (!a) throw new LedgerError('ไม่พบคำขอ');
    if (a.requested_by !== staff.userId) throw new LedgerError('เริ่มเซสชันได้เฉพาะผู้ขอ');
    if (a.status !== 'approved') throw new LedgerError('ยังไม่ได้รับ consent จาก Owner ลูกค้า');
    const ends = new Date(now.getTime() + a.minutes * 60_000);
    await tx.updateTable('public.support_access').set({ status: 'active', started_at: now, ends_at: ends }).where('id', '=', accessId).execute();
    return { companyId: a.company_id, endsAt: ends };
  });
}

/**
 * ด่านเดียวของการอ่านข้อมูลบริษัทโดยทีม Innovera: ต้องมีเซสชัน active ที่ยังไม่หมดเวลา ของผู้ขอคนนี้ ของบริษัทนี้
 * ผ่านแล้วบันทึกการเข้าดูทั้งฝั่ง Console และ audit ของลูกค้า · อ่านอย่างเดียวเสมอ (ไม่มีทางเขียนผ่านด่านนี้)
 */
export async function withSupportAccess<T>(db: Db, staff: { userId: string }, accessId: string, what: string, fn: (companyId: string) => Promise<T>, now = new Date()): Promise<T> {
  const a = await db.withPublic((tx) => tx.selectFrom('public.support_access').select(['company_id', 'status', 'ends_at', 'requested_by', 'reason']).where('id', '=', accessId).executeTakeFirst());
  if (!a || a.requested_by !== staff.userId) throw new LedgerError('ไม่มีสิทธิ์เข้าดู — ต้องมี consent จาก Owner ลูกค้า');
  if (a.status !== 'active' || !a.ends_at || a.ends_at.getTime() <= now.getTime()) {
    if (a.status === 'active') await db.withPublic((tx) => tx.updateTable('public.support_access').set({ status: 'ended' }).where('id', '=', accessId).execute());
    throw new LedgerError('เซสชันเข้าดูหมดเวลาหรือยังไม่เริ่ม');
  }
  await db.withPublic((tx) => tx.insertInto('public.audit_console').values({ actor: 'staff', actor_user: staff.userId, action: 'support.view', target_company_id: a.company_id, reason: what, consent_ref: accessId, access_id: accessId }).execute());
  await db.withCompany(a.company_id, (tx) => tx.insertInto('acct.audit_log').values({ company_id: a.company_id, actor_id: staff.userId, action: 'support.view', entity: 'support_access', entity_id: accessId,
    before: null, after: JSON.stringify({ what }), prev_hash: null, hash: null }).execute());
  return fn(a.company_id);
}

export async function endAccess(db: Db, staff: { userId: string }, accessId: string) {
  await db.withPublic(async (tx) => {
    await tx.updateTable('public.support_access').set({ status: 'ended', ends_at: new Date() }).where('id', '=', accessId).where('requested_by', '=', staff.userId).where('status', '=', 'active').execute();
    const views = await tx.selectFrom('public.audit_console').select(['reason', 'at']).where('access_id', '=', accessId).where('action', '=', 'support.view').orderBy('at').execute();
    const a = await tx.selectFrom('public.support_access').select('company_id').where('id', '=', accessId).executeTakeFirstOrThrow();
    const owners = await tx.selectFrom('public.company_membership as m').innerJoin('public.app_user as u', 'u.id', 'm.user_id').select('u.email').where('m.company_id', '=', a.company_id).where('m.company_role', '=', 'owner').execute();
    // "ส่งสรุปให้ Owner ว่าดูอะไรไปบ้าง"
    for (const o of owners) await tx.insertInto('public.outbox_email').values({ to_email: o.email, template: 'support_access_summary', payload: JSON.stringify({ accessId, views: views.map((v) => v.reason) }) }).execute();
  });
}

// ---------- feature flags (ConsoleFlags) ----------

export async function setFlag(db: Db, staffId: string, f: { key: string; scope: 'global' | 'org' | 'company'; targetId?: string | null; value: unknown }) {
  if (f.scope !== 'global' && !f.targetId) throw new LedgerError('ต้องระบุองค์กร/บริษัท');
  await db.withPublic(async (tx) => {
    await tx.insertInto('public.feature_flag').values({ key: f.key, scope: f.scope, target_id: f.targetId ?? null, value: JSON.stringify(f.value), updated_by: staffId, updated_at: new Date() })
      .onConflict((oc) => oc.columns(['key', 'scope', 'target_id']).doUpdateSet({ value: JSON.stringify(f.value), updated_by: staffId, updated_at: new Date() })).execute();
    await tx.insertInto('public.audit_console').values({ actor: 'staff', actor_user: staffId, action: 'flag.set', target_company_id: f.scope === 'company' ? f.targetId! : null, reason: `${f.key}=${JSON.stringify(f.value)}`, consent_ref: null, access_id: null }).execute();
  });
}
/** ค่าของ flag สำหรับบริษัท: company > org > global */
export async function flagValue(db: Db, key: string, companyId: string): Promise<unknown> {
  return db.withPublic(async (tx) => {
    const c = await tx.selectFrom('public.company').select('org_id').where('id', '=', companyId).executeTakeFirst();
    const rows = await tx.selectFrom('public.feature_flag').select(['scope', 'target_id', 'value']).where('key', '=', key).execute();
    return (rows.find((r) => r.scope === 'company' && r.target_id === companyId) ?? rows.find((r) => r.scope === 'org' && r.target_id === c?.org_id) ?? rows.find((r) => r.scope === 'global'))?.value ?? null;
  });
}
export async function listFlags(db: Db) {
  return db.withPublic((tx) => tx.selectFrom('public.feature_flag').selectAll().orderBy('key').execute());
}
export async function consoleAudit(db: Db) {
  return db.withPublic((tx) => tx.selectFrom('public.audit_console as a').leftJoin('public.app_user as u', 'u.id', 'a.actor_user').leftJoin('public.company as c', 'c.id', 'a.target_company_id')
    .select(['a.id', 'a.at', 'a.actor', 'a.action', 'a.reason', 'a.consent_ref', 'u.display_name', 'c.name_th as company']).orderBy('a.id', 'desc').limit(300).execute());
}
