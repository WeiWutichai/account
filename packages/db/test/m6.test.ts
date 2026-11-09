// M6 ธนาคาร + ภาษี + ปิดงวด บน DB จริง — ตัวเลขจาก fixtures ที่คำนวณจากเอกสารได้ (FA-0017 · RV2611-0021 · PAYRUN)
import { fromTuples } from '@innovera/ledger';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePeriod, depreciationFor, importStatement, autoMatch, parseStatementCsv, reconciliation, reopenPeriod, runDepreciation, saveAsset, yearEnd } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { postJournal, trialBalance } from '../src/ledger-service.ts';
import { approvePayment, approvePurchase, createPayment, savePurchaseDraft } from '../src/purchase.ts';
import { aging, financialStatements, pndReport, rdPrepTxt, reconChecks, vatReports } from '../src/reports.ts';
import { approveDocument, receivePayment, saveSalesDraft } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/sample-company.json', import.meta.url), 'utf8')) as Record<string, unknown> & { documents: Record<string, Record<string, unknown>> };
const D = (no: string) => fx.documents[no]! as Record<string, string> & { applications?: { doc: string; applied: string; wht: string; wht_base?: string }[] };
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const mgr = { userId: null, role: 'accounting_manager' as const };
const owner = { userId: null, role: 'owner' as const };
let db: Db;
let A = '';
const contact = async (code: string) => (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
  // ใบแจ้งหนี้ + รับชำระตาม RV2611-0021
  const rv = D('RV2611-0021');
  const ids: Record<string, string> = {};
  for (const no of ['IV2610-0049', 'IV2611-0053']) {
    const iv = D(no);
    const incl = no === 'IV2611-0053';
    const id = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: await contact('C0031'), issueDate: ce(iv.date!), dueDate: ce(iv.due!), priceInclVat: incl,
      lines: [{ description: 'บริการ', qty: '1', unitPrice: incl ? iv.grand_total! : iv.subtotal!, vat: true }] });
    await approveDocument(db, A, mgr, id);
    ids[no] = id;
  }
  await receivePayment(db, A, mgr, { contactId: await contact('C0031'), date: ce(rv.date!), receiveAccount: '1100100', fee: rv.bank_fee!, feeAccount: rv.fee_account!, whtRate: '0.03',
    applications: rv.applications!.map((a) => ({ documentId: ids[a.doc]!, applied: a.applied, wht: a.wht, ...(a.wht_base ? { whtBase: a.wht_base } : {}) })) });
  // บิลค่าขนส่งจ่าย PV (ภ.ง.ด.53)
  const ap = await savePurchaseDraft(db, A, mgr, { docType: 'AP', contactId: await contact('V0102'), issueDate: '2026-11-15', lines: [{ description: 'ขนส่ง', qty: '1', unitPrice: '600000.00', vat: false, accountCode: '5301300', whtType: 'transport_domestic' }] });
  await approvePurchase(db, A, mgr, ap);
  const pv = await createPayment(db, A, { userId: '00000000-0000-4000-8000-0000000000c1', role: 'accountant' }, { contactId: await contact('V0102'), date: '2026-11-28', payFrom: '1100100', bills: [{ documentId: ap }] });
  await approvePayment(db, A, { ...mgr, approvalLimit: null }, pv.id);
}, 180_000);
afterAll(() => db.close());

