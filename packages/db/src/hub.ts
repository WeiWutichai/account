// M7 Hub (docs/technical-plan-M7.md): API key ของแอปภายนอก · webhook outbox (HMAC-SHA256 · retry 3 · dead-letter) · ตรวจ audit hash chain
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError } from './ledger-service.ts';

export const API_SCOPES = ['documents:read', 'documents:draft', 'contacts:read', 'contacts:draft', 'ledger:read', 'reports:read', 'tax:read', 'schema:read', 'webhooks:manage'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const WEBHOOK_EVENTS = ['document.posted', 'document.voided', 'payment.received', 'payment.paid', 'period.closed'] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
/** ส่งครั้งแรก + ลองใหม่ 3 ครั้ง (PLAN §5 "retry 3") แล้วเป็น dead-letter */
export const WEBHOOK_MAX_ATTEMPTS = 4;
const BACKOFF_S = [60, 300, 1800];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- API client ----------

export async function createApiClient(db: Db, companyId: string, actorId: string | null, input: { name: string; kind: 'tms' | 'mcp' | 'custom'; scopes: ApiScope[] }) {
  const bad = input.scopes.filter((s) => !API_SCOPES.includes(s));
  if (bad.length) throw new LedgerError(`scope ไม่อนุญาต: ${bad.join(', ')} (API/MCP สร้างได้แค่ร่าง · ไม่มี post/pay/periods/users/settings)`);
  const key = `inn_${input.kind}_${randomBytes(24).toString('base64url')}`;
  const row = await db.withPublic((tx) => tx.insertInto('public.api_client').values({ company_id: companyId, name: input.name, kind: input.kind, key_prefix: key.slice(0, 12), key_hash: sha(key),
    scopes: input.scopes, created_by: actorId, last_used_at: null, revoked_at: null }).returning('id').executeTakeFirstOrThrow());
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: 'api_client.create', entity: 'api_client', entity_id: row.id,
    before: null, after: JSON.stringify({ name: input.name, kind: input.kind, scopes: input.scopes }), prev_hash: null, hash: null }).execute());
  return { id: row.id, key }; // key แสดงครั้งเดียว
}
/** API key ที่ใช้ได้: ไม่ถูกเพิกถอน · ไม่ถูกระงับ (ระงับที่ครบกำหนดแล้วเปิดกลับอัตโนมัติ) */
export async function verifyApiKey(db: Db, key: string, now = new Date()) {
  const c = await db.withPublic((tx) => tx.selectFrom('public.api_client').selectAll().where('key_hash', '=', sha(key)).where('revoked_at', 'is', null).executeTakeFirst());
  if (!c) return null;
  if (c.status === 'suspended' && (!c.suspended_until || new Date(c.suspended_until) > now)) return null;
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ last_used_at: now, ...(c.status === 'suspended' ? { status: 'active' as const, suspended_until: null } : {}) }).where('id', '=', c.id).execute());
  return { id: c.id, companyId: c.company_id, kind: c.kind, scopes: c.scopes as ApiScope[], name: c.name };
}

// ---------- ชื่อผู้ใช้ (Innovera ID) ----------

