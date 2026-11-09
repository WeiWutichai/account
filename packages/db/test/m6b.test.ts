// กลุ่ม C: สถานะการยื่นแบบ · ภาษีซื้อข้ามเดือน ม.82/3 · ภาษีซื้อต้องห้าม · ขายทรัพย์สิน · ค่าเสื่อมต่องวด · ปิดงวด · ตรวจความถูกต้องทั้งปี
// ตัวเลขจาก fixtures: tax_2569_11 (pp30 · input_vat_prior_month_claims · vat_sales_report) · fixed_assets FA-0003/FA-0017 · AP2610-0071 · AP2611-0090
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { depreciationFor, depreciationRuns, disposeAsset, periodStatus, reviewAccruals, runDepreciation, saveAsset } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { sidebarBadges } from '../src/master.ts';
import { approvePayment, approvePurchase, createPayment, savePurchaseDraft, setCompanySetting } from '../src/purchase.ts';
import { DISALLOWED_INPUT_VAT_KEY, fileTax, pndReport, reconChecks, taxFilings, VAT_EXCESS_ACCOUNT_KEY, vatReports } from '../src/reports.ts';
import { approveDocument, receivePayment, saveSalesDraft } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

type Tuple = [string, string, string];
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/sample-company.json', import.meta.url), 'utf8')) as {
  documents: Record<string, Record<string, unknown>>;
  tax_2569_11: { pp30: { input_vat_prior_month_claims: { invoice: string; vat: string }[] }; vat_sales_report: { rows: { doc: string; base: string; vat: string }[] } };
  fixed_assets: (Record<string, unknown> & { code: string })[];
};
const D = (no: string) => fx.documents[no]! as Record<string, string> & { applications?: { doc: string; applied: string; wht: string; wht_base?: string }[] };
const FA = (code: string) => fx.fixed_assets.find((a) => a.code === code)! as unknown as Record<string, string> & { disposal: Record<string, string> & { journal: Tuple[] } };
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const mgr = { userId: null, role: 'accounting_manager' as const };
let db: Db;
let A = '';
const contact = async (code: string) => (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const journalLines = (no: string) => db.withCompany(A, (tx) => tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', 'j.id', 'l.journal_id')
  .select(['l.account_code', 'l.debit', 'l.credit']).where('j.journal_no', '=', no).orderBy('l.line_no').execute())
  .then((ls) => ls.map((l): Tuple => (l.debit !== '0.00' ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit])));
const bill = async (p: { date: string; amount: string; vendor?: string; account?: string; claim?: string | null; ref?: string }) => {
  const id = await savePurchaseDraft(db, A, mgr, { docType: 'AP', contactId: await contact(p.vendor ?? 'V0210'), issueDate: p.date, vendorRef: p.ref ?? null, vatClaimMonth: p.claim ?? null,
    lines: [{ description: 'ค่าบริการ', qty: '1', unitPrice: p.amount, vat: true, accountCode: p.account ?? '5306100' }] });
  await approvePurchase(db, A, mgr, id);
  return id;
};

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
  // ภาษีขาย พ.ย.: IV บริการ + RV2611-0021 (เหมือน m6.test.ts)
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
  // ภาษีซื้อ: AP2611-0090 (พ.ย.) · AP2610-0071 INV-4409 ออก ต.ค. ใช้สิทธิ์ พ.ย. (ม.82/3) · บิล ต.ค. ปกติ 10,000 + 700 (ภาษีซื้อ > ภาษีขายเดือน ต.ค.)
  const ap90 = D('AP2611-0090');
  await bill({ date: ce(ap90.date!), amount: ap90.subtotal!, ref: ap90.vendor_invoice!, account: '1520100' });
  const ap71 = D('AP2610-0071');
  await bill({ date: ce(ap71.date!), amount: ap71.subtotal!, ref: ap71.vendor_invoice!, claim: ce(ap71.input_vat_claimed_in!) });
  await bill({ date: '2026-10-05', amount: '10000.00', ref: 'OCT-1' });
  // ภ.ง.ด.53 พ.ย.: ค่าขนส่งจ่าย PV
  const ap = await savePurchaseDraft(db, A, mgr, { docType: 'AP', contactId: await contact('V0102'), issueDate: '2026-11-15', lines: [{ description: 'ขนส่ง', qty: '1', unitPrice: '600000.00', vat: false, accountCode: '5301300', whtType: 'transport_domestic' }] });
  await approvePurchase(db, A, mgr, ap);
  const pv = await createPayment(db, A, { userId: '00000000-0000-4000-8000-0000000000c1', role: 'accountant' }, { contactId: await contact('V0102'), date: '2026-11-28', payFrom: '1100100', bills: [{ documentId: ap }] });
  await approvePayment(db, A, { ...mgr, approvalLimit: null }, pv.id);
}, 180_000);
afterAll(() => db.close());