describe('รายงานภาษี (ScreenTax · D12–D15)', () => {
  it('ภาษีขาย พ.ย.: แถว RV2611-0021 ฐาน/ภาษีตาม fixtures · ภาษีขาย = ยอดในรายงาน', async () => {
    const r = await vatReports(db, A, '2026-11');
    const row = (fx.tax_2569_11 as { vat_sales_report: { rows: { doc: string; base: string; vat: string }[] } }).vat_sales_report.rows.find((x) => x.doc === 'RV2611-0021')!;
    expect(r.sales.rows.map((x) => [x.base, x.vat])).toEqual([[row.base, row.vat]]);
    expect(r.pp30.outputVat).toBe(row.vat);
    expect(r.pp30.postOnFiled[0]).toEqual(['Dr', '2150100', row.vat]);
  });
  it('ภ.ง.ด.53 พ.ย.: 50 ทวิ ค่าขนส่ง 1% ตามแถวของ fixtures · ไฟล์ RD Prep มี 1 บรรทัดต่อผู้รับเงิน', async () => {
    const r = await pndReport(db, A, '2026-11', '53');
    const fxRow = (fx.tax_2569_11 as { pnd53: { rows: { contact?: string; base: string; tax: string; rate_pct: number }[] } }).pnd53.rows[0]!;
    expect(r.rows).toHaveLength(1);
    expect([r.rows[0]!.base, r.rows[0]!.amount]).toEqual(['600000.00', '6000.00']);
    expect(Number(r.rows[0]!.rate) * 100).toBe(fxRow.rate_pct);
    const txt = rdPrepTxt(r);
    expect(txt.split('\r\n').filter(Boolean)).toHaveLength(1);
    expect(txt).toContain('|600000.00|6000.00|');
  });
  it('ตรวจความถูกต้อง: รายงานภาษีขาย/ภาษีหัก/ลูกหนี้/เจ้าหนี้ ตรงกับ GL', async () => {
    const r = await reconChecks(db, A, '2026-11');
    for (const k of ['vat_output', 'wht_payable', 'ar_control', 'ap_control']) expect(r.checks.find((c) => c.key === k)).toMatchObject({ ok: true });
  });
});

describe('อายุหนี้ (ScreenAging)', () => {
  it('ณ 30/11/2569: IV2611-0053 ค้าง 1,200.00 ยังไม่ถึงกำหนด · รายใบ = GL 1130100', async () => {
    const r = await aging(db, A, '2026-11-30', 'AR');
    expect(r.totals).toMatchObject({ total: '1200.00', current: '1200.00' });
    expect(r.gl.diff).toBe('0.00');
    const before = await aging(db, A, '2026-11-26', 'AR'); // ก่อนวันรับชำระ: ค้างเต็ม 2 ใบ · IV2610-0049 ครบกำหนด 27/11
    expect(before.totals.total).toBe('1561400.00');
  });
});

describe('ทรัพย์สิน + ค่าเสื่อม (ScreenAssets)', () => {
  it('FA-0017 เดือนแรก (19 วัน) = 1,353.41 ตาม fixtures · ลงค่าเสื่อมงวด 11 ได้ครั้งเดียว', async () => {
    const fa = (fx.fixed_assets as Record<string, string>[]).find((x) => x.code === 'FA-0017')!;
    await saveAsset(db, A, { code: fa.code!, name: fa.name!, assetAccount: fa.account!, accumAccount: fa.accum!, expenseAccount: fa.expense!, startDate: ce(fa.start!), lifeYears: String(fa.life_years), cost: fa.cost as never, salvage: fa.salvage as never });
    const dep = await depreciationFor(db, A, '2026-11');
    expect(dep.find((d) => d.code === 'FA-0017')?.amount).toBe(fa.first_month_dep);
    const r = await runDepreciation(db, A, mgr, { fiscalYear: 2569, periodNo: 11 });
    expect(r.total).toBe(fa.first_month_dep);
    await expect(runDepreciation(db, A, mgr, { fiscalYear: 2569, periodNo: 11 })).rejects.toThrow(/แล้ว/u);
  });
});