/** user id → ชื่อที่แสดง (public.app_user) · id ที่ไม่พบจะไม่อยู่ใน map */
export async function userNames(db: Db, ids: readonly (string | null | undefined)[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return {};
  const rows = await db.withPublic((tx) => tx.selectFrom('public.app_user').select(['id', 'display_name']).where('id', 'in', uniq).execute());
  return Object.fromEntries(rows.map((r) => [r.id, r.display_name]));
}

const isSuspended = (c: { status: string; suspended_until: Date | string | null }, now: Date) => c.status === 'suspended' && (!c.suspended_until || new Date(c.suspended_until) > now);

/** GET /v1/api-clients — ผู้อนุญาต · ผู้เพิกถอน + เหตุผล · สถานะระงับ · จำนวนเรียก/ถูกปฏิเสธ 7 วัน · ร่างที่ client สร้างรอตรวจ */
export async function listApiClients(db: Db, companyId: string, now = new Date()) {
  const rows = await db.withPublic((tx) => tx.selectFrom('public.api_client').select(['id', 'name', 'kind', 'key_prefix', 'scopes', 'created_by', 'created_at', 'last_used_at', 'revoked_at',
    'status', 'suspended_until', 'revoked_by', 'revoke_reason']).where('company_id', '=', companyId).orderBy('created_at').execute());
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const { calls, drafts } = await db.withCompany(companyId, async (tx) => ({
    calls: await tx.selectFrom('acct.api_call').select(['client_id', sql<string>`count(*)`.as('n'), sql<string>`count(*) filter (where status = 'denied')`.as('denied')])
      .where('at', '>=', since).groupBy('client_id').execute(),
    drafts: await tx.selectFrom('acct.document').select(['created_by_client', sql<string>`count(*)`.as('n')]).where('created_by_client', 'is not', null).where('status', '=', 'draft')
      .groupBy('created_by_client').execute(),
  }));
  const names = await userNames(db, rows.flatMap((r) => [r.created_by, r.revoked_by]));
  return rows.map((r) => {
    const c = calls.find((x) => x.client_id === r.id);
    return { ...r, status: isSuspended(r, now) ? ('suspended' as const) : ('active' as const), suspended_until: isSuspended(r, now) ? r.suspended_until : null,
      created_by_name: r.created_by ? names[r.created_by] ?? null : null, revoked_by_name: r.revoked_by ? names[r.revoked_by] ?? null : null,
      calls_7d: Number(c?.n ?? 0), denied_7d: Number(c?.denied ?? 0), drafts_pending: Number(drafts.find((d) => d.created_by_client === r.id)?.n ?? 0) };
  });
}

async function liveClient(db: Db, companyId: string, id: string) {
  const c = await db.withPublic((tx) => tx.selectFrom('public.api_client').selectAll().where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst());
  if (!c) throw new LedgerError('ไม่พบ client');
  if (c.revoked_at) throw new LedgerError('client นี้ถูกเพิกถอนแล้ว');
  return c;
}
/** บันทึก audit 1 แถว (ช่องทาง/IP/client มาจาก AuditContext ของ request) */
export async function recordAudit(db: Db, companyId: string, row: { actorId: string | null; action: string; entity: string; entityId: string; before?: unknown; after?: unknown }) {
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: row.actorId, action: row.action, entity: row.entity, entity_id: row.entityId,
    before: row.before === undefined ? null : JSON.stringify(row.before), after: row.after === undefined ? null : JSON.stringify(row.after), prev_hash: null, hash: null }).execute());
}