describe('ภาษีซื้อข้ามเดือน ม.82/3 (ScreenTax · ScreenPurchaseBill "เดือนที่ใช้ภาษีซื้อ")', () => {
  it('INV-4409 ออก ต.ค. ใช้สิทธิ์ พ.ย. → อยู่ในรายงานภาษีซื้อ พ.ย. (วันที่ตามใบกำกับ) ไม่อยู่ใน ต.ค.', async () => {
    const claim = fx.tax_2569_11.pp30.input_vat_prior_month_claims[0]!;
    const nov = await vatReports(db, A, '2026-11');
    expect(nov.pp30.priorMonthClaims).toMatchObject({ count: 1, vat: claim.vat });
    expect(nov.pp30.priorMonthClaims.rows[0]).toMatchObject({ vendorRef: claim.invoice, issueMonth: '2026-10' });
    expect(nov.purchases.rows.find((r) => r.vendorRef === claim.invoice)?.date).toBe(ce(D('AP2610-0071').date!));
    const oct = await vatReports(db, A, '2026-10');
    expect(oct.purchases.rows.map((r) => r.vendorRef)).toEqual(['OCT-1']);
  });
  it('เลื่อนเกิน 6 เดือน / ก่อนเดือนตามบิล → ปฏิเสธ', async () => {
    await expect(bill({ date: '2026-10-20', amount: '100.00', claim: '2027-05' })).rejects.toThrow(/6 เดือน/u);
    await expect(bill({ date: '2026-10-20', amount: '100.00', claim: '2026-09' })).rejects.toThrow(/6 เดือน/u);
  });
  it('ตรวจความถูกต้อง พ.ย.: ภาษีซื้อ ↔ GL 1170100 ปรับตามเดือนที่ใช้สิทธิ์ (รวมใช้สิทธิ์ข้ามเดือน 1 ใบ) · ต.ค. ไม่นับใบที่เลื่อน', async () => {
    const nov = await reconChecks(db, A, '2026-11');
    expect(nov.checks.find((c) => c.key === 'vat_input')).toMatchObject({ ok: true, crossMonth: 1 });
    const oct = await reconChecks(db, A, '2026-10');
    expect(oct.checks.find((c) => c.key === 'vat_input')).toMatchObject({ ok: true, byDocs: '700.00' });
  });
  it('ภาษีซื้อต้องห้าม: บัญชีที่ตั้งไว้ไม่อยู่ในรายงานภาษีซื้อ แยกยอดไว้', async () => {
    await bill({ date: '2026-11-10', amount: '13000.00', account: '5302100', ref: 'ENT-1' });
    const before = await vatReports(db, A, '2026-11');
    expect(before.disallowed.items).toBe(0);
    await setCompanySetting(db, A, DISALLOWED_INPUT_VAT_KEY, ['5302100']);
    const after = await vatReports(db, A, '2026-11');
    expect(after.disallowed).toMatchObject({ items: 1, amount: '910.00' });
    expect(after.purchases.rows.some((r) => r.vendorRef === 'ENT-1')).toBe(false);
    await setCompanySetting(db, A, DISALLOWED_INPUT_VAT_KEY, []);
  });
});

