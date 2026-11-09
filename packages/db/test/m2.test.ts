// Gate M2 ฝั่ง DB: ผ่านรายการจริง · void · สิทธิ์งวด (golden 9) · idempotency (golden 10) · นำเข้ายอดยกมาจาก Excel แล้วงบทดลองตรงต้นทาง
import ExcelJS from 'exceljs';
import { fromTuples, post, ruleByCode } from '@innovera/ledger';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { importWorkbook, TEMPLATE } from '../src/import.ts';
import { createDraftDocument, LedgerError, postJournal, trialBalance, voidJournal } from '../src/ledger-service.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/sample-company.json', import.meta.url), 'utf8'));
let db: Db;
let A: string;
let org: string;

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
});
afterAll(() => db.close());

describe('ผ่านรายการ golden 1 ลง DB จริง', () => {
  let id = '';
  it('ได้เลขที่ JV2611-0001 · งบทดลองตรง', async () => {
    const iv = fx.documents['IV2611-0052'];
    const lines = post(ruleByCode('Service[IV]'), { docType: 'IV', amounts: { grand_total: iv.grand_total, net: iv.subtotal, vat: iv.vat } });
    const r = await postJournal(db, A, { date: '2026-11-04', lines, role: 'accountant', book: 'SJ', prefix: 'JV' });
    id = r.id;
    expect(r.journalNo).toBe('JV2611-0001');
    const tb = await trialBalance(db, A, { fiscalYear: 2569 });
    expect(tb).toEqual([
      { account: '1130100', debit: '10700.00', credit: '0.00', balance: '10700.00' },
      { account: '2150400', debit: '0.00', credit: '700.00', balance: '-700.00' },
      { account: '4100200', debit: '0.00', credit: '10000.00', balance: '-10000.00' },
    ]);
  });
  it('เลขที่ถัดไปต่อเนื่อง JV2611-0002', async () => {
    const r = await postJournal(db, A, { date: '2026-11-05', lines: fromTuples([['Dr', '5401100', '20.00'], ['Cr', '1100100', '20.00']]), role: 'accountant' });
    expect(r.journalNo).toBe('JV2611-0002');
  });
  it('void → reversal เลขที่เดิม+R · ต้นฉบับ voided · งบทดลองหักล้าง · มี audit', async () => {
    const rev = await voidJournal(db, A, id, { date: '2026-11-30', role: 'accounting_manager', reason: 'ออกซ้ำ' });
    expect(rev.journalNo).toBe('JV2611-0001R');
    const tb = await trialBalance(db, A, { fiscalYear: 2569 });
    expect(tb.filter((r) => ['1130100', '2150400', '4100200'].includes(r.account)).every((r) => r.balance === '0.00')).toBe(true);
    await expect(voidJournal(db, A, id, { date: '2026-11-30', role: 'accounting_manager', reason: 'ซ้ำ' })).rejects.toThrow(/voided/u);
    const audit = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select('action').where('entity_id', '=', id).execute());
    expect(audit.map((a) => a.action)).toEqual(['journal.void']);
  });
  it('void ต้องมีเหตุผล', async () => {
    await expect(voidJournal(db, A, id, { date: '2026-11-30', role: 'accounting_manager', reason: ' ' })).rejects.toThrow(LedgerError);
  });
});

describe('golden 9 บน DB: สิทธิ์ตามสถานะงวด', () => {
  const lines = fromTuples([['Dr', '5401100', '10.00'], ['Cr', '1100100', '10.00']]);
  it('soft_closed: accountant ถูกปฏิเสธ · manager ผ่าน', async () => {
    await db.withCompany(A, (tx) => tx.updateTable('acct.period').set({ status: 'soft_closed' }).where('period_no', '=', 10).execute());
    await expect(postJournal(db, A, { date: '2026-10-15', lines, role: 'accountant' })).rejects.toThrow(/ปิดอ่อน/u);
    await expect(postJournal(db, A, { date: '2026-10-15', lines, role: 'accounting_manager' })).resolves.toMatchObject({ journalNo: 'JV2610-0001' });
  });
  it('hard_closed: ทุกคนถูกปฏิเสธ (ชั้นแอป + ชั้น DB)', async () => {
    await db.withCompany(A, (tx) => tx.updateTable('acct.period').set({ status: 'hard_closed' }).where('period_no', '=', 9).execute());
    await expect(postJournal(db, A, { date: '2026-09-15', lines, role: 'owner' })).rejects.toThrow(/ปิดแข็ง/u);
  });
  it('วันที่ไม่มีงวด → error', async () => {
    await expect(postJournal(db, A, { date: '2030-01-01', lines, role: 'owner' })).rejects.toThrow(/ไม่มีงวด/u);
  });
});

describe('golden 10: idempotency ของเอกสารจากภายนอก', () => {
  const draft = { doc_type: 'AP', issue_date: '2026-11-28', contact_code: 'V0102', lines: [{ description: 'ค่าขนส่งผู้รับเหมา', amount: '600000.00', account_code: '5301300' }],
    external_source: 'tms', external_ref: 'SUB-BILL-7701' };
  it('ส่งซ้ำ → คืนตัวเดิม ไม่สร้างใหม่ · สถานะร่าง', async () => {
    const a = await createDraftDocument(db, A, draft);
    const b = await createDraftDocument(db, A, draft);
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const docs = await db.withCompany(A, (tx) => tx.selectFrom('acct.document').select(['status']).where('external_ref', '=', 'SUB-BILL-7701').execute());
    expect(docs).toEqual([{ status: 'draft' }]);
  });
  it('external_ref เดียวกันคนละบริษัท → ไม่ชนกัน', async () => {
    const B = await createCompany(db, { orgId: org, nameTh: 'บริษัท ข จำกัด' });
    await seedCompany(db, B);
    expect((await createDraftDocument(db, B, draft)).created).toBe(true);
  });
});