export interface RevokeOptions { notify?: boolean; keepDrafts?: boolean }
/** เพิกถอนทันที (ScreenRevoke "เพิกถอนทั้งหมดทันที") · เก็บผู้เพิกถอน + เหตุผล · ปิด webhook · notify → อีเมลถึง Owner + ผู้อนุญาตเดิม (คิว outbox) · keepDrafts=false → ลบร่างที่ client สร้าง */
export async function revokeApiClient(db: Db, companyId: string, id: string, actorId: string | null = null, reason = '', opts: RevokeOptions = {}) {
  const c = await liveClient(db, companyId, id);
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ revoked_at: new Date(), revoked_by: actorId, revoke_reason: reason || null }).where('id', '=', id).where('company_id', '=', companyId).execute());
  const deleted = await db.withCompany(companyId, async (tx) => {
    await tx.updateTable('acct.webhook_endpoint').set({ active: false }).where('api_client_id', '=', id).execute();
    let drafts: string[] = [];
    if (opts.keepDrafts === false) {
      // ร่างยังไม่ผ่านรายการ → ลบได้ (เอกสารที่ผ่านรายการแล้วไม่ถูกแตะ)
      drafts = (await tx.selectFrom('acct.document').select('id').where('created_by_client', '=', id).where('status', '=', 'draft').execute()).map((d) => d.id);
      if (drafts.length) {
        await tx.deleteFrom('acct.document_line').where('document_id', 'in', drafts).execute();
        await tx.deleteFrom('acct.document').where('id', 'in', drafts).where('status', '=', 'draft').execute();
      }
    }
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: 'api_client.revoke', entity: 'api_client', entity_id: id,
      before: JSON.stringify({ name: c.name, scopes: c.scopes }), after: JSON.stringify({ reason, notify: !!opts.notify, ...(drafts.length ? { deleted_drafts: drafts.length } : {}) }), prev_hash: null, hash: null }).execute();
    return drafts.length;
  });
  if (opts.notify) {
    await db.withPublic(async (tx) => {
      const owners = await tx.selectFrom('public.company_membership as m').innerJoin('public.app_user as u', 'u.id', 'm.user_id').select('u.email')
        .where('m.company_id', '=', companyId).where('m.company_role', '=', 'owner').execute();
      const creator = c.created_by ? await tx.selectFrom('public.app_user').select('email').where('id', '=', c.created_by).executeTakeFirst() : undefined;
      const to = [...new Set([...owners.map((o) => o.email), ...(creator ? [creator.email] : [])])];
      // TODO(M3.5): ยังไม่มีตัวส่งอีเมลจริง — เข้าคิว public.outbox_email ไว้
      for (const e of to) await tx.insertInto('public.outbox_email').values({ to_email: e, template: 'api_client_revoked', payload: JSON.stringify({ companyId, clientId: id, name: c.name, reason, by: actorId }) }).execute();
    });
  }
  return { deletedDrafts: deleted };
}
/** ระงับชั่วคราว (ScreenRevoke "ระงับชั่วคราว 7 วัน") — ปฏิเสธการเรียกจนครบกำหนดหรือเปิดกลับ · ไม่ลบการอนุญาต */
export async function suspendApiClient(db: Db, companyId: string, id: string, actorId: string | null, p: { days?: number; reason?: string } = {}) {
  const c = await liveClient(db, companyId, id);
  const days = p.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new LedgerError('ระงับได้ 1–90 วัน');
  const until = new Date(Date.now() + days * 86_400_000);
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ status: 'suspended', suspended_until: until }).where('id', '=', id).execute());
  await recordAudit(db, companyId, { actorId, action: 'api_client.suspend', entity: 'api_client', entityId: id, before: { status: c.status }, after: { status: 'suspended', until: until.toISOString(), reason: p.reason ?? '' } });
  return { suspendedUntil: until.toISOString() };
}
export async function resumeApiClient(db: Db, companyId: string, id: string, actorId: string | null) {
  const c = await liveClient(db, companyId, id);
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ status: 'active', suspended_until: null }).where('id', '=', id).execute());
  await recordAudit(db, companyId, { actorId, action: 'api_client.resume', entity: 'api_client', entityId: id, before: { status: c.status }, after: { status: 'active' } });
}
/** แก้ scopes — ต้องอยู่ใน API_SCOPES เท่านั้น (ไม่มี post/pay/periods/users/settings · CLAUDE.md) */
export async function updateApiClientScopes(db: Db, companyId: string, id: string, actorId: string | null, scopes: string[], reason = '') {
  const bad = scopes.filter((s) => !(API_SCOPES as readonly string[]).includes(s));
  if (bad.length) throw new LedgerError(`scope ไม่อนุญาต: ${bad.join(', ')} (API/MCP สร้างได้แค่ร่าง · ไม่มี post/pay/periods/users/settings)`);
  if (!scopes.length) throw new LedgerError('ต้องมีอย่างน้อย 1 scope — ถ้าจะปิดทั้งหมดให้เพิกถอน');
  const c = await liveClient(db, companyId, id);
  const next = [...new Set(scopes)];
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ scopes: next }).where('id', '=', id).execute());
  await recordAudit(db, companyId, { actorId, action: 'api_client.scopes', entity: 'api_client', entityId: id, before: { scopes: c.scopes }, after: { scopes: next, ...(reason ? { reason } : {}) } });
  return { scopes: next };
}
/** ScreenRevoke "ลดสิทธิ์เป็นอ่านอย่างเดียว": คงเฉพาะ scope ที่ลงท้าย :read */
export async function makeApiClientReadOnly(db: Db, companyId: string, id: string, actorId: string | null, reason = '') {
  const c = await liveClient(db, companyId, id);
  const ro = c.scopes.filter((s) => s.endsWith(':read'));
  if (!ro.length) throw new LedgerError('client นี้ไม่มีสิทธิ์อ่าน — ใช้เพิกถอนแทน');
  return updateApiClientScopes(db, companyId, id, actorId, ro, reason);
}