describe('ขายทรัพย์สิน + ค่าเสื่อมต่องวด (ScreenAssets)', () => {
  it('ขาย FA-0003 18/11: ค่าเสื่อมเดือนสุดท้าย 18 วัน · JV ตาม fixtures (ขาดทุน 5910100 · ภาษีขาย 350)', async () => {
    const f = FA('FA-0003');
    // TODO(Wei): fixtures dep_2569_11 = 963.00 แต่สูตรของ fixtures เอง "1604.98 × 18 ÷ 30" = 962.988 → 962.99 (963.00 ได้เมื่อไม่หักซาก 1 บาท: 96,300 ÷ 5 ÷ 12 × 18 ÷ 30)
    //   ระบบคิดตามสูตร (หักซาก) → ค่าเสื่อม 962.99 · สะสม/ขาดทุนต่างจาก fixtures 0.01 — ต้องให้ Wei ยืนยันก่อนแก้ fixtures หรือสูตร
    const dep = '962.99';
    const cents = (v: string) => BigInt(v.replace('.', ''));
    const m = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
    const opening = m(cents(f.accum_at_disposal!) - cents(f.dep_2569_11!)); // ค่าเสื่อมสะสมยกมา ณ 31/10 = สะสม ณ วันขาย − ค่าเสื่อม พ.ย. (fixtures)
    const accum = m(cents(opening) + cents(dep));
    const loss = m(cents(f.disposal.loss_5910100!) + 1n);
    const journal: Tuple[] = f.disposal.journal.map(([s, a, v]): Tuple => [s, a, a === '1510190' ? accum : a === '5910100' ? loss : v]);
    await saveAsset(db, A, { code: f.code!, name: f.name!, assetAccount: f.account!, accumAccount: '1510190', expenseAccount: '5150100', startDate: ce(f.start!), lifeYears: '5', cost: f.cost!, salvage: f.salvage!,
      openingAccum: opening, openingAccumDate: '2026-10-31' });
    const r = await disposeAsset(db, A, mgr, f.code!, { date: ce(f.disposal.date!), saleAmount: f.disposal.price!, receiveAccount: '1100100', reference: f.disposal.doc! });
    expect(r).toMatchObject({ depreciation: dep, accumulated: accum, vat: f.disposal.vat, gain: `-${loss}` });
    expect(r.lines).toEqual(journal);
    expect(r.lines.filter(([, a]) => !['1510190', '5910100'].includes(a))).toEqual(f.disposal.journal.filter(([, a]) => !['1510190', '5910100'].includes(a))); // เงินฝาก 5,350 · ราคาทุน · ภาษีขาย 350 ตรง fixtures
    expect(await journalLines(r.journalNo)).toEqual(journal);
    const nov = (await depreciationFor(db, A, '2026-11')).find((a) => a.code === f.code)!;
    expect(nov).toMatchObject({ status: 'disposed', amount: dep, accumulated: accum, nbv: f.nbv_2569_11, assetAccount: f.account, cost: f.cost, salvage: f.salvage });
    expect(nov.disposal).toMatchObject({ date: ce(f.disposal.date!), saleAmount: f.disposal.price, saleVat: f.disposal.vat, ref: f.disposal.doc, journalNo: r.journalNo, lines: journal });
    expect((await depreciationFor(db, A, '2026-12')).find((a) => a.code === f.code)).toMatchObject({ amount: '0.00', nbv: '0.00' });
    await expect(disposeAsset(db, A, mgr, f.code!, { date: '2026-11-20', saleAmount: '1.00', receiveAccount: '1100100' })).rejects.toThrow(/จำหน่ายแล้ว/u);
  });
  it('ภาษีขายจากการขายทรัพย์สินอยู่ในรายงานภาษีขาย พ.ย. · ตรวจ 2150100 ↔ GL ผ่าน · JV ขายไม่นับเป็นคีย์มือ', async () => {
    const v = await vatReports(db, A, '2026-11');
    expect(v.sales.rows.find((r) => r.docType === 'FA')).toMatchObject({ docNo: 'IV2611-0060', base: '5000.00', vat: '350.00' });
    const rec = await reconChecks(db, A, '2026-11');
    expect(rec.checks.find((c) => c.key === 'vat_output')).toMatchObject({ ok: true });
    expect(rec.checks.find((c) => c.key === 'doc_orphans')?.count).toBe('0 / 0');
  });
  it('FA-0017 เดือนแรก 19 วัน = 1,353.41 · ขายได้กำไร (ไม่คิด VAT) → Cr บัญชีกำไร (ค่าตั้งต้น 4200100)', async () => {
    const f = FA('FA-0017');
    await saveAsset(db, A, { code: f.code!, name: f.name!, assetAccount: f.account!, accumAccount: f.accum!, expenseAccount: f.expense!, startDate: ce(f.start!), lifeYears: '3', cost: f.cost!, salvage: f.salvage! });
    expect((await depreciationFor(db, A, '2026-11')).find((a) => a.code === f.code)).toMatchObject({ amount: f.first_month_dep, status: 'active' });
    const r = await disposeAsset(db, A, mgr, f.code!, { date: '2026-11-30', saleAmount: '80000.00', vat: false, receiveAccount: '1100100' });
    expect(r.depreciation).toBe(f.first_month_dep);
    expect(r.lines).toEqual([['Dr', '1100100', '80000.00'], ['Dr', '1520190', '1353.41'], ['Cr', '1520100', '78000.00'], ['Cr', '4200100', '3353.41']]);
  });
  it('ลงค่าเสื่อม พ.ย. รวมเดือนที่ขาย · สถานะต่องวด (journal_no, total) · ขายในงวดที่ลงค่าเสื่อมแล้วไม่ได้', async () => {
    const run = await runDepreciation(db, A, mgr, { fiscalYear: 2569, periodNo: 11 });
    expect(run.total).toBe('2316.40'); // 962.99 + 1,353.41
    expect(await depreciationRuns(db, A, 2569)).toEqual([expect.objectContaining({ period_no: 11, total: '2316.40', journal_no: run.journalNo })]);
    await saveAsset(db, A, { code: 'FA-T1', name: 'ทดสอบ', assetAccount: '1510100', accumAccount: '1510190', expenseAccount: '5150100', startDate: '2026-01-01', lifeYears: '5', cost: '1000.00' });
    await expect(disposeAsset(db, A, mgr, 'FA-T1', { date: '2026-11-25', saleAmount: '100.00', receiveAccount: '1100100' })).rejects.toThrow(/ลงค่าเสื่อม/u);
    const p11 = (await periodStatus(db, A, 2569)).find((p) => p.period_no === 11)!;
    expect(p11.depreciation).toMatchObject({ journal_no: run.journalNo, total: '2316.40' });
  });
});

