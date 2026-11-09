// read model + ร่าง JV ของหน้า B1–B4
import { fromTuples } from '@innovera/ledger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { postJournal } from '../src/ledger-service.ts';
import { accountLedger, companyContext, listAccounts, listTemplates, postJournalDraft, saveJournalDraft, saveTemplate } from '../src/queries.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

let db: Db;
let A: string;
beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บจก. ตัวอย่าง' });
  await seedCompany(db, A);
  await postJournal(db, A, { date: '2026-10-05', lines: fromTuples([['Dr', '1100100', '1000.00'], ['Cr', '4100100', '1000.00']]), role: 'accountant' });
  await postJournal(db, A, { date: '2026-11-04', lines: fromTuples([['Dr', '1100100', '500.00'], ['Cr', '4100100', '500.00']]), role: 'accountant' });
  await postJournal(db, A, { date: '2026-11-20', lines: fromTuples([['Dr', '5401100', '20.00'], ['Cr', '1100100', '20.00']]), role: 'accountant' });
});
afterAll(() => db.close());

describe('companyContext', () => {
  it('ชื่อ สาขา และงวดปัจจุบัน', async () => {
    expect(await companyContext(db, A, '2026-11-30')).toMatchObject({ name: 'บจก. ตัวอย่าง', branch: 'สำนักงานใหญ่', period: { fiscal_year: 2569, period_no: 11, status: 'open' } });
  });
});

describe('listAccounts (ScreenCOA)', () => {
  it('ยอดคงเหลือถึงงวด · หมวดย่อย · ข้อความผูกกับ · มีรายการแล้ว', async () => {
    const rows = await listAccounts(db, A, { fiscalYear: 2569, upToPeriod: 11 });
    expect(rows.find((r) => r.code === '1100100')).toMatchObject({ balance: '1480.00', category: 'สินทรัพย์หมุนเวียน', has_activity: true });
    expect(rows.find((r) => r.code === '1130100')).toMatchObject({ binding: 'บัญชีคุม · ต้องระบุคู่ค้า', is_control: true, has_activity: false, balance: null });
    expect(rows.find((r) => r.code === '2150100')!.binding).toBe('รายงานภาษีขาย · ภ.พ.30');
  });
  it('ถึงงวด 10 ไม่รวมรายการ พ.ย.', async () => {
    expect((await listAccounts(db, A, { fiscalYear: 2569, upToPeriod: 10 })).find((r) => r.code === '1100100')!.balance).toBe('1000.00');
  });
});

describe('accountLedger (ScreenLedger)', () => {
  it('ยอดยกมา + ยอดคงเหลือสะสม + ยอดยกไป', async () => {
    const l = await accountLedger(db, A, { account: '1100100', from: '2026-11-01', to: '2026-11-30' });
    expect(l.opening).toBe('1000.00');
    expect(l.rows.map((r) => r.balance)).toEqual(['1500.00', '1480.00']);
    expect(l).toMatchObject({ total_debit: '500.00', total_credit: '20.00', closing: '1480.00' });
  });
});

describe('ร่าง JV (ScreenJournal)', () => {
  const lines = [
    { account_code: '5303100', memo: 'ค่าไฟ พ.ย.', debit: '8500.00' },
    { account_code: '5303100', memo: 'ค่าน้ำ พ.ย.', debit: '1200.00' },
    { account_code: '2150200', memo: 'ค้างจ่ายสาธารณูปโภค', credit: '9700.00' },
  ];
  it('บันทึกร่าง → ลงบัญชีได้เลข JV + กลับรายการอัตโนมัติวันที่ 1 งวดถัดไป', async () => {
    const id = await saveJournalDraft(db, A, { date: '2026-11-30', book: 'GJ', description: 'ตั้งค่าใช้จ่ายค้างจ่าย', auto_reverse: true, recurring: null, lines });
    const r = await postJournalDraft(db, A, id, 'accountant');
    expect(r.journalNo).toMatch(/^JV2611-\d{4}$/u);
    expect(r.reversalNo).toBe(`${r.journalNo}R`);
    const l = await accountLedger(db, A, { account: '2150200', from: '2026-11-01', to: '2026-12-31' });
    expect(l.closing).toBe('0.00');
    expect(l.rows.map((x) => x.date)).toEqual(['2026-11-30', '2026-12-01']);
  });
  it('ร่างไม่ดุล → ลงบัญชีไม่ได้', async () => {
    const id = await saveJournalDraft(db, A, { date: '2026-11-30', book: 'GJ', description: 'x', auto_reverse: false, recurring: null, lines: lines.slice(0, 2) });
    await expect(postJournalDraft(db, A, id, 'accountant')).rejects.toThrow(/Dr ≠ Cr/u);
  });
  it('บัญชีคุมลงรายวันตรงไม่ได้', async () => {
    const id = await saveJournalDraft(db, A, { date: '2026-11-30', book: 'GJ', description: 'x', auto_reverse: false, recurring: null,
      lines: [{ account_code: '1130100', debit: '10.00' }, { account_code: '4100100', credit: '10.00' }] });
    await expect(postJournalDraft(db, A, id, 'accountant')).rejects.toThrow(/บัญชีคุม/u);
  });
  it('template บันทึก/อ่านกลับได้ · ชื่อซ้ำ = อัปเดต', async () => {
    await saveTemplate(db, A, { name: 'ค้างจ่ายสาธารณูปโภค', book: 'GJ', description: 'a', lines });
    await saveTemplate(db, A, { name: 'ค้างจ่ายสาธารณูปโภค', book: 'GJ', description: 'b', lines });
    const t = await listTemplates(db, A);
    expect(t).toHaveLength(1);
    expect(t[0]!.description).toBe('b');
  });
});
