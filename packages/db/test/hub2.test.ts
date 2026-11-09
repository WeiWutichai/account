// กลุ่ม A (migration 0016): ชื่อผู้กระทำ · audit ครอบคลุม + ช่องทาง/IP/client · แบ่งหน้า audit · สถิติ API/MCP · จัดการ client (เพิกถอน/ระงับ/แก้ scope)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePeriod } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import {
  addWebhook, apiClientActivity, auditLog, createApiClient, listApiClients, makeApiClientReadOnly, recordApiCall, recordAudit, resumeApiClient, revokeApiClient,
  suspendApiClient, syncContacts, updateApiClientScopes, verifyApiKey, verifyAuditChain,
} from '../src/hub.ts';
import { withAuditContext, type Db } from '../src/index.ts';
import { createDraftDocument } from '../src/ledger-service.ts';
import { companySettings, saveCompanySettings } from '../src/master.ts';
import { approveDocument, getDocument, saveSalesDraft, submitDocument } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { admin, appDb, freshSchema } from './helpers.ts';

let db: Db;
let A = '';
let B = '';
let wei = '';
let mgrId = '';
let contactId = '';
const draft = (ref: string) => ({ doc_type: 'IV', issue_date: '2026-11-20', contact_code: 'C0031', external_source: 'tms', external_ref: ref,
  lines: [{ description: 'ค่าขนส่ง', qty: '1', unit_price: '1000.00', amount: '1000.00' }] });

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  B = await createCompany(db, { orgId: org, nameTh: 'บริษัท ข จำกัด' });
  await seedCompany(db, A);
  await seedCompany(db, B);
  await admin(async (c) => {
    wei = (await c.query<{ id: string }>("insert into public.app_user (email, display_name) values ('wei@innovera.test', 'Wei') returning id")).rows[0]!.id;
    mgrId = (await c.query<{ id: string }>("insert into public.app_user (email, display_name) values ('mgr@innovera.test', 'ผู้จัดการบัญชี') returning id")).rows[0]!.id;
    await c.query("insert into public.company_membership (company_id, user_id, company_role) values ($1, $2, 'owner'), ($1, $3, 'accounting_manager')", [A, wei, mgrId]);
  });
  contactId = (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', 'C0031').executeTakeFirstOrThrow())).id;
}, 120_000);
afterAll(() => db.close());

describe('ชื่อผู้กระทำ + audit ของเอกสาร', () => {
  it('getDocument ส่ง actor_name · สร้าง/แก้ร่าง/ส่งอนุมัติ/อนุมัติ(ผ่านรายการ) ลง audit log พร้อมช่องทาง/IP จาก AuditContext', async () => {
    const mgr = { userId: mgrId, role: 'accounting_manager' as const };
    const iv = await withAuditContext({ channel: 'web', ip: '203.0.113.7' }, async () => {
      const id = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId, issueDate: '2026-11-20', lines: [{ description: 'บริการ', qty: '1', unitPrice: '1000.00', vat: true }] });
      await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId, issueDate: '2026-11-20', lines: [{ description: 'บริการ', qty: '2', unitPrice: '1000.00', vat: true }] }, id);
      await submitDocument(db, A, mgr, id);
      await approveDocument(db, A, mgr, id);
      return id;
    });
    const d = await getDocument(db, A, iv);
    expect(d?.events.map((e) => [e.event, e.actor_name])).toEqual([['created', 'ผู้จัดการบัญชี'], ['edited', 'ผู้จัดการบัญชี'], ['submitted', 'ผู้จัดการบัญชี'], ['posted', 'ผู้จัดการบัญชี']]);
    expect(d?.created_by_name ?? 'ผู้จัดการบัญชี').toBe('ผู้จัดการบัญชี');
    const rows = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select(['action', 'channel', 'ip', 'actor_id']).where('entity', '=', 'document').where('entity_id', '=', iv).orderBy('id').execute());
    expect(rows.map((r) => r.action)).toEqual(['document.create', 'document.edit_draft', 'document.submit', 'document.post']);
    expect(rows.every((r) => r.channel === 'web' && r.ip === '203.0.113.7' && r.actor_id === mgrId)).toBe(true);
  });
  it('ไม่มี AuditContext → ช่องทาง system · ค่าไม่รั่วข้าม transaction (set_config แบบ local)', async () => {
    await withAuditContext({ channel: 'api', ip: '198.51.100.1' }, () => recordAudit(db, A, { actorId: null, action: 'test.ctx', entity: 'x', entityId: '1' }));
    await recordAudit(db, A, { actorId: null, action: 'test.noctx', entity: 'x', entityId: '2' });
    const r = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select(['action', 'channel', 'ip']).where('action', 'like', 'test.%').orderBy('id').execute());
    expect(r).toEqual([{ action: 'test.ctx', channel: 'api', ip: '198.51.100.1' }, { action: 'test.noctx', channel: 'system', ip: null }]);
  });
  it('hash chain ตรวจผ่านทั้งแถวเก่า (channel = NULL ก่อน 0016) และแถวใหม่ · แก้ channel/ip ย้อนหลังแล้วตรวจไม่ผ่าน', async () => {
    await admin(async (c) => {
      await c.query("select set_config('app.company_id', $1, false)", [A]);
      await c.query("insert into acct.audit_log (company_id, action, entity, entity_id, channel, ip) values ($1, 'legacy', 'x', '3', null, null)", [A]);
    });
    await recordAudit(db, A, { actorId: wei, action: 'test.after', entity: 'x', entityId: '4' });
    expect(await verifyAuditChain(db, A)).toMatchObject({ ok: true });
    // จำลองการแก้ IP ย้อนหลัง (ปิด trigger append-only ชั่วคราวใน DB ทดสอบ)
    await admin(async (c) => {
      await c.query("select set_config('app.company_id', $1, false)", [A]);
      await c.query('alter table acct.audit_log disable trigger audit_log_append_only');
      await c.query("update acct.audit_log set ip = '10.0.0.1' where company_id = $1 and action = 'test.ctx'", [A]);
      await c.query('alter table acct.audit_log enable trigger audit_log_append_only');
    });
    expect(await verifyAuditChain(db, A)).toMatchObject({ ok: false });
  });
});