// ---------- สถิติการเรียก API/MCP ----------

export interface ApiCallInput { clientId: string; kind: 'api' | 'mcp'; tool: string; status: 'ok' | 'denied' | 'error'; documentId?: string | null; detail?: string | null }
/** บันทึกการเรียก 1 ครั้ง (ext.controller: REST + เครื่องมือ MCP) */
export async function recordApiCall(db: Db, companyId: string, r: ApiCallInput) {
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.api_call').values({ company_id: companyId, client_id: r.clientId, kind: r.kind, tool: r.tool.slice(0, 120), status: r.status,
    document_id: r.documentId ?? null, detail: r.detail ? r.detail.slice(0, 300) : null }).execute());
}
/** ScreenMcp "ล่าสุดจาก client" · ScreenRevoke "กิจกรรม 24 ชม." + "สิ่งที่ client นี้สร้างไว้และยังค้างอยู่" (ระบุ clientId = เฉพาะ client นั้น) */
export async function apiClientActivity(db: Db, companyId: string, clientId?: string, now = new Date()) {
  const since24 = new Date(now.getTime() - 86_400_000);
  const out = await db.withCompany(companyId, async (tx) => {
    let rq = tx.selectFrom('acct.api_call as a').leftJoin('acct.document as d', (j) => j.onRef('d.id', '=', 'a.document_id').onRef('d.company_id', '=', 'a.company_id'))
      .select(['a.id', 'a.client_id', 'a.at', 'a.kind', 'a.tool', 'a.status', 'a.detail', 'a.document_id', 'd.doc_no', 'd.doc_type', 'd.status as doc_status', 'd.grand_total']).orderBy('a.id', 'desc').limit(20);
    if (clientId) rq = rq.where('a.client_id', '=', clientId);
    let dq = tx.selectFrom('acct.document').select(['id', 'doc_type', 'doc_no', 'status', 'grand_total', 'issue_date', 'created_by_client']).where('created_by_client', 'is not', null).where('status', '=', 'draft').orderBy('created_at');
    if (clientId) dq = dq.where('created_by_client', '=', clientId);
    let cq = tx.selectFrom('acct.contact').select(sql<string>`count(*)`.as('n')).where('created_by_client', 'is not', null);
    if (clientId) cq = cq.where('created_by_client', '=', clientId);
    let tq = tx.selectFrom('acct.api_call').select(['tool', 'status', sql<string>`count(*)`.as('n')]).where('at', '>=', since24).groupBy(['tool', 'status']).orderBy('tool');
    if (clientId) tq = tq.where('client_id', '=', clientId);
    return {
      recent: await rq.execute(), drafts: await dq.execute(), contacts: Number((await cq.executeTakeFirstOrThrow()).n),
      last24h: (await tq.execute()).map((r) => ({ tool: r.tool, status: r.status, n: Number(r.n) })),
    };
  });
  const clients = await db.withPublic((tx) => tx.selectFrom('public.api_client').select(['id', 'name']).where('company_id', '=', companyId).execute());
  const name = Object.fromEntries(clients.map((c) => [c.id, c.name]));
  return { ...out, recent: out.recent.map((r) => ({ ...r, client_name: name[r.client_id] ?? null })) };
}
export async function setWebhookActive(db: Db, companyId: string, id: string, active: boolean) {
  await db.withCompany(companyId, (tx) => tx.updateTable('acct.webhook_endpoint').set({ active }).where('id', '=', id).execute());
}