describe('บันทึกว่ายื่นแล้ว ภ.พ.30 / ภ.ง.ด. (ScreenTax · ScreenPeriodClose · Sidebar)', () => {
  it('ก่อนยื่น: ป้าย Sidebar ภาษี 2 แบบ · งวด พ.ย. ร่าง/ร่าง · postOnFiled 3 บรรทัดตาม fixtures', async () => {
    expect((await sidebarBadges(db, A, '2026-11-30'))['tax']?.count).toBe(2);
    const p11 = (await periodStatus(db, A, 2569)).find((p) => p.period_no === 11)!;
    expect(p11.tax).toEqual({ pp30: 'draft', pnd: 'draft' });
    expect(p11.journals).toBeGreaterThan(0);
    const v = await vatReports(db, A, '2026-11');
    expect(v.pp30.status).toBe('draft');
    expect(v.pp30.carriedForward).toBe('0.00');
    expect(v.pp30.postOnFiled.map(([s, a]) => `${s} ${a}`)).toEqual(['Dr 2150100', 'Cr 1170100', 'Cr 2150200']);
  });
  it('ต.ค. ภาษีซื้อ > ภาษีขาย: ยังไม่กำหนดบัญชีภาษีชำระเกิน → ปฏิเสธ · กำหนดแล้ว → Dr บัญชีชำระเกิน ยกไป 700.00', async () => {
    await expect(fileTax(db, A, mgr, { form: 'pp30', month: '2026-10', filedAt: '2026-11-15' })).rejects.toThrow(/ภาษีชำระเกิน/u);
    await db.withCompany(A, (tx) => tx.insertInto('acct.account').values({ company_id: A, code: '1170200', name: 'ภาษีซื้อชำระเกินยกไป (ทดสอบ)', type: 'asset', parent_code: null, control_kind: null, created_at: new Date(), category: null, binding: null }).execute());
    await setCompanySetting(db, A, VAT_EXCESS_ACCOUNT_KEY, '1170200');
    const r = await fileTax(db, A, mgr, { form: 'pp30', month: '2026-10', filedAt: '2026-11-15', referenceNo: 'RD-OCT' });
    expect(r).toMatchObject({ seq: 0, amount: '0.00', carryForward: '700.00' });
    expect(await journalLines(r.journalNo!)).toEqual([['Cr', '1170100', '700.00'], ['Dr', '1170200', '700.00']]);
  });
  it('พ.ย.: ข้อ 10 ภาษีที่ชำระเกินยกมา 700.00 · ยื่นแล้ว → JV = postOnFiled · ยื่นซ้ำต้องเป็นยื่นเพิ่มเติม', async () => {
    const v = await vatReports(db, A, '2026-11');
    expect(v.pp30.carriedForward).toBe('700.00');
    expect(v.pp30.netAfterCarry).toBe((BigInt(v.pp30.netPayable.replace('.', '')) - 70000n).toString().replace(/(\d\d)$/u, '.$1'));
    const r = await fileTax(db, A, mgr, { form: 'pp30', month: '2026-11', filedAt: '2026-12-20' });
    expect(await journalLines(r.journalNo!)).toEqual(v.pp30.postOnFiled);
    expect(v.pp30.postOnFiled).toContainEqual(['Cr', '1170200', '700.00']);
    await expect(fileTax(db, A, mgr, { form: 'pp30', month: '2026-11', filedAt: '2026-12-21' })).rejects.toThrow(/ยื่นเพิ่มเติม/u);
    const after = await vatReports(db, A, '2026-11');
    expect(after.pp30.status).toBe('filed');
    expect(after.pp30.filings[0]).toMatchObject({ seq: 0, journal_no: r.journalNo });
    // ตรวจความถูกต้อง ธ.ค.: JV ยื่น ภ.พ.30 ไม่ถูกนับเป็นภาษีขาย/ซื้อของ ธ.ค. หรือ JV คีย์มือ
    const dec = await reconChecks(db, A, '2026-12');
    expect(dec.checks.filter((c) => ['vat_output', 'vat_input', 'doc_orphans'].includes(c.key)).every((c) => c.ok)).toBe(true);
  });
  it('ยื่นเพิ่มเติม: ลงเฉพาะส่วนต่าง · ครั้งที่ 1 · ส่วนต่างที่ทำให้ชำระเกินยังไม่รองรับ (รอยืนยัน)', async () => {
    await bill({ date: '2026-11-29', amount: '1000.00', ref: 'LATE-1' });
    await expect(fileTax(db, A, mgr, { form: 'pp30', month: '2026-11', filedAt: '2026-12-22', additional: true })).rejects.toThrow(/ชำระเกิน/u);
    const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', taxMode: 'immediate', ruleCode: 'Credit[IV]', contactId: await contact('C0031'), issueDate: '2026-11-29', lines: [{ description: 'ขายสินค้า', qty: '1', unitPrice: '2000.00', vat: true }] });
    await approveDocument(db, A, mgr, iv);
    const r = await fileTax(db, A, mgr, { form: 'pp30', month: '2026-11', filedAt: '2026-12-22', additional: true });
    expect(r).toMatchObject({ seq: 1, amount: '70.00' });
    expect(await journalLines(r.journalNo!)).toEqual([['Dr', '2150100', '140.00'], ['Cr', '1170100', '70.00'], ['Cr', '2150200', '70.00']]);
  });
  it('ภ.ง.ด.53 พ.ย.: บันทึกการยื่นอย่างเดียว (ไม่มี JV) · งวด พ.ย. ยื่นแล้ว/ยื่นแล้ว · Sidebar ไม่มีป้ายภาษี', async () => {
    const r = await fileTax(db, A, mgr, { form: 'pnd53', month: '2026-11', filedAt: '2026-12-15', referenceNo: 'RD-53' });
    expect(r).toMatchObject({ journalNo: null, amount: '6000.00' });
    expect((await pndReport(db, A, '2026-11', '53')).status).toBe('filed');
    const p11 = (await periodStatus(db, A, 2569)).find((p) => p.period_no === 11)!;
    expect(p11.tax).toEqual({ pp30: 'filed', pnd: 'filed' });
    expect((await sidebarBadges(db, A, '2026-11-30'))['tax']).toBeUndefined();
    expect((await taxFilings(db, A, { from: '2026-10', to: '2026-11' })).map((f) => `${f.form}:${f.month}:${f.seq}`)).toEqual(['pp30:2026-10:0', 'pnd53:2026-11:0', 'pp30:2026-11:0', 'pp30:2026-11:1']);
  });
});