describe('GET /v1/audit — แบ่งหน้า + จำนวนทั้งหมด + ตัวกรอง', () => {
  it('limit/offset/total · หมวด · ผู้กระทำ · ค้นชื่อผู้ใช้ · ชื่อผู้กระทำ', async () => {
    for (let i = 0; i < 5; i++) await recordAudit(db, B, { actorId: wei, action: 'period.close', entity: 'period', entityId: `2569-${i + 1}` });
    await recordAudit(db, B, { actorId: null, action: 'support.view', entity: 'support_access', entityId: 'x' });
    const p1 = await auditLog(db, B, { limit: 2 });
    expect(p1.count).toBe(6);
    expect(p1.rows).toHaveLength(2);
    const p3 = await auditLog(db, B, { limit: 2, offset: 4 });
    expect(p3.rows.map((r) => r.id)).not.toContain(p1.rows[0]!.id);
    expect((await auditLog(db, B, { important: true })).count).toBe(5);
    expect((await auditLog(db, B, { category: 'period' })).count).toBe(5);
    expect((await auditLog(db, B, { category: 'api' })).count).toBe(0);
    const byName = await auditLog(db, B, { q: 'wei' });
    expect(byName.count).toBe(5);
    expect(byName.rows[0]).toMatchObject({ actor_name: 'Wei', action: 'period.close' });
    expect((await auditLog(db, B, { actor: wei })).count).toBe(5);
    expect((await auditLog(db, B, { actor: 'system' })).count).toBe(1);
    expect(p1.actors.map((a) => a.name).sort()).toEqual(['Wei', 'ระบบ']);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    expect((await auditLog(db, B, { from: today, to: today })).count).toBe(6);
    expect((await auditLog(db, B, { from: '2000-01-01', to: '2000-01-31' })).count).toBe(0);
  });
});