describe('นำเข้ายอดยกมาจาก Excel (A4) · บริษัท C ใน fixtures', () => {
  const ob = fx.opening_balance_2569_12_31_company_c;
  // งบทดลองยกมาครบชุดจากแบบร่าง ScreenOpeningBalance (fixtures lines_full)
  const full: { account: string; name: string; dr?: string; cr?: string }[] = ob.lines_full;
  const rows: [string, string, string][] = full.map((l) => [l.account, l.dr ?? '', l.cr ?? '']);
  const knownCodes = new Set((fx.chart_of_accounts as { code: string }[]).map((a) => a.code));
  const newAccounts = full.filter((l) => !knownCodes.has(l.account));
  const arItems = Array.from({ length: 14 }, (_, i) => [`C9${String(i).padStart(3, '0')}`, `OB-IV-${i + 1}`, '2026-12-31', '', i < 13 ? '43700.00' : String((612400 - 43700 * 13).toFixed(2))]);
  const apItems = Array.from({ length: 9 }, (_, i) => [`V9${String(i).padStart(3, '0')}`, `OB-AP-${i + 1}`, '2026-12-31', '', i < 8 ? '43000.00' : String((388650 - 43000 * 8).toFixed(2))]);

  async function workbook(opts: { breakBalance?: boolean; badAccount?: boolean } = {}) {
    const wb = new ExcelJS.Workbook();
    const ws = (name: keyof typeof TEMPLATE, data: (string | number)[][]) => { const s = wb.addWorksheet(name); s.addRow([...TEMPLATE[name]]); data.forEach((r) => s.addRow(r)); };
    ws('ผังบัญชี', newAccounts.map((l) => [l.account, l.name, l.account.startsWith('2') ? 'หนี้สิน' : l.account.startsWith('3') ? 'ทุน' : 'สินทรัพย์', '']));
    ws('คู่ค้า', [...arItems.map((r) => [r[0]!, `ลูกค้า ${r[0]}`, 'ลูกค้า', '', '']), ...apItems.map((r) => [r[0]!, `ผู้ขาย ${r[0]}`, 'ผู้ขาย', '', ''])]);
    // ใส่ตัวเลขเป็น number แบบที่ Excel เก็บจริง
    ws('ยอดยกมา', rows.map(([a, d, c], i) => [opts.badAccount && i === 0 ? '9999999' : a, d ? Number(d) + (opts.breakBalance && i === 0 ? 1 : 0) : '', c ? Number(c) : '']));
    ws('ลูกหนี้คงค้าง', arItems.map((r) => [r[0]!, r[1]!, r[2]!, r[3]!, Number(r[4])]));
    ws('เจ้าหนี้คงค้าง', apItems.map((r) => [r[0]!, r[1]!, r[2]!, r[3]!, Number(r[4])]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  let C = '';
  beforeAll(async () => {
    C = await createCompany(db, { orgId: org, nameTh: 'บริษัท ค จำกัด' });
    await seedCompany(db, C, 2570); // ปีบัญชี 2570 · ยอดยกมา ณ 31/12/2569 ลงวันแรกของปี
  });

  it('ไฟล์ไม่ดุล → ไม่บันทึกอะไรเลย พร้อมข้อความ', async () => {
    const r = await importWorkbook(db, C, await workbook({ breakBalance: true }), { openingDate: '2027-01-01', role: 'owner' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/ไม่ดุล/u);
    const n = await db.withCompany(C, (tx) => tx.selectFrom('acct.journal').select('id').execute());
    expect(n).toEqual([]);
  });
  it('บัญชีที่ไม่มีในผัง → แจ้งเลขแถว', async () => {
    const r = await importWorkbook(db, C, await workbook({ badAccount: true }), { openingDate: '2027-01-01', role: 'owner' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ sheet: 'ยอดยกมา', row: 2 });
  });
  it('นำเข้าสำเร็จ → งบทดลองตรงไฟล์ต้นทาง · ยอดรวม 6,317,920.55 · รายใบ = บัญชีคุม', async () => {
    const r = await importWorkbook(db, C, await workbook(), { openingDate: '2027-01-01', role: 'owner' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.counts).toMatchObject({ openItems: 23, openingLines: 11 });
    const tb = await trialBalance(db, C, { fiscalYear: 2570 });
    const dr = tb.reduce((s, x) => s + Number(x.debit), 0);
    expect(dr.toFixed(2)).toBe(ob.trial_balance_total);
    for (const [acc, d, c] of rows) {
      expect(tb.find((x) => x.account === acc)).toMatchObject({ debit: d ? Number(d).toFixed(2) : '0.00', credit: c ? Number(c).toFixed(2) : '0.00' });
    }
    const ar = await db.withCompany(C, (tx) => tx.selectFrom('acct.document').select('grand_total').where('doc_type', '=', 'OB-AR').execute());
    expect(ar.reduce((s, x) => s + Number(x.grand_total), 0).toFixed(2)).toBe('612400.00');
  });
});
