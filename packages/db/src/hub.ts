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
  return { id: row.id, key }; // key แสดงครั้งเดียว
}
export async function verifyApiKey(db: Db, key: string) {
  const c = await db.withPublic((tx) => tx.selectFrom('public.api_client').selectAll().where('key_hash', '=', sha(key)).where('revoked_at', 'is', null).executeTakeFirst());
  if (!c) return null;
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ last_used_at: new Date() }).where('id', '=', c.id).execute());
  return { id: c.id, companyId: c.company_id, kind: c.kind, scopes: c.scopes as ApiScope[], name: c.name };
}
export async function listApiClients(db: Db, companyId: string) {
  return db.withPublic((tx) => tx.selectFrom('public.api_client').select(['id', 'name', 'kind', 'key_prefix', 'scopes', 'created_at', 'last_used_at', 'revoked_at']).where('company_id', '=', companyId).orderBy('created_at').execute());
}
export async function revokeApiClient(db: Db, companyId: string, id: string) {
  await db.withPublic((tx) => tx.updateTable('public.api_client').set({ revoked_at: new Date() }).where('id', '=', id).where('company_id', '=', companyId).execute());
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
  const eps = await tx.selectFrom('acct.webhook_endpoint').select('id').where('active', '=', true).where(sql<boolean>`${event} = any(events)`).execute();
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
        coalesce(actor_id::text, ''), action, entity, entity_id, coalesce(before::text, ''), coalesce(after::text, '')), 'UTF8'))
        and prev_hash is not distinct from lag(hash) over (order by id)) as ok
      from acct.audit_log where hash is not null order by id`.execute(tx);
    const bad = r.rows.find((x) => !x.ok);
    return { ok: !bad, rows: r.rows.length, brokenAt: bad?.id ?? null };
  });
}