describe('สถิติ API/MCP + สิ่งที่ client สร้าง', () => {
  it('api_call นับ 7 วัน/ถูกปฏิเสธ · ร่าง/คู่ค้าผูก client · audit "สร้างเอกสาร (API)" มีช่องทาง api + client', async () => {
    const c = await createApiClient(db, A, wei, { name: 'TMS', kind: 'tms', scopes: ['documents:draft', 'documents:read', 'contacts:draft'] });
    const doc = await withAuditContext({ channel: 'api', ip: '198.51.100.9', clientId: c.id }, async () => {
      await syncContacts(db, A, [{ tax_id: '0105559999999', name: 'ผู้ขายใหม่', kind: 'vendor' }], c.id);
      return createDraftDocument(db, A, draft('TRIP-9') as never, c.id);
    });
    await recordApiCall(db, A, { clientId: c.id, kind: 'api', tool: 'POST /ext/v1/documents', status: 'ok', documentId: doc.id });
    await recordApiCall(db, A, { clientId: c.id, kind: 'mcp', tool: 'post_document', status: 'denied' });
    const list = await listApiClients(db, A);
    expect(list.find((x) => x.id === c.id)).toMatchObject({ created_by_name: 'Wei', calls_7d: 2, denied_7d: 1, drafts_pending: 1, status: 'active' });
    const act = await apiClientActivity(db, A, c.id);
    expect(act.drafts.map((d) => d.id)).toEqual([doc.id]);
    expect(act.contacts).toBe(1);
    expect(act.recent[0]).toMatchObject({ tool: 'post_document', status: 'denied', client_name: 'TMS' });
    expect(act.recent[1]).toMatchObject({ document_id: doc.id, doc_status: 'draft' });
    expect(act.last24h).toEqual(expect.arrayContaining([{ tool: 'post_document', status: 'denied', n: 1 }]));
    const g = await getDocument(db, A, doc.id);
    expect(g?.created_by_client_name).toBe('TMS');
    const audit = await auditLog(db, A, { category: 'document', actor: `client:${c.id}` });
    expect(audit.rows[0]).toMatchObject({ action: 'document.create', channel: 'api', ip: '198.51.100.9', api_client_id: c.id, client_name: 'TMS', client_kind: 'tms' });
    // บริษัทอื่นไม่เห็นสถิติ (RLS)
    expect((await apiClientActivity(db, B)).recent).toEqual([]);
  });
});