describe('ปิดงวด / ตรวจความถูกต้องทั้งปี', () => {
  it('ยืนยันทบทวนค้างรับ–ค้างจ่าย: บันทึกต่องวด · ผู้ใช้ทั่วไปทำไม่ได้', async () => {
    await expect(reviewAccruals(db, A, { userId: null, role: 'accountant' }, { fiscalYear: 2569, periodNo: 11 })).rejects.toThrow();
    await reviewAccruals(db, A, mgr, { fiscalYear: 2569, periodNo: 11 });
    expect((await periodStatus(db, A, 2569)).find((p) => p.period_no === 11)?.accrual_reviewed_at).toBeInstanceOf(Date);
  });
  it('ปีบัญชี 2569 สะสม: ช่วง 01/01–31/12 · ภาษีซื้อข้ามเดือนภายในปีไม่เป็นผลต่าง', async () => {
    const r = await reconChecks(db, A, '2569');
    expect([r.from, r.to]).toEqual(['2026-01-01', '2026-12-31']);
    expect(r.checks.find((c) => c.key === 'vat_input')).toMatchObject({ ok: true, crossMonth: 0 });
    expect(r.checks.find((c) => c.key === 'vat_output')).toMatchObject({ ok: true });
    await expect(reconChecks(db, A, '2571')).rejects.toThrow(/ไม่พบงวด/u);
  });
});