// ---------- webhooks ----------

export async function addWebhook(db: Db, companyId: string, input: { url: string; events: WebhookEventName[]; apiClientId?: string | null }) {
  const bad = input.events.filter((e) => !WEBHOOK_EVENTS.includes(e));
  if (bad.length || !input.events.length) throw new LedgerError(`event ไม่ถูกต้อง: ${bad.join(', ')}`);
  if (!/^https:\/\//u.test(input.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//u.test(input.url)) throw new LedgerError('webhook ต้องเป็น https');
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const r = await db.withCompany(companyId, (tx) => tx.insertInto('acct.webhook_endpoint').values({ company_id: companyId, url: input.url, secret, events: input.events, api_client_id: input.apiClientId ?? null })
    .returning('id').executeTakeFirstOrThrow());
  return { id: r.id, secret };
}

/** outbox: บันทึกใน transaction เดียวกับธุรกรรม — ส่งจริงโดย deliverDue (ธุรกรรม rollback = ไม่ส่ง) */
export async function emitTx(tx: CompanyTx, companyId: string, event: WebhookEventName, data: Record<string, unknown>) {
  // ไม่ส่งให้ webhook ของ client ที่ถูกเพิกถอน/ระงับอยู่
  const eps = await tx.selectFrom('acct.webhook_endpoint as e').select('e.id').where('e.active', '=', true).where(sql<boolean>`${event} = any(e.events)`)
    .where(sql<boolean>`(e.api_client_id is null or not exists (select 1 from public.api_client c where c.id = e.api_client_id
      and (c.revoked_at is not null or (c.status = 'suspended' and (c.suspended_until is null or c.suspended_until > now())))))`)
    .execute();
  if (!eps.length) return;
  const payload = { id: randomBytesUuid(), type: event, company_id: companyId, occurred_at: new Date().toISOString(), data };
  await tx.insertInto('acct.webhook_delivery').values(eps.map((e) => ({ company_id: companyId, endpoint_id: e.id, event, payload: JSON.stringify(payload) }))).execute();
}
function randomBytesUuid() {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** ลายเซ็นที่ผู้รับตรวจ: HMAC-SHA256(secret, `${timestamp}.${body}`) */
export const signWebhook = (secret: string, timestamp: string, body: string) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

export type Sender = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
const fetchSender: Sender = async (url, init) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body: init.body, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
  return { ok: r.ok, status: r.status };
};

/** ส่ง webhook ที่ถึงกำหนดของบริษัท (worker เรียกเป็นรอบ) */
export async function deliverDue(db: Db, companyId: string, opts: { now?: Date; send?: Sender } = {}) {
  const now = opts.now ?? new Date();
  const send = opts.send ?? fetchSender;
  const due = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.webhook_delivery as d').innerJoin('acct.webhook_endpoint as e', (j) => j.onRef('e.id', '=', 'd.endpoint_id').onRef('e.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.event', 'd.payload', 'd.attempts', 'e.url', 'e.secret']).where('d.status', '=', 'pending').where('d.next_attempt_at', '<=', now).orderBy('d.created_at').limit(100).execute());
  const out = { sent: 0, retry: 0, dead: 0 };
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    const ts = String(Math.floor(now.getTime() / 1000));
    let ok = false;
    let err = '';
    try {
      const r = await send(d.url, { headers: { 'x-innovera-event': d.event, 'x-innovera-delivery': d.id, 'x-innovera-timestamp': ts, 'x-innovera-signature': `sha256=${signWebhook(d.secret, ts, body)}` }, body });
      ok = r.ok;
      err = ok ? '' : `HTTP ${r.status}`;
    } catch (e) {
      err = (e as Error).message.slice(0, 200);
    }
    const attempts = d.attempts + 1;
    await db.withCompany(companyId, (tx) => tx.updateTable('acct.webhook_delivery').set(ok
      ? { status: 'sent', attempts, sent_at: now, last_error: null }
      : attempts >= WEBHOOK_MAX_ATTEMPTS ? { status: 'dead', attempts, last_error: err }
      : { attempts, last_error: err, next_attempt_at: new Date(now.getTime() + BACKOFF_S[attempts - 1]! * 1000) }).where('id', '=', d.id).execute());
    if (ok) out.sent++; else if (attempts >= WEBHOOK_MAX_ATTEMPTS) out.dead++; else out.retry++;
  }
  return out;
}
/** ส่ง dead-letter ใหม่ (ผู้ดูแลกดหลังแก้ปลายทางแล้ว) */
export async function redeliver(db: Db, companyId: string, deliveryId: string) {
  await db.withCompany(companyId, (tx) => tx.updateTable('acct.webhook_delivery').set({ status: 'pending', attempts: 0, next_attempt_at: new Date(), last_error: null }).where('id', '=', deliveryId).execute());
}