describe('จัดการ client', () => {
  it('เพิกถอน: เก็บผู้เพิกถอน + เหตุผล · แจ้ง Owner + ผู้อนุญาตเดิมทาง outbox · ร่างที่ไม่คงไว้ถูกลบ (เฉพาะของ client นี้) · เพิกถอนซ้ำไม่ได้', async () => {
    const c = await createApiClient(db, A, mgrId, { name: 'OCR', kind: 'mcp', scopes: ['documents:draft'] });
    const d = await createDraftDocument(db, A, draft('OCR-1') as never, c.id);
    const keep = await createDraftDocument(db, A, draft('OCR-2') as never, c.id);
    const other = await createDraftDocument(db, A, draft('OTHER-1') as never, null);
    const r = await revokeApiClient(db, A, c.id, wei, 'เลิกใช้งาน', { notify: true, deleteDraftIds: [d.id, other.id] });
    expect(r.deletedDrafts).toBe(1);
    expect(await getDocument(db, A, d.id)).toBeNull();
    expect(await getDocument(db, A, keep.id)).not.toBeNull();
    expect(await getDocument(db, A, other.id)).not.toBeNull();
    const row = (await listApiClients(db, A)).find((x) => x.id === c.id);
    expect(row).toMatchObject({ revoked_by_name: 'Wei', revoke_reason: 'เลิกใช้งาน' });
    const mail = await admin((cl) => cl.query("select to_email from public.outbox_email where template = 'api_client_revoked' order by to_email"));
    expect(mail.rows.map((m) => m.to_email)).toEqual(['mgr@innovera.test', 'wei@innovera.test']);
    await expect(revokeApiClient(db, A, c.id, wei, 'ซ้ำ')).rejects.toThrow(/เพิกถอนแล้ว/u);
    const a = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select(['action', 'after']).where('entity_id', '=', c.id).orderBy('id').execute());
    expect(a.map((x) => x.action)).toEqual(['api_client.create', 'api_client.revoke']);
    expect(a[1]!.after).toMatchObject({ reason: 'เลิกใช้งาน', notify: true, deleted_drafts: 1 });
  });
  it('ระงับชั่วคราว → key ใช้ไม่ได้ + webhook ไม่ส่ง · เปิดกลับ → ใช้ได้ · ครบกำหนดแล้วเปิดเอง', async () => {
    const c = await createApiClient(db, B, wei, { name: 'Claude', kind: 'mcp', scopes: ['documents:read', 'documents:draft', 'webhooks:manage'] });
    await addWebhook(db, B, { url: 'https://claude.example/hook', events: ['period.closed'], apiClientId: c.id });
    await suspendApiClient(db, B, c.id, wei, { days: 7, reason: 'สงสัยการเข้าถึงผิดปกติ' });
    expect(await verifyApiKey(db, c.key)).toBeNull();
    expect((await listApiClients(db, B)).find((x) => x.id === c.id)?.status).toBe('suspended');
    await closePeriod(db, B, { userId: null, role: 'accounting_manager' }, { fiscalYear: 2569, periodNo: 1, to: 'soft_closed' });
    const sent = await db.withCompany(B, (tx) => tx.selectFrom('acct.webhook_delivery as d').innerJoin('acct.webhook_endpoint as e', (j) => j.onRef('e.id', '=', 'd.endpoint_id').onRef('e.company_id', '=', 'd.company_id'))
      .select('d.id').where('e.url', '=', 'https://claude.example/hook').execute());
    expect(sent).toEqual([]);
    expect(await verifyApiKey(db, c.key, new Date(Date.now() + 8 * 86_400_000))).toMatchObject({ id: c.id });
    expect((await listApiClients(db, B)).find((x) => x.id === c.id)?.status).toBe('active');
    await suspendApiClient(db, B, c.id, wei);
    await resumeApiClient(db, B, c.id, wei);
    expect(await verifyApiKey(db, c.key)).toMatchObject({ id: c.id });
    const acts = await db.withCompany(B, (tx) => tx.selectFrom('acct.audit_log').select('action').where('entity_id', '=', c.id).orderBy('id').execute());
    expect(acts.map((x) => x.action)).toEqual(['api_client.create', 'api_client.suspend', 'api_client.suspend', 'api_client.resume']);
  });
  it('แก้ scope ได้เฉพาะที่อนุญาต (ไม่มี post/pay/periods/users/settings) · ลดเป็นอ่านอย่างเดียว', async () => {
    const c = await createApiClient(db, B, wei, { name: 'X', kind: 'custom', scopes: ['documents:read', 'documents:draft', 'contacts:draft', 'ledger:read'] });
    for (const bad of ['documents:post', 'payments:write', 'periods:close', 'users:write', 'settings:write']) {
      await expect(updateApiClientScopes(db, B, c.id, wei, ['documents:read', bad])).rejects.toThrow(/ไม่อนุญาต/u);
    }
    await expect(updateApiClientScopes(db, B, c.id, wei, [])).rejects.toThrow();
    expect(await updateApiClientScopes(db, B, c.id, wei, ['documents:read', 'documents:draft'])).toEqual({ scopes: ['documents:read', 'documents:draft'] });
    expect(await makeApiClientReadOnly(db, B, c.id, wei, 'เปลี่ยนผู้รับผิดชอบ')).toEqual({ scopes: ['documents:read'] });
    expect((await verifyApiKey(db, c.key))?.scopes).toEqual(['documents:read']);
    // CHECK ใน DB กันอีกชั้น
    await expect(db.withPublic((tx) => tx.updateTable('public.api_client').set({ scopes: ['documents:post'] }).where('id', '=', c.id).execute())).rejects.toThrow();
  });
});

describe('บังคับ 2FA ทุกผู้ใช้ (ScreenSettings)', () => {
  it('เปิด enforce2fa → สมาชิกทุกคน require_2fa = true · ปิดแล้วไม่คืนค่ารายคน', async () => {
    await admin((c) => c.query('update public.company_membership set require_2fa = false where company_id = $1', [A]));
    const s = await companySettings(db, A);
    const input = { nameTh: 'บริษัท ก จำกัด', branchCode: '00000', businessType: 'service' as const, vatRegistered: true, serviceTaxPoint: 'on_payment' as const };
    await saveCompanySettings(db, A, wei, { ...input, defaults: { ...s.defaults, enforce2fa: false } });
    const off = await admin((c) => c.query<{ r: boolean }>('select require_2fa r from public.company_membership where company_id = $1', [A]));
    expect(off.rows.every((x) => !x.r)).toBe(true);
    await saveCompanySettings(db, A, wei, { ...input, defaults: { ...s.defaults, enforce2fa: true } });
    const on = await admin((c) => c.query<{ r: boolean }>('select require_2fa r from public.company_membership where company_id = $1', [A]));
    expect(on.rows.length).toBe(2);
    expect(on.rows.every((x) => x.r)).toBe(true);
    expect((await companySettings(db, A)).defaults.enforce2fa).toBe(true);
  });
});
