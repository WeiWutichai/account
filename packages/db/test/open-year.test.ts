// เปิดปีบัญชี + แปลงเอกสารซ้ำไม่สร้างร่างซ้ำ — 2 ปัญหาที่พบจากการทดสอบกับนักบัญชี 11/11/2569 (production)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openFiscalYear } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { approveDocument, convertDocument, saveSalesDraft } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

const mgr = { userId: null, role: 'accounting_manager' as const };
let db: Db;
let A = '';
const periods = (y: number) => db.withCompany(A, (tx) => tx.selectFrom('acct.period').select(['period_no', 'starts_on', 'ends_on']).where('fiscal_year', '=', y).orderBy('period_no').execute());

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A, 2570, { sample: true }); // เหมือนบริษัทใหม่ที่เริ่มใช้ระบบ 1/1/2570 (ค่าตั้งต้นของหน้าสร้างบริษัท)
});
afterAll(async () => { await db.close(); });

describe('เปิดปีบัญชี', () => {
  it('บริษัทเริ่มใช้ 2570 → เปิดปี 2569 ได้ 14 งวด (0 ยกมา · 1–12 · 13 ปิดปี) และเปิดซ้ำไม่สร้างเพิ่ม', async () => {
    expect(await periods(2569)).toHaveLength(0);
    expect(await openFiscalYear(db, A, mgr, 2569)).toEqual({ fiscalYear: 2569, created: 14 });
    const p = await periods(2569);
    expect(p).toHaveLength(14);
    expect(String(p.find((x) => x.period_no === 11)?.starts_on)).toContain('2026-11-01');
    expect(await openFiscalYear(db, A, mgr, 2569)).toEqual({ fiscalYear: 2569, created: 0 });
  });
  it('เอกสารลงวันที่ปีที่เปิดใหม่อนุมัติลงบัญชีได้', async () => {
    const c = (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('kind', '=', 'customer').executeTakeFirstOrThrow())).id;
    const id = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c, issueDate: '2026-11-11', lines: [{ description: 'ขายสินค้า', qty: '1', unitPrice: '1000.00', vat: true }] });
    const r = await approveDocument(db, A, mgr, id);
    expect(r.journalNo).toBeTruthy();
  });
  it('ห้ามกระโดดเว้นปี · ห้ามบทบาทที่ไม่ใช่เจ้าของ/ผู้จัดการ · ห้ามปีที่ไม่ใช่ พ.ศ.', async () => {
    await expect(openFiscalYear(db, A, mgr, 2573)).rejects.toThrow('ปีที่ติดกับปีที่มีอยู่');
    await expect(openFiscalYear(db, A, { userId: null, role: 'accountant' }, 2571)).rejects.toThrow('เฉพาะเจ้าของ/ผู้จัดการบัญชี');
    await expect(openFiscalYear(db, A, mgr, 2027)).rejects.toThrow('ปี พ.ศ.');
    expect(await openFiscalYear(db, A, mgr, 2571)).toEqual({ fiscalYear: 2571, created: 14 });
  });
});

describe('แปลงเอกสารซ้ำ', () => {
  it('กดแปลง QO → SO หลายครั้ง ได้ร่างใบเดิม · หลังร่างนั้นอนุมัติแล้วแปลงใหม่ได้ใบใหม่', async () => {
    const c = (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('kind', '=', 'customer').executeTakeFirstOrThrow())).id;
    const qo = await saveSalesDraft(db, A, mgr, { docType: 'QO', contactId: c, issueDate: '2026-11-11', lines: [{ description: 'ขายสินค้า', qty: '1', unitPrice: '1000.00', vat: true }] });
    await approveDocument(db, A, mgr, qo);
    const a = await convertDocument(db, A, mgr, qo, 'SO', { issueDate: '2026-11-11' });
    expect(await convertDocument(db, A, mgr, qo, 'SO', { issueDate: '2026-11-11' })).toBe(a);
    expect(await convertDocument(db, A, mgr, qo, 'SO', { issueDate: '2026-11-11' })).toBe(a);
    await approveDocument(db, A, mgr, a);
    const b = await convertDocument(db, A, mgr, qo, 'SO', { issueDate: '2026-11-11' });
    expect(b).not.toBe(a);
    // แปลงคนละประเภท (IV) ไม่ปนกับ SO
    expect(await convertDocument(db, A, mgr, a, 'IV', { issueDate: '2026-11-11' })).not.toBe(b);
  });
});