// ---------- audit hash chain ----------

/** ตรวจ hash chain ของบริษัท: แต่ละแถวต้องชี้ hash ก่อนหน้าถูก และ hash ต้องคำนวณได้ตรง (ตรวจด้วย SQL เดียวกับ trigger) */
export async function verifyAuditChain(db: Db, companyId: string): Promise<{ ok: boolean; rows: number; brokenAt: string | null }> {
  return db.withCompany(companyId, async (tx) => {
    const r = await sql<{ id: string; ok: boolean }>`
      select id::text, (hash = sha256(coalesce(prev_hash, '\\x'::bytea) || convert_to(concat_ws('|', company_id, id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        coalesce(actor_id::text, ''), action, entity, entity_id, coalesce(before::text, ''), coalesce(after::text, ''),
        case when channel is null then null else concat_ws('/', channel, coalesce(ip, ''), coalesce(api_client_id::text, '')) end), 'UTF8'))
        and prev_hash is not distinct from lag(hash) over (order by id)) as ok
      from acct.audit_log where hash is not null order by id`.execute(tx);
    const bad = r.rows.find((x) => !x.ok);
    return { ok: !bad, rows: r.rows.length, brokenAt: bad?.id ?? null };
  });
}

/** PUT /ext/v1/contacts — sync คู่ค้าจากแอปภายนอกด้วยเลขผู้เสียภาษี (หรือ external_ref) · สร้างใหม่ได้รหัส EXT-#### */
export async function syncContacts(db: Db, companyId: string, rows: { tax_id?: string | null; external_source?: string | null; external_ref?: string | null; name: string; kind: 'customer' | 'vendor' | 'both'; branch_code?: string | null; address?: string | null }[],
  clientId: string | null = null) {
  return db.withCompany(companyId, async (tx) => {
    const out = [];
    for (const r of rows) {
      if (!r.tax_id && !r.external_ref) throw new LedgerError('ต้องมี tax_id หรือ external_ref');
      let q = tx.selectFrom('acct.contact').select(['id', 'code']);
      q = r.tax_id ? q.where('tax_id', '=', r.tax_id).where('branch_code', 'is not distinct from', r.branch_code ?? null) : q.where('external_source', '=', r.external_source ?? null).where('external_ref', '=', r.external_ref!);
      const hit = await q.executeTakeFirst();
      if (hit) {
        await tx.updateTable('acct.contact').set({ name: r.name, ...(r.address !== undefined ? { address: r.address } : {}) }).where('id', '=', hit.id).execute();
        out.push({ id: hit.id, code: hit.code, created: false });
      } else {
        const n = await tx.selectFrom('acct.contact').select(sql<string>`count(*)`.as('n')).where('code', 'like', 'EXT-%').executeTakeFirstOrThrow();
        const code = `EXT-${String(Number(n.n) + 1).padStart(4, '0')}`;
        const ins = await tx.insertInto('acct.contact').values({ company_id: companyId, code, name: r.name, kind: r.kind, tax_id: r.tax_id ?? null, branch_code: r.branch_code ?? null,
          external_source: r.external_source ?? null, external_ref: r.external_ref ?? null, address: r.address ?? null, contact_person: null, phone: null, email: null, credit_days: null, credit_limit: null,
          created_by_client: clientId })
          .returning('id').executeTakeFirstOrThrow();
        await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: null, action: 'contact.create', entity: 'contact', entity_id: ins.id, before: null,
          after: JSON.stringify({ code, name: r.name, tax_id: r.tax_id ?? null, external_ref: r.external_ref ?? null }), prev_hash: null, hash: null }).execute();
        out.push({ id: ins.id, code, created: true });
      }
    }
    return out;
  });
}

