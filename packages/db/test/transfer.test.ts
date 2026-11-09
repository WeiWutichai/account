// export / import รายบริษัท (ADR-001 · M3.5 restore test 1 บริษัท): ต้นทาง innovera_test → ปลายทาง innovera_test_restore
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import { exportCompany, importCompany } from '../src/company-transfer.ts';
import { createDb, type Db } from '../src/index.ts';
import { trialBalance } from '../src/ledger-service.ts';
import { migrateDown, migrateUp } from '../src/migrate.ts';
import { approveDocument, receivePayment, saveSalesDraft, voidDocument } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, CONSOLE_URL, freshSchema } from './helpers.ts';

const TARGET = process.env.TEST_RESTORE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera_test_restore';
const mgr = { userId: null, role: 'accounting_manager' as const };
let db: Db;
let target: Db;
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
  const c = (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', 'C0031').executeTakeFirstOrThrow())).id;
  const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c, issueDate: '2026-11-05', lines: [{ description: 'บริการ', qty: '1', unitPrice: '10000.00', vat: true }] });
  await approveDocument(db, A, mgr, iv);
  const rv = await receivePayment(db, A, mgr, { contactId: c, date: '2026-11-20', receiveAccount: '1100100', applications: [{ documentId: iv, applied: '10400.00', wht: '300.00' }], fee: '20.00' });
  await voidDocument(db, A, mgr, rv.id, { reason: 'ทดสอบกลับรายการ', date: '2026-11-21' });
  await receivePayment(db, A, mgr, { contactId: c, date: '2026-11-22', receiveAccount: '1100100', applications: [{ documentId: iv, applied: '10700.00' }] });
  // ปลายทางสะอาด
  const t = new pg.Client({ connectionString: TARGET });
  await t.connect();
  if ((await t.query("select to_regclass('public.company') x")).rows[0]?.x) await t.query('TRUNCATE public.company, public.organization, public.app_user CASCADE');
  await t.end();
  await migrateDown(TARGET, Number.POSITIVE_INFINITY);
  await migrateUp(TARGET);
  target = createDb(TARGET, 2);
}, 180_000);
afterAll(async () => { await db.close(); await target.close(); });

describe('backup / restore รายบริษัท', () => {
  it('export เฉพาะบริษัท ก (ไม่มีข้อมูลบริษัท ข) · import แล้วงบทดลอง จำนวนแถว เอกสาร ตรงต้นทาง', async () => {
    const dump = await exportCompany(CONSOLE_URL, A);
    expect(JSON.stringify(dump)).not.toContain(B);
    expect(dump.acct.journal!.length).toBeGreaterThanOrEqual(4); // IV, RV, RV reversal, RV ใหม่
    const counts = await importCompany(TARGET, JSON.parse(JSON.stringify(dump)));
    expect(counts['acct.journal_line']).toBe(dump.acct.journal_line!.length);
    const before = await trialBalance(db, A, { fiscalYear: 2569 });
    const after = await trialBalance(target, A, { fiscalYear: 2569 });
    expect(after).toEqual(before);
    const st = await target.withCompany(A, (tx) => tx.selectFrom('acct.document').select(['doc_no', 'status', 'journal_id']).orderBy('doc_no').execute());
    expect(st.map((x) => x.status)).toEqual(['posted', 'voided', 'posted']);
    expect(st.every((x) => x.journal_id)).toBe(true);
    // ข้อมูลที่นำเข้ายังถูกป้องกันเหมือนเดิม: journal ที่ผ่านรายการแล้วแก้ไม่ได้
    await expect(target.withCompany(A, (tx) => tx.updateTable('acct.journal').set({ description: 'แก้' }).where('status', '=', 'posted').execute())).rejects.toThrow(/ผ่านรายการแล้ว/u);
  });
  it('นำเข้าซ้ำไม่ได้ (บริษัทมีอยู่แล้ว) · โครงสร้างต่างเวอร์ชันไม่ได้', async () => {
    const dump = await exportCompany(CONSOLE_URL, A);
    await expect(importCompany(TARGET, dump)).rejects.toThrow();
    await expect(importCompany(TARGET, { ...dump, schemaVersion: '0001_public' })).rejects.toThrow(/โครงสร้างไม่ตรง/u);
  });
});
