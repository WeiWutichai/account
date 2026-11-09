// M8 Console: เข้าดูข้อมูลลูกค้าต้องมี ticket + consent ของ Owner + เวลาจำกัด + บันทึกทั้งสองฝั่ง (Gate: impersonate ต้อง consent)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consoleOverview, consoleTenants, decideAccess, endAccess, flagValue, openTicket, pendingAccessFor, requestAccess, setFlag, startAccess, withSupportAccess } from '../src/console.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import { createDb, type Db } from '../src/index.ts';
import { trialBalance } from '../src/ledger-service.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, CONSOLE_URL, freshSchema } from './helpers.ts';

let db: Db;
let reader: Db;
let A = '';
let org = '';
let staff = '';
let engineer = '';
let owner = '';
const user = (email: string) => db.withPublic(async (tx) => (await tx.insertInto('public.app_user').values({ email, display_name: email, password_hash: null }).returning('id').executeTakeFirstOrThrow()).id);

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  reader = createDb(CONSOLE_URL, 2);
  org = await createOrganization(db, '[P โลจิสติกส์]');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท P จำกัด' });
  await seedCompany(db, A);
  staff = await user('support1@innovera.co.th');
  engineer = await user('eng@innovera.co.th');
  owner = await user('owner@p.co.th');
  await db.withPublic(async (tx) => {
    await tx.insertInto('public.innovera_staff').values([{ user_id: staff, role: 'support' }, { user_id: engineer, role: 'engineer' }]).execute();
    await tx.insertInto('public.company_membership').values({ company_id: A, user_id: owner, company_role: 'owner', approval_limit: null, permissions: null, expires_at: null, last_used_at: null }).execute();
  });
}, 120_000);
afterAll(async () => { await db.close(); await reader.close(); });

describe('consent ก่อนเข้าดู (ConsoleSupport)', () => {
  let ticket = '';
  let access = '';
  it('ไม่มี consent = เข้าดูไม่ได้ · support ขอสิทธิ์เขียนไม่ได้ · ขอได้ไม่เกิน 60 นาที', async () => {
    ticket = (await openTicket(db, staff, { orgId: org, companyId: A, subject: 'statement นำเข้าแล้วไม่จับคู่' })).id;
    await expect(requestAccess(db, { userId: staff, role: 'support' }, { ticketId: ticket, reason: 'ดูกระทบยอด', scope: 'กระทบยอดธนาคาร', minutes: 60, write: true })).rejects.toThrow(/engineer/u);
    await expect(requestAccess(db, { userId: staff, role: 'support' }, { ticketId: ticket, reason: 'x', scope: 'y', minutes: 90 as never })).rejects.toThrow(/60 นาที/u);
    access = (await requestAccess(db, { userId: staff, role: 'support' }, { ticketId: ticket, reason: 'ดูหน้ากระทบยอดธนาคารและ statement ที่นำเข้า พ.ย. 2569', scope: 'กระทบยอดธนาคาร, นำเข้า statement', minutes: 30 })).id;
    await expect(withSupportAccess(db, { userId: staff }, access, 'งบทดลอง', async () => 1)).rejects.toThrow(/หมดเวลาหรือยังไม่เริ่ม/u);
    await expect(startAccess(db, { userId: staff }, access)).rejects.toThrow(/ยังไม่ได้รับ consent/u);
    expect((await pendingAccessFor(db, A)).map((p) => p.status)).toEqual(['pending']);
  });
  it('อนุมัติได้เฉพาะ Owner ของบริษัท · อนุมัติแล้วเริ่มเซสชันได้เฉพาะผู้ขอ', async () => {
    await expect(decideAccess(db, A, { userId: owner, role: 'accountant' }, access, true)).rejects.toThrow(/Owner/u);
    await decideAccess(db, A, { userId: owner, role: 'owner' }, access, true);
    await expect(startAccess(db, { userId: engineer }, access)).rejects.toThrow(/ผู้ขอ/u);
    const t0 = new Date();
    const s = await startAccess(db, { userId: staff }, access, t0);
    expect(s.endsAt.getTime() - t0.getTime()).toBe(30 * 60_000);
  });
  it('เข้าดูได้ระหว่างเวลา · บันทึกทั้ง audit_console และ audit_log ของลูกค้า · หมดเวลาแล้วเข้าไม่ได้ · ปิดแล้วส่งสรุปให้ Owner', async () => {
    const tb = await withSupportAccess(db, { userId: staff }, access, 'เปิดหน้ากระทบยอดธนาคาร', (cid) => trialBalance(db, cid, { fiscalYear: 2569 }));
    expect(Array.isArray(tb)).toBe(true);
    await expect(withSupportAccess(db, { userId: engineer }, access, 'แอบดู', async () => 1)).rejects.toThrow(/consent/u);
    const consoleLog = await db.withPublic((tx) => tx.selectFrom('public.audit_console').select(['action', 'consent_ref']).where('access_id', '=', access).orderBy('id').execute());
    expect(consoleLog.map((l) => l.action)).toEqual(['support.request_access', 'support.consent_granted', 'support.view']);
    const custLog = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select('action').where('entity', '=', 'support_access').orderBy('id').execute());
    expect(custLog.map((l) => l.action)).toEqual(['support.consent_granted', 'support.view']);
    await expect(withSupportAccess(db, { userId: staff }, access, 'หลังหมดเวลา', async () => 1, new Date(Date.now() + 31 * 60_000))).rejects.toThrow(/หมดเวลา/u);
    await endAccess(db, { userId: staff }, access);
    const mail = await db.withPublic((tx) => tx.selectFrom('public.outbox_email').select('template').where('to_email', '=', 'owner@p.co.th').orderBy('id').execute());
    expect(mail.map((m) => m.template)).toEqual(['support_access_request', 'support_access_summary']);
  });
  it('Owner ปฏิเสธ → เริ่มเซสชันไม่ได้', async () => {
    const a = (await requestAccess(db, { userId: staff, role: 'support' }, { ticketId: ticket, reason: 'ดูเพิ่ม', scope: 'รายงาน', minutes: 30 })).id;
    await decideAccess(db, A, { userId: owner, role: 'owner' }, a, false);
    await expect(startAccess(db, { userId: staff }, a)).rejects.toThrow(/consent/u);
  });
});

describe('ภาพรวม / องค์กร / flags', () => {
  it('อ่านข้ามบริษัทด้วย console_reader', async () => {
    const o = await consoleOverview(reader);
    expect(o.counts).toMatchObject({ orgs: 1, companies: 1, staff: 2, access_active: 0 });
    const t = await consoleTenants(reader);
    expect(t[0]).toMatchObject({ name: '[P โลจิสติกส์]', companies: 1 });
  });
  it('feature flag: บริษัท > องค์กร > global · บันทึกใน audit_console', async () => {
    await setFlag(db, engineer, { key: 'etax', scope: 'global', value: false });
    await setFlag(db, engineer, { key: 'etax', scope: 'company', targetId: A, value: true });
    expect(await flagValue(db, 'etax', A)).toBe(true);
    expect(await flagValue(db, 'missing', A)).toBeNull();
  });
});