export async function webhookStatus(db: Db, companyId: string) {
  return db.withCompany(companyId, async (tx) => ({
    endpoints: await tx.selectFrom('acct.webhook_endpoint').select(['id', 'url', 'events', 'active', 'api_client_id', 'created_at']).orderBy('created_at').execute(),
    deliveries: await tx.selectFrom('acct.webhook_delivery').select(['id', 'endpoint_id', 'event', 'status', 'attempts', 'last_error', 'created_at', 'sent_at', 'next_attempt_at']).orderBy('created_at', 'desc').limit(200).execute(),
  }));
}
/** หมวดของตัวกรอง "ประเภท" ใน ScreenAudit → prefix ของ action */
export const AUDIT_CATEGORIES: Record<string, readonly string[]> = {
  document: ['document.'], journal: ['journal.'], period: ['period.'], user: ['user.', 'role.', 'support.'], settings: ['settings.', 'flag.', 'company.'],
  api: ['api_client.', 'webhook.'], login: ['login.'],
};
/** ไม่นับเป็น "เหตุการณ์สำคัญ" (ScreenAudit ช่อง "เฉพาะเหตุการณ์สำคัญ") */
export const AUDIT_MINOR_ACTIONS = ['support.view'] as const;

export interface AuditFilter {
  limit?: number; offset?: number; entity?: string; category?: string; important?: boolean;
  /** user id · "client:<api client id>" · "system" */
  actor?: string;
  /** วันที่ (เวลาไทย) YYYY-MM-DD */
  from?: string; to?: string; q?: string;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** GET /v1/audit — แบ่งหน้าฝั่ง server (limit/offset) + จำนวนทั้งหมดตามตัวกรอง + ชื่อผู้กระทำ/ชื่อ client + เลขเอกสาร */
export async function auditLog(db: Db, companyId: string, f: AuditFilter = {}) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);
  const needle = f.q?.trim() ?? '';
  // ชื่อผู้ใช้อยู่ใน public.app_user (withPublic) → แปลงคำค้นเป็น user id ก่อน
  const nameHits = needle ? await db.withPublic((tx) => tx.selectFrom('public.app_user').select('id').where('display_name', 'ilike', `%${needle}%`).limit(100).execute()) : [];
  const clientRows = await db.withPublic((tx) => tx.selectFrom('public.api_client').select(['id', 'name', 'kind']).where('company_id', '=', companyId).execute());
  const clientHits = needle ? clientRows.filter((c) => c.name.toLowerCase().includes(needle.toLowerCase())).map((c) => c.id) : [];
  const res = await db.withCompany(companyId, async (tx) => {
    // ตัวกรองยกเว้นผู้กระทำ (ใช้สร้างรายชื่อผู้กระทำในตัวเลือก)
    let base = tx.selectFrom('acct.audit_log as a').leftJoin('acct.document as d', (j) => j.on('a.entity', '=', 'document').on(sql<boolean>`d.id::text = a.entity_id`).onRef('d.company_id', '=', 'a.company_id'));
    if (f.entity) base = base.where('a.entity', '=', f.entity);
    const prefixes = f.category ? AUDIT_CATEGORIES[f.category] : undefined;
    if (f.category) base = prefixes ? base.where((eb) => eb.or(prefixes.map((p) => eb('a.action', 'like', `${p}%`)))) : base.where(sql<boolean>`false`);
    if (f.important) base = base.where('a.action', 'not in', [...AUDIT_MINOR_ACTIONS]);
    if (f.from && DATE_RE.test(f.from)) base = base.where(sql<boolean>`a.at >= (${f.from}::date::timestamp at time zone 'Asia/Bangkok')`);
    if (f.to && DATE_RE.test(f.to)) base = base.where(sql<boolean>`a.at < ((${f.to}::date + 1)::timestamp at time zone 'Asia/Bangkok')`);
    if (needle) {
      const like = `%${needle}%`;
      base = base.where((eb) => eb.or([
        eb('a.action', 'ilike', like), eb('a.entity_id', 'ilike', like), eb('d.doc_no', 'ilike', like),
        eb(sql<string>`coalesce(a.before::text, '')`, 'ilike', like), eb(sql<string>`coalesce(a.after::text, '')`, 'ilike', like),
        ...(nameHits.length ? [eb('a.actor_id', 'in', nameHits.map((n) => n.id))] : []),
        ...(clientHits.length ? [eb('a.api_client_id', 'in', clientHits)] : []),
      ]));
    }
    const actors = await base.select(['a.actor_id', 'a.api_client_id']).distinct().limit(200).execute();
    let q = base;
    if (f.actor === 'system') q = q.where('a.actor_id', 'is', null).where('a.api_client_id', 'is', null);
    else if (f.actor?.startsWith('client:') && UUID_RE.test(f.actor.slice(7))) q = q.where('a.actor_id', 'is', null).where('a.api_client_id', '=', f.actor.slice(7));
    else if (f.actor && UUID_RE.test(f.actor)) q = q.where('a.actor_id', '=', f.actor);
    const total = Number((await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
    const rows = await q.select(['a.id', 'a.at', 'a.actor_id', 'a.action', 'a.entity', 'a.entity_id', 'a.before', 'a.after', 'a.channel', 'a.ip', 'a.api_client_id', 'd.doc_no',
      sql<string>`encode(a.hash, 'hex')`.as('hash'), sql<string>`encode(a.prev_hash, 'hex')`.as('prev_hash')]).orderBy('a.id', 'desc').limit(limit).offset(offset).execute();
    return { rows, total, actors };
  });
  const names = await userNames(db, [...res.rows.map((r) => r.actor_id), ...res.actors.map((a) => a.actor_id)]);
  const client = Object.fromEntries(clientRows.map((c) => [c.id, c]));
  const actorOpts = new Map<string, string>();
  for (const a of res.actors) {
    if (a.actor_id) actorOpts.set(a.actor_id, names[a.actor_id] ?? a.actor_id);
    else if (a.api_client_id) actorOpts.set(`client:${a.api_client_id}`, client[a.api_client_id]?.name ?? a.api_client_id);
    else actorOpts.set('system', 'ระบบ');
  }
  return {
    total: res.total, limit, offset,
    actors: [...actorOpts].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name, 'th')),
    rows: res.rows.map((r) => ({ ...r, actor_name: r.actor_id ? names[r.actor_id] ?? null : null,
      client_name: r.api_client_id ? client[r.api_client_id]?.name ?? null : null, client_kind: r.api_client_id ? client[r.api_client_id]?.kind ?? null : null })),
  };
}