describe('กระทบยอดธนาคาร (ScreenBankRecon)', () => {
  it('นำเข้า CSV (ซ้ำไม่เพิ่ม) · จับคู่อัตโนมัติตามยอด ±3 วัน · ที่เหลือแสดงเป็นผลต่าง', async () => {
    const rv = D('RV2611-0021');
    const csv = `วันที่,รายการ,จำนวนเงิน,คงเหลือ\n27/11/2569,"${(rv.bank_statement_match as unknown as { desc: string }).desc}",${rv.cash_in},\n28/11/2569,BULK 2811 batch 0042,-594000.00,\n29/11/2569,ดอกเบี้ยรับ,125.50,`;
    const rows = parseStatementCsv(csv);
    expect(rows).toHaveLength(3);
    expect(await importStatement(db, A, '1100100', rows, 'nov')).toEqual({ added: 3, skipped: 0 });
    expect(await importStatement(db, A, '1100100', rows, 'nov-again')).toEqual({ added: 0, skipped: 3 });
    expect(await autoMatch(db, A, '1100100')).toEqual({ matched: 2, remaining: 1 });
    const rec = await reconciliation(db, A, '1100100', '2026-11-30');
    expect(rec.unmatchedStatement.map((s) => s.description)).toEqual(['ดอกเบี้ยรับ']);
  });
});

describe('ปิดงวด (ScreenPeriodClose)', () => {
  it('ปิดตามลำดับ · ปิดแข็งแล้วลงรายการไม่ได้ · เปิดคืนต้องเป็นเจ้าของ + เหตุผล', async () => {
    await expect(closePeriod(db, A, mgr, { fiscalYear: 2569, periodNo: 11, to: 'soft_closed' })).rejects.toThrow(/งวดก่อนหน้า/u);
    for (let p = 1; p <= 10; p++) await closePeriod(db, A, mgr, { fiscalYear: 2569, periodNo: p, to: 'hard_closed' });
    await closePeriod(db, A, mgr, { fiscalYear: 2569, periodNo: 11, to: 'soft_closed' });
    await expect(closePeriod(db, A, { userId: null, role: 'accountant' }, { fiscalYear: 2569, periodNo: 12, to: 'soft_closed' })).rejects.toThrow(/เฉพาะ/u);
    await expect(postJournal(db, A, { date: '2026-10-15', lines: fromTuples([['Dr', '5401100', '1.00'], ['Cr', '1100100', '1.00']]), role: 'owner' })).rejects.toThrow(/ปิดแข็ง/u);
    await expect(reopenPeriod(db, A, mgr, { fiscalYear: 2569, periodNo: 10, reason: 'แก้' })).rejects.toThrow(/เจ้าของ/u);
    await expect(reopenPeriod(db, A, owner, { fiscalYear: 2569, periodNo: 10, reason: ' ' })).rejects.toThrow(/เหตุผล/u);
    await reopenPeriod(db, A, owner, { fiscalYear: 2569, periodNo: 10, reason: 'ผู้สอบบัญชีขอปรับปรุง' });
    const log = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select(['action', 'after']).where('action', '=', 'period.reopen').execute());
    expect(log[0]?.after).toMatchObject({ reason: 'ผู้สอบบัญชีขอปรับปรุง' });
  });
  it('ปิดปี (งวด 13): รายได้/ค่าใช้จ่ายเป็นศูนย์ · กำไรเข้ากำไรสะสม · งบดุลยังดุล · ปิดซ้ำไม่ได้', async () => {
    const fsBefore = await financialStatements(db, A, { fiscalYear: 2569, upToPeriod: 12 });
    const r = await yearEnd(db, A, owner, 2569);
    expect(r.netProfit).toBe(fsBefore.pl.profit);
    const tb = await trialBalance(db, A, { fiscalYear: 2569, upToPeriod: 13 });
    const types = await db.withCompany(A, (tx) => tx.selectFrom('acct.account').select(['code', 'type']).execute());
    const pl = tb.filter((t) => ['revenue', 'expense', 'contra_revenue'].includes(types.find((x) => x.code === t.account)?.type ?? ''));
    expect(pl.every((t) => Number(t.balance) === 0)).toBe(true);
    expect((await financialStatements(db, A, { fiscalYear: 2569, upToPeriod: 13 })).bs.balanced).toBe(true);
    await expect(yearEnd(db, A, owner, 2569)).rejects.toThrow(/ปิดปีนี้แล้ว/u);
  });
});
