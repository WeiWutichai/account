// M7 Hub: API key/scope · webhook outbox (HMAC · retry 3 · dead-letter) · audit hash chain · draft ภายนอก idempotent
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePeriod } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import { addWebhook, createApiClient, deliverDue, signWebhook, verifyApiKey, verifyAuditChain, WEBHOOK_MAX_ATTEMPTS, type Sender } from '../src/hub.ts';
import type { Db } from '../src/index.ts';
import { createDraftDocument } from '../src/ledger-service.ts';
import { approveDocument, saveSalesDraft, voidDocument } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { admin, appDb, freshSchema } from './helpers.ts';

void readFileSync;
const mgr = { userId: null, role: 'accounting_manager' as const };
let db: Db;
let A = '';
let B = '';
beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  B = await createCompany(db, { orgId: org, nameTh: 'บริษัท ข จำกัด' });
  await seedCompany(db, A);
  await seedCompany(db, B);
}, 120_000);
afterAll(() => db.close());

describe('API client', () => {
  it('ออก key ครั้งเดียว เก็บ hash · scope post/pay ถูกปฏิเสธ · key ผูกบริษัท · เพิกถอนแล้วใช้ไม่ได้', async () => {
    await expect(createApiClient(db, A, null, { name: 'x', kind: 'tms', scopes: ['documents:post' as never] })).rejects.toThrow(/ไม่อนุญาต/u);
    const c = await createApiClient(db, A, null, { name: 'TMS', kind: 'tms', scopes: ['documents:draft', 'documents:read'] });
    expect(c.key).toMatch(/^inn_tms_/u);
    const stored = await admin((cl) => cl.query('select key_hash from public.api_client where id = $1', [c.id]));
    expect(stored.rows[0].key_hash).not.toContain(c.key);
    expect(await verifyApiKey(db, c.key)).toMatchObject({ companyId: A, scopes: ['documents:draft', 'documents:read'] });
    expect(await verifyApiKey(db, `${c.key}x`)).toBeNull();
  });
  it('draft จากภายนอก idempotent ตาม external_source + external_ref', async () => {
    const d = { doc_type: 'IV', issue_date: '2026-11-20', contact_code: 'C0031', external_source: 'tms', external_ref: 'TRIP-1', lines: [{ description: 'ค่าขนส่ง', qty: '1', unit_price: '1000.00', amount: '1000.00' }] };
    const a = await createDraftDocument(db, A, d as never);
    const b = await createDraftDocument(db, A, d as never);
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
  });
});

describe('webhooks', () => {
  it('ลงบัญชี/ยกเลิก/ปิดงวด → outbox ในธุรกรรมเดียวกัน · ลายเซ็น HMAC ตรวจได้ · บริษัทอื่นไม่ได้รับ', async () => {
    const w = await addWebhook(db, A, { url: 'https://tms.example/hook', events: ['document.posted', 'document.voided', 'period.closed'] });
    await addWebhook(db, B, { url: 'https://other.example/hook', events: ['document.posted'] });
    const c = (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', 'C0031').executeTakeFirstOrThrow())).id;
    const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c, issueDate: '2026-11-20', lines: [{ description: 'บริการ', qty: '1', unitPrice: '1000.00', vat: true }] });
    await approveDocument(db, A, mgr, iv);
    await voidDocument(db, A, mgr, iv, { reason: 'ทดสอบ' });
    await closePeriod(db, A, mgr, { fiscalYear: 2569, periodNo: 1, to: 'soft_closed' });
    const got: { url: string; headers: Record<string, string>; body: string }[] = [];
    const ok: Sender = async (url, init) => { got.push({ url, ...init }); return { ok: true, status: 200 }; };
    expect(await deliverDue(db, A, { send: ok })).toEqual({ sent: 3, retry: 0, dead: 0 });
    expect(got.map((g) => JSON.parse(g.body).type)).toEqual(['document.posted', 'document.voided', 'period.closed']);
    const g = got[0]!;
    expect(g.headers['x-innovera-signature']).toBe(`sha256=${signWebhook(w.secret, g.headers['x-innovera-timestamp']!, g.body)}`);
    expect(await deliverDue(db, B, { send: ok })).toEqual({ sent: 0, retry: 0, dead: 0 });
  });
  it('ปลายทางล่ม: ลองใหม่ 3 ครั้งตาม backoff แล้วเป็น dead-letter', async () => {
    await addWebhook(db, B, { url: 'https://down.example/hook', events: ['period.closed'] });
    await closePeriod(db, B, mgr, { fiscalYear: 2569, periodNo: 1, to: 'soft_closed' });
    const fail: Sender = async () => ({ ok: false, status: 503 });
    let t = Date.now();
    const results = [];
    for (let i = 0; i < WEBHOOK_MAX_ATTEMPTS; i++) { results.push(await deliverDue(db, B, { send: fail, now: new Date(t) })); t += 3_600_000; }
    expect(results.map((r) => r.retry + r.dead * 10)).toEqual([1, 1, 1, 10]);
    const dead = await db.withCompany(B, (tx) => tx.selectFrom('acct.webhook_delivery').select(['status', 'attempts', 'last_error']).where('event', '=', 'period.closed').execute());
    expect(dead[0]).toMatchObject({ status: 'dead', attempts: WEBHOOK_MAX_ATTEMPTS, last_error: 'HTTP 503' });
  });
});

describe('audit hash chain', () => {
  it('ทุกแถวมี hash ต่อกันเป็นสาย · บริษัทแยกสายกัน · ตรวจผ่าน', async () => {
    const r = await verifyAuditChain(db, A);
    expect(r.rows).toBeGreaterThanOrEqual(2); // void + period.close
    expect(r.ok).toBe(true);
    const first = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select(['prev_hash', 'hash']).orderBy('id').execute());
    expect(first[0]!.prev_hash).toBeNull();
    expect(first[1]!.prev_hash?.equals(first[0]!.hash!)).toBe(true);
    expect((await verifyAuditChain(db, B)).ok).toBe(true);
    // แก้ audit ย้อนหลังไม่ได้ (append-only) แม้เป็นเจ้าของตาราง
    await expect(admin((c) => c.query("select set_config('app.company_id', $1, false); update acct.audit_log set action = 'x'", [A]))).rejects.toThrow();
  });
});

describe('เพิกถอน client', () => {
  it('webhook ของ client ที่ถูกเพิกถอนไม่ได้รับ event อีก · มี audit', async () => {
    const { revokeApiClient } = await import('../src/hub.ts');
    const cl = await createApiClient(db, B, null, { name: 'TMS-B', kind: 'tms', scopes: ['webhooks:manage'] });
    await addWebhook(db, B, { url: 'https://tms-b.example/hook', events: ['period.closed'], apiClientId: cl.id });
    await revokeApiClient(db, B, cl.id, null, 'เลิกใช้');
    await closePeriod(db, B, mgr, { fiscalYear: 2569, periodNo: 2, to: 'soft_closed' });
    const rows = await db.withCompany(B, (tx) => tx.selectFrom('acct.webhook_delivery as d').innerJoin('acct.webhook_endpoint as e', (j) => j.onRef('e.id', '=', 'd.endpoint_id').onRef('e.company_id', '=', 'd.company_id'))
      .select('d.id').where('e.url', '=', 'https://tms-b.example/hook').execute());
    expect(rows).toEqual([]);
    const audit = await db.withCompany(B, (tx) => tx.selectFrom('acct.audit_log').select('action').where('entity', '=', 'api_client').orderBy('id').execute());
    expect(audit.map((a) => a.action)).toEqual(['api_client.create', 'api_client.revoke']);
  });
});
