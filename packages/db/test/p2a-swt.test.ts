// Phase 2A SWT: สัญญา/รายได้รับล่วงหน้า · รอบบิล · usage · ตัวชี้วัด · ภ.พ.36 · ภ.ง.ด.54 · สินทรัพย์ไม่มีตัวตน · recon · RLS · โมดูลปิด = Phase 1
// ตัวเลขจาก fixtures/p2a-software.json (ร่าง รอ Wei ยืนยัน) + ตรวจสูตรซ้ำด้วย revenueSchedule/pnd54Tax
import { billingPeriod, fromTuples, revenueSchedule, toTuples, type JournalLineTuple } from '@innovera/ledger';
import { pnd54Rate, pnd54Tax } from '@innovera/tax-th';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { depreciationFor, runDepreciation } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import {
  cancelContract, completeMilestone, contractMetrics, getContract, recordUsage, runBilling, runRevenueRecognition, saveContract, saveIntangibleAsset, setSoftwareModule, SWT_ACCOUNTS, voidRevenueRecognition,
  type ContractLineInput,
} from '../src/contract.ts';
import { filePp36, pp36Report } from '../src/foreign-tax.ts';
import type { Db } from '../src/index.ts';
import { approvePayment, approvePurchase, createPayment, savePurchaseDraft, setCompanySetting } from '../src/purchase.ts';
import { pndReport, reconChecks, vatReports } from '../src/reports.ts';
import { approveDocument, receivePayment, saveSalesDraft, voidDocument, type Actor } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

type Tuples = [string, string, string][];
interface FxContract { code: string; contact: string; start: string; end: string; cycle: 'monthly' | 'quarterly' | 'annual'; auto_renew: boolean; cancel_on?: string;
  lines: { kind: ContractLineInput['kind']; recognition: ContractLineInput['recognition']; description: string; amount?: string; unit_price?: string; usage_unit?: string; milestone_done_on?: string }[];
  invoice?: { date: string; subtotal: string; vat: string; grand_total: string; journal: Tuples }; milestone_invoice?: { date: string; subtotal: string; vat: string; grand_total: string };
  receipt?: { date: string; account: string; journal: Tuples }; schedule?: Record<string, string>; schedule_first?: Record<string, string>; mrr: string;
  usage?: { external_source: string; external_ref: string; date: string; qty: string }[]; invoices?: { period: string; subtotal: string; vat: string; grand_total: string }[] }
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/p2a-software.json', import.meta.url), 'utf8')) as {
  _meta: { status: string }; settings: Record<string, unknown>;
  contacts: { code: string; name: string; kind: 'customer' | 'vendor'; entity_type: 'juristic' | 'foreign'; tax_id?: string; country?: string }[];
  contracts: FxContract[];
  billing_run_2026_02_01: { created: number; rerun_created: number };
  recognition_2569_01: { total: string; journal: Tuples };
  metrics_2026_02_15: { mrr: string; arr: string; active_contracts: number };
  churn_2026_03: { customers_start: number; churned_customers: number; customer_churn_rate: string; mrr_start: string; churned_mrr: string; mrr_churn_rate: string };
  foreign_payments: { code: string; vendor: string; type: 'AP' | 'EXP'; date: string; account: string; amount: string; wht_type: string | null; pay_from?: string; gross_up?: boolean;
    journal?: Tuples; payment?: { date: string; pay_from: string; journal: Tuples }; pnd54?: { base: string; rate: string; tax: string; treaty: boolean }; pp36: { base: string; vat: string } }[];
  pp36_2026_02: { rows: number; base: string; vat: string };
  pp36_filing: { month: string; filed_at: string; pay_from: string; journal: Tuples; pp30_2026_03_input_vat_from_pp36: string };
  pnd54_2026_02: { rows: number; tax: string };
  intangible_asset: { code: string; name: string; vendor: string; bill_date: string; cost: string; vat: string; life_years: string; salvage: string; amortization: Record<string, string> };
};
const C = (code: string) => fx.contracts.find((c) => c.code === code)!;
const F = (code: string) => fx.foreign_payments.find((c) => c.code === code)!;
const set = (t: readonly (readonly string[])[]) => new Set(t.map((x) => x.join(' ')));
const clerk: Actor = { userId: '00000000-0000-4000-8000-0000000000d1', role: 'accountant' };
const mgr = { userId: null, role: 'accounting_manager' as const };
const SWT_KEYS = ['deferred_revenue', 'pp36_payable', 'pp36_input', 'pnd54_payable'];

let db: Db;
let A = '';
let B = '';
const ids: Record<string, string> = {};
const contact = async (code: string, co = A) => (await db.withCompany(co, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const journalTuples = async (journalId: string, co = A) => db.withCompany(co, async (tx) => {
  const lines = await tx.selectFrom('acct.journal_line').select(['account_code', 'debit', 'credit']).where('journal_id', '=', journalId).orderBy('line_no').execute();
  return toTuples(fromTuples(lines.map((l) => (Number(l.debit) > 0 ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit]) as JournalLineTuple)));
});
const docJournal = async (docId: string, co = A) => {
  const d = await db.withCompany(co, (tx) => tx.selectFrom('acct.document').select('journal_id').where('id', '=', docId).executeTakeFirstOrThrow());
  return journalTuples(d.journal_id!, co);
};
const ivsOf = async (code: string) => db.withCompany(A, (tx) => tx.selectFrom('acct.document as d').innerJoin('acct.contract as k', (j) => j.onRef('k.id', '=', 'd.contract_id').onRef('k.company_id', '=', 'd.company_id'))
  .select(['d.id', 'd.status', 'd.issue_date', 'd.contract_period_start', 'd.subtotal', 'd.vat', 'd.grand_total']).where('k.code', '=', code).where('d.status', '<>', 'voided').orderBy('d.issue_date').orderBy('d.created_at').execute());
const glBalance = async (account: string, co = A) => db.withCompany(co, async (tx) => {
  const r = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
    .select((eb) => [eb.fn.sum<string>('l.debit').as('dr'), eb.fn.sum<string>('l.credit').as('cr')]).where('l.account_code', '=', account).where('j.status', '<>', 'draft').executeTakeFirstOrThrow();
  return r;
});

async function setupCompany(name: string, module: boolean) {
  const org = await createOrganization(db, name);
  const id = await createCompany(db, { orgId: org, nameTh: name, taxId: '0105556099991' });
  await seedCompany(db, id, 2569, { sample: false });
  if (module) await setSoftwareModule(db, id, true);
  await db.withCompany(id, async (tx) => {
    for (const c of fx.contacts) {
      await tx.insertInto('acct.contact').values({ company_id: id, code: c.code, name: c.name, kind: c.kind, tax_id: c.tax_id ?? null, branch_code: null, external_source: null, external_ref: null,
        address: null, contact_person: null, phone: null, email: null, credit_days: null, credit_limit: null, entity_type: c.entity_type, country: c.country ?? null }).execute();
    }
  });
  return id;
}

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  A = await setupCompany('บริษัท ซอฟต์แวร์ตัวอย่าง จำกัด', true);
  B = await setupCompany('บริษัท บริการทั่วไป จำกัด', false);
  for (const [k, v] of Object.entries(fx.settings)) await setCompanySetting(db, A, k, v);
}, 180_000);
afterAll(() => db.close());

describe('fixtures + โมดูล', () => {
  it('fixtures เป็นร่างรอ Wei ยืนยัน', () => expect(fx._meta.status).toBe('ร่าง รอ Wei ยืนยัน'));
  it('เปิดโมดูล = สร้างบัญชีโมดูล 7 บัญชี · เปิดซ้ำไม่ทับชื่อที่ผู้ใช้แก้', async () => {
    const codes = await db.withCompany(A, (tx) => tx.selectFrom('acct.account').select('code').where('code', 'in', SWT_ACCOUNTS.map((a) => a.code)).execute());
    expect(codes).toHaveLength(7);
    await db.withCompany(A, (tx) => tx.updateTable('acct.account').set({ name: 'รายได้รับล่วงหน้า (แก้ชื่อ)' }).where('code', '=', '2170100').execute());
    expect((await setSoftwareModule(db, A, true)).accountsCreated).toBe(0);
    expect((await db.withCompany(A, (tx) => tx.selectFrom('acct.account').select('name').where('code', '=', '2170100').executeTakeFirstOrThrow())).name).toBe('รายได้รับล่วงหน้า (แก้ชื่อ)');
  });
});

describe('สัญญา + รอบบิล (IV ร่าง) + รายได้รับล่วงหน้า', () => {
  beforeAll(async () => {
    for (const c of fx.contracts) {
      ids[c.code] = await saveContract(db, A, clerk, {
        code: c.code, contactId: await contact(c.contact), startDate: c.start, endDate: c.end, billingCycle: c.cycle, autoRenew: c.auto_renew,
        lines: c.lines.map((l) => ({ kind: l.kind, recognition: l.recognition, description: l.description, ...(l.amount ? { amount: l.amount } : {}), ...(l.unit_price ? { unitPrice: l.unit_price } : {}), usageUnit: l.usage_unit ?? null })),
      });
    }
    for (const u of C('CT-003').usage!) await recordUsage(db, A, { contractCode: 'CT-003', lineNo: 2, usageDate: u.date, qty: u.qty, externalSource: u.external_source, externalRef: u.external_ref }, null);
  });

  it('รอบบิล 1 ก.พ. 2569: สร้าง IV ร่างตามรอบ (ไม่ลงบัญชีเอง) · รันซ้ำไม่สร้างซ้ำ', async () => {
    const r = await runBilling(db, A, clerk, { asOf: '2026-02-01' });
    expect(r.created).toHaveLength(fx.billing_run_2026_02_01.created);
    const docs = await db.withCompany(A, (tx) => tx.selectFrom('acct.document').select(['status', 'journal_id']).where('contract_id', 'is not', null).execute());
    expect(docs.every((d) => d.status === 'draft' && d.journal_id === null)).toBe(true);
    expect((await runBilling(db, A, clerk, { asOf: '2026-02-01' })).created).toHaveLength(fx.billing_run_2026_02_01.rerun_created);
  });

  it('ยอดใบแจ้งหนี้ตาม fixtures (รายปีล่วงหน้า · license + support · subscription + usage ย้อนหลัง)', async () => {
    for (const code of ['CT-001', 'CT-002']) {
      const iv = (await ivsOf(code))[0]!;
      const e = C(code).invoice!;
      expect([iv.issue_date, iv.subtotal, iv.vat, iv.grand_total]).toEqual([e.date, e.subtotal, e.vat, e.grand_total]);
    }
    const api = await ivsOf('CT-003');
    expect(api.map((x) => [x.contract_period_start, x.subtotal, x.vat, x.grand_total])).toEqual(C('CT-003').invoices!.map((x) => [x.period, x.subtotal, x.vat, x.grand_total]));
  });

  it('ร่างจากสัญญาแก้ผ่านหน้าใบแจ้งหนี้ไม่ได้ (บรรทัดผูกสัญญา)', async () => {
    const iv = (await ivsOf('CT-001'))[0]!;
    await expect(saveSalesDraft(db, A, clerk, { docType: 'IV', contactId: await contact('C-SAAS'), issueDate: '2026-01-01', lines: [{ description: 'x', qty: '1', unitPrice: '1.00' }] }, iv.id))
      .rejects.toThrow(/จากสัญญา/u);
  });

  it('อนุมัติ: ratably → Cr 2170100 แทนรายได้ · VAT ยังเป็น 2150400 (ม.78/1) · Dr = Cr', async () => {
    for (const code of ['CT-001', 'CT-002', 'CT-003']) for (const iv of await ivsOf(code)) await approveDocument(db, A, mgr, iv.id);
    for (const code of ['CT-001', 'CT-002']) {
      const iv = (await ivsOf(code))[0]!;
      expect(set(await docJournal(iv.id))).toEqual(set(C(code).invoice!.journal));
    }
  });

  it('ตารางรับรู้ pro-rate ตามวัน = fixtures = สูตร (ปัดเศษเดือนสุดท้าย · รวม = ยอดเต็ม)', async () => {
    const ct1 = await getContract(db, A, ids['CT-001']!);
    expect(Object.fromEntries(ct1!.schedule.map((s) => [s.period, s.amount]))).toEqual(C('CT-001').schedule);
    expect(Object.fromEntries(revenueSchedule('120000.00', '2026-01-01', '2026-12-31').map((s) => [s.period, s.amount]))).toEqual(C('CT-001').schedule);
    const ct2 = Object.fromEntries((await getContract(db, A, ids['CT-002']!))!.schedule.map((s) => [s.period, s.amount]));
    for (const [p, a] of Object.entries(C('CT-002').schedule_first!)) expect(ct2[p]).toBe(a);
  });

  it('รับชำระ: โอน 2150400 → 2150100 เหมือนบริการเดิม (รายได้รับล่วงหน้าไม่เปลี่ยน)', async () => {
    const c = C('CT-001');
    const iv = (await ivsOf('CT-001'))[0]!;
    const rv = await receivePayment(db, A, mgr, { contactId: await contact('C-SAAS'), date: c.receipt!.date, receiveAccount: c.receipt!.account, applications: [{ documentId: iv.id, applied: c.invoice!.grand_total }] });
    const j = await db.withCompany(A, (tx) => tx.selectFrom('acct.journal').select('id').where('journal_no', '=', rv.journalNo).executeTakeFirstOrThrow());
    expect(set(await journalTuples(j.id))).toEqual(set(c.receipt!.journal));
  });

  it('รับรู้รายได้ ม.ค. 2569: JV Dr 2170100 / Cr รายได้ ตาม fixtures · รันได้ครั้งเดียวต่องวด', async () => {
    const r = await runRevenueRecognition(db, A, mgr, { fiscalYear: 2569, periodNo: 1 });
    expect(r.total).toBe(fx.recognition_2569_01.total);
    const j = await db.withCompany(A, (tx) => tx.selectFrom('acct.journal').select(['id', 'journal_date']).where('journal_no', '=', r.journalNo!).executeTakeFirstOrThrow());
    expect(j.journal_date).toBe('2026-01-31');
    expect(set(await journalTuples(j.id))).toEqual(set(fx.recognition_2569_01.journal));
    await expect(runRevenueRecognition(db, A, mgr, { fiscalYear: 2569, periodNo: 1 })).rejects.toThrow(/งวดนี้แล้ว/u);
  });

  it('ยกเลิกได้อย่างปลอดภัย: IV ที่รับรู้แล้วยกเลิกไม่ได้ · ยกเลิกการรับรู้ (reversal) แล้วรันใหม่ได้ยอดเดิม', async () => {
    const iv = (await ivsOf('CT-003'))[0]!;
    await expect(voidDocument(db, A, mgr, iv.id, { reason: 'ทดสอบ' })).rejects.toThrow(/รับรู้รายได้ไปแล้ว/u);
    const v = await voidRevenueRecognition(db, A, mgr, { fiscalYear: 2569, periodNo: 1, reason: 'ทดสอบยกเลิก' });
    expect(v.reversal).toBeTruthy();
    const again = await runRevenueRecognition(db, A, mgr, { fiscalYear: 2569, periodNo: 1 });
    expect(again.total).toBe(fx.recognition_2569_01.total);
  });

  it('ยกเลิก IV ที่ยังไม่รับรู้: ตารางปิด · ยอดใช้งานกลับเป็นยังไม่ออกบิล · ออกรอบบิลใหม่ได้', async () => {
    const feb = (await ivsOf('CT-003')).find((x) => x.contract_period_start === '2026-02-01')!;
    await voidDocument(db, A, mgr, feb.id, { reason: 'ออกใหม่' });
    const usage = await db.withCompany(A, (tx) => tx.selectFrom('acct.usage_record').select('document_id').execute());
    expect(usage.every((u) => u.document_id === null)).toBe(true);
    const r = await runBilling(db, A, clerk, { asOf: '2026-02-01', contractId: ids['CT-003']! });
    expect(r.created.map((x) => [x.periodStart, x.grandTotal])).toEqual([['2026-02-01', C('CT-003').invoices![1]!.grand_total]]);
    await approveDocument(db, A, mgr, r.created[0]!.id);
  });

  it('งาน implementation เสร็จ → ใบแจ้งหนี้เพิ่มเติม รับรู้ ณ ใบแจ้งหนี้ (ไม่ผ่านรายได้รับล่วงหน้า)', async () => {
    const line = (await getContract(db, A, ids['CT-002']!))!.lines.find((l) => l.kind === 'implementation')!;
    await completeMilestone(db, A, clerk, line.id, '2026-03-15');
    const r = await runBilling(db, A, clerk, { asOf: '2026-03-15', contractId: ids['CT-002']! });
    const e = C('CT-002').milestone_invoice!;
    expect(r.created.map((x) => [x.periodStart, x.subtotal, x.vat, x.grandTotal])).toEqual([[e.date, e.subtotal, e.vat, e.grand_total]]);
    await approveDocument(db, A, mgr, r.created[0]!.id);
    expect((await docJournal(r.created[0]!.id)).some(([, a]) => a === '2170100')).toBe(false);
    expect((await runBilling(db, A, clerk, { asOf: '2026-03-15', contractId: ids['CT-002']! })).created).toHaveLength(0);
  });

  it('ยอดใช้งานจาก API: idempotent ด้วย external_ref', async () => {
    const u = C('CT-003').usage![0]!;
    const again = await recordUsage(db, A, { contractCode: 'CT-003', lineNo: 2, usageDate: u.date, qty: u.qty, externalSource: u.external_source, externalRef: u.external_ref }, null);
    expect(again.created).toBe(false);
    const n = await db.withCompany(A, (tx) => tx.selectFrom('acct.usage_record').select('id').execute());
    expect(n).toHaveLength(C('CT-003').usage!.length);
    await expect(recordUsage(db, A, { contractCode: 'CT-003', lineNo: 1, usageDate: '2026-02-02', qty: '1', externalSource: 'metering', externalRef: 'U-x' })).rejects.toThrow(/ไม่ได้คิดตามการใช้งาน/u);
  });
});

describe('ตัวชี้วัด', () => {
  it('MRR / ARR ณ 15 ก.พ. 2569 ตาม fixtures · backlog = รายได้รับล่วงหน้าคงเหลือ + ยังไม่ออกบิล', async () => {
    const m = await contractMetrics(db, A, { asOf: '2026-02-15' });
    expect([m.mrr, m.arr, m.activeContracts]).toEqual([fx.metrics_2026_02_15.mrr, fx.metrics_2026_02_15.arr, fx.metrics_2026_02_15.active_contracts]);
    expect(Number(m.backlog)).toBeCloseTo(Number(m.deferredRevenue) + Number(m.unbilled), 2);
    expect(m.standard).toBe('npae');
  });
  it('churn มี.ค. 2569: ยกเลิก CT-003 ณ 31 มี.ค. → ลูกค้า 1 ใน 3 · MRR 5,000 จาก 18,000', async () => {
    await cancelContract(db, A, clerk, ids['CT-003']!, { date: C('CT-003').cancel_on!, reason: 'ลูกค้าเลิกใช้' });
    const m = await contractMetrics(db, A, { asOf: '2026-03-01', month: '2026-03' });
    const e = fx.churn_2026_03;
    expect(m.churn).toEqual({ month: '2026-03', customersStart: e.customers_start, churnedCustomers: e.churned_customers, customerChurnRate: e.customer_churn_rate,
      mrrStart: e.mrr_start, churnedMrr: e.churned_mrr, mrrChurnRate: e.mrr_churn_rate });
    // ยกเลิกแล้วไม่ออกรอบบิลหลังวันยกเลิก
    const r = await runBilling(db, A, clerk, { asOf: '2026-05-01', contractId: ids['CT-003']! });
    expect(r.created.map((x) => x.periodStart)).toEqual(['2026-03-01']);
  });
  it('รอบบิลรายไตรมาส/รายปี คำนวณวันเริ่มรอบตามปฏิทิน (31 ม.ค. + 1 เดือน = 28 ก.พ.)', () => {
    expect(billingPeriod('2026-01-31', 'monthly', 1)).toEqual({ from: '2026-02-28', to: '2026-03-30' });
    expect(billingPeriod('2026-01-01', 'quarterly', 1)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });
});

describe('ภาษีจ่ายต่างประเทศ (ภ.พ.36 · ภ.ง.ด.54)', () => {
  beforeAll(async () => {
    // AP ค่า cloud → จ่าย PV
    const cloud = F('AP-CLOUD');
    const ap = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(cloud.vendor), issueDate: cloud.date, lines: [{ description: 'Cloud hosting', qty: '1', unitPrice: cloud.amount, vat: false, accountCode: cloud.account }] });
    await approvePurchase(db, A, mgr, ap);
    const pv = await createPayment(db, A, clerk, { contactId: await contact(cloud.vendor), date: cloud.payment!.date, payFrom: cloud.payment!.pay_from, bills: [{ documentId: ap }] });
    await approvePayment(db, A, { ...mgr, approvalLimit: null }, pv.id);
    ids.pvCloud = pv.id;
    // ค่าสิทธิจ่ายทันที (อนุสัญญา SG)
    const lic = F('EXP-LIC');
    ids.expLic = await savePurchaseDraft(db, A, clerk, { docType: 'EXP', contactId: await contact(lic.vendor), issueDate: lic.date, payNow: true, payFrom: lic.pay_from!,
      lines: [{ description: 'Royalty', qty: '1', unitPrice: lic.amount, vat: false, accountCode: lic.account, whtType: lic.wht_type }] });
    await approvePurchase(db, A, mgr, ids.expLic);
    // ค่าโฆษณา ผู้จ่ายออกภาษีแทน (gross-up)
    const ads = F('AP-ADS');
    await setCompanySetting(db, A, 'tax.pnd54.gross_up', true);
    const ap2 = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(ads.vendor), issueDate: ads.date, lines: [{ description: 'Ads', qty: '1', unitPrice: ads.amount, vat: false, accountCode: ads.account, whtType: ads.wht_type }] });
    await approvePurchase(db, A, mgr, ap2);
    const pv2 = await createPayment(db, A, clerk, { contactId: await contact(ads.vendor), date: ads.payment!.date, payFrom: ads.payment!.pay_from, bills: [{ documentId: ap2 }] });
    await approvePayment(db, A, { ...mgr, approvalLimit: null }, pv2.id);
    ids.pvAds = pv2.id;
    await setCompanySetting(db, A, 'tax.pnd54.gross_up', false);
  });

  it('ภ.พ.36 ตอนจ่าย: Dr 1170200 / Cr 2150500 (7% ของยอดบริการ) ตาม fixtures', async () => {
    expect(set(await docJournal(ids.pvCloud!))).toEqual(set(F('AP-CLOUD').payment!.journal));
  });
  it('ภ.ง.ด.54 อนุสัญญา SG 10%: Cr 2150600 แทน 2150300 · ภ.พ.36 บนยอดก่อนหัก', async () => {
    expect(set(await docJournal(ids.expLic!))).toEqual(set(F('EXP-LIC').journal!));
    const r = pnd54Rate('pnd54_royalty', 'SG', { SG: { pnd54_royalty: '0.10' } });
    expect(r).toMatchObject({ rate: '0.10', treaty: true });
    expect(pnd54Rate('pnd54_royalty', 'US', { SG: { pnd54_royalty: '0.10' } })).toMatchObject({ rate: '0.15', treaty: false });
    expect(pnd54Tax('100000.00', '0.10').tax).toBe(F('EXP-LIC').pnd54!.tax);
  });
  it('ภ.ง.ด.54 ผู้จ่ายออกแทน (gross-up): ผู้ขายได้เต็ม · Dr บัญชีที่ตั้งไว้ / Cr 2150600 · เงินได้ = ฐาน ÷ (1 − อัตรา)', async () => {
    expect(set(await docJournal(ids.pvAds!))).toEqual(set(F('AP-ADS').payment!.journal));
    expect(pnd54Tax('8500.00', '0.15', true)).toEqual({ base: F('AP-ADS').pnd54!.base, tax: F('AP-ADS').pnd54!.tax });
  });
  it('รายงาน ภ.ง.ด.54 ก.พ. 2569: แถวตาม 50 ทวิ (ประเทศ · อนุสัญญา · ออกแทน) · รอยืนยัน', async () => {
    const r = await pndReport(db, A, '2026-02', '54');
    expect([r.certs, r.tax, r.pendingAuditor]).toEqual([fx.pnd54_2026_02.rows, fx.pnd54_2026_02.tax, true]);
    expect(r.rows.map((x) => [x.base, x.rate, x.amount, x.country, x.treaty, x.gross_up])).toEqual([
      [F('EXP-LIC').pnd54!.base, '0.1000', F('EXP-LIC').pnd54!.tax, 'SG', true, false],
      [F('AP-ADS').pnd54!.base, '0.1500', F('AP-ADS').pnd54!.tax, 'US', false, true],
    ]);
    expect((await pndReport(db, A, '2026-02', '53')).certs).toBe(0);
  });
  it('รายงาน ภ.พ.36 ก.พ. 2569 + recon ภ.พ.36 / ภ.ง.ด.54 / ภาษีหัก ↔ GL', async () => {
    const r = await pp36Report(db, A, '2026-02');
    expect([r.rows.length, r.base, r.vat, r.unfiled]).toEqual([fx.pp36_2026_02.rows, fx.pp36_2026_02.base, fx.pp36_2026_02.vat, fx.pp36_2026_02.vat]);
    const rc = await reconChecks(db, A, '2026-02');
    for (const k of ['pp36_payable', 'pp36_input', 'pnd54_payable', 'wht_payable']) expect(rc.checks.find((c) => c.key === k)).toMatchObject({ ok: true });
  });
  it('ยื่น ภ.พ.36 (7 มี.ค.): ชำระ 2150500 + โอน 1170200 → 1170100 → เป็นภาษีซื้อใน ภ.พ.30 มี.ค.', async () => {
    const f = fx.pp36_filing;
    await expect(filePp36(db, A, mgr, { month: f.month, filedAt: '2026-02-28', payFrom: f.pay_from })).rejects.toThrow(/เดือนถัดจาก/u);
    const r = await filePp36(db, A, mgr, { month: f.month, filedAt: f.filed_at, payFrom: f.pay_from });
    const j = await db.withCompany(A, (tx) => tx.selectFrom('acct.journal').select('id').where('journal_no', '=', r.journalNo).executeTakeFirstOrThrow());
    expect(set(await journalTuples(j.id))).toEqual(set(f.journal));
    await expect(filePp36(db, A, mgr, { month: f.month, filedAt: f.filed_at, payFrom: f.pay_from })).rejects.toThrow(/ไม่มีรายการ/u);
    const v = await vatReports(db, A, '2026-03');
    expect(v.purchases.rows.filter((x) => x.docType === 'PP36').map((x) => x.vat)).toEqual([f.pp30_2026_03_input_vat_from_pp36]);
    const rc = await reconChecks(db, A, '2026-03');
    for (const k of ['vat_input', 'pp36_input']) expect(rc.checks.find((c) => c.key === k)).toMatchObject({ ok: true });
    // การจ่ายที่ยื่น ภ.พ.36 แล้วยกเลิกไม่ได้
    await expect(voidDocument(db, A, mgr, ids.pvCloud!, { reason: 'ทดสอบ' })).rejects.toThrow(/ภ\.พ\.36/u);
  });
});

describe('สินทรัพย์ไม่มีตัวตน (ตัดจำหน่ายด้วยค่าเสื่อมเดิม)', () => {
  it('ซอฟต์แวร์ที่ซื้อมา: บิลซื้อลง 1600100 · ตัดจำหน่าย ม.ค./ก.พ. ตามสูตร · พัฒนาเองถูกปฏิเสธ (capitalize_dev = false)', async () => {
    const a = fx.intangible_asset;
    const bill = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(a.vendor), issueDate: a.bill_date, lines: [{ description: a.name, qty: '1', unitPrice: a.cost, vat: true, accountCode: '1600100' }] });
    await approvePurchase(db, A, mgr, bill);
    await saveIntangibleAsset(db, A, { code: a.code, name: a.name, startDate: a.bill_date, lifeYears: a.life_years, cost: a.cost, origin: 'purchased', sourceDocumentId: bill });
    await expect(saveIntangibleAsset(db, A, { code: 'IA-DEV', name: 'พัฒนาเอง', startDate: '2026-01-01', lifeYears: '3', cost: '100000.00', origin: 'internal_dev' })).rejects.toThrow(/capitalize_dev/u);
    const row = await db.withCompany(A, (tx) => tx.selectFrom('acct.fixed_asset').select(['kind', 'intangible_origin', 'salvage', 'asset_account', 'accum_account', 'expense_account']).where('code', '=', a.code).executeTakeFirstOrThrow());
    expect(row).toEqual({ kind: 'intangible', intangible_origin: 'purchased', salvage: a.salvage, asset_account: '1600100', accum_account: '1600190', expense_account: '5150400' });
    for (const [ym, amt] of Object.entries(a.amortization)) expect((await depreciationFor(db, A, ym)).find((x) => x.code === a.code)!.amount).toBe(amt);
    const r = await runDepreciation(db, A, mgr, { fiscalYear: 2569, periodNo: 1 });
    const j = await db.withCompany(A, (tx) => tx.selectFrom('acct.journal').select('id').where('journal_no', '=', r.journalNo!).executeTakeFirstOrThrow());
    expect(set(await journalTuples(j.id))).toEqual(set([['Dr', '5150400', a.amortization['2026-01']!], ['Cr', '1600190', a.amortization['2026-01']!]]));
  });
});

describe('ตรวจความถูกต้อง + Dr=Cr', () => {
  it('recon deferred_revenue: ตารางที่ยังไม่รับรู้ = GL 2170100 (ม.ค. / ก.พ. / ปี 2569) · IV ↔ GL ผ่าน', async () => {
    for (const p of ['2026-01', '2026-02', '2569']) {
      const r = await reconChecks(db, A, p);
      expect(r.checks.find((c) => c.key === 'deferred_revenue')).toMatchObject({ ok: true });
      expect(r.checks.find((c) => c.key === 'doc_iv')).toMatchObject({ ok: true });
    }
  });
  it('ทุก journal ของบริษัท Dr = Cr', async () => {
    const bad = await db.withCompany(A, (tx) => tx.selectFrom('acct.journal_line').select(['journal_id', (eb) => eb.fn.sum<string>('debit').as('dr'), (eb) => eb.fn.sum<string>('credit').as('cr')])
      .groupBy('journal_id').execute());
    expect(bad.length).toBeGreaterThan(10);
    for (const r of bad) expect(r.dr).toBe(r.cr);
  });
});

describe('RLS + โมดูลปิด = Phase 1', () => {
  it('บริษัทอื่นมองไม่เห็นสัญญา/ตาราง/ยอดใช้งาน/ภ.พ.36 · เขียนข้ามบริษัทไม่ได้', async () => {
    const counts = await db.withCompany(B, async (tx) => Promise.all([
      tx.selectFrom('acct.contract').select('id').execute(), tx.selectFrom('acct.contract_line').select('id').execute(), tx.selectFrom('acct.revenue_schedule').select('id').execute(),
      tx.selectFrom('acct.usage_record').select('id').execute(), tx.selectFrom('acct.pp36_entry').select('id').execute(), tx.selectFrom('acct.revenue_recognition_run').select('id').execute(),
    ]));
    expect(counts.map((x) => x.length)).toEqual([0, 0, 0, 0, 0, 0]);
    expect((await getContract(db, B, ids['CT-001']!))).toBeNull();
    await expect(db.withCompany(B, (tx) => tx.insertInto('acct.contract').values({ company_id: A, code: 'X', contact_id: ids['CT-001']!, start_date: '2026-01-01', end_date: '2026-12-31',
      billing_cycle: 'monthly', notes: null, created_by: null }).execute())).rejects.toThrow(/row-level security/u);
  });
  it('โมดูลปิด: สร้างสัญญา/ยอดใช้งาน/ภ.ง.ด.54 ไม่ได้ · IV ลงรายได้ตามเดิม · จุดตรวจ recon เท่าเดิม (ไม่มีจุดตรวจ SWT)', async () => {
    await expect(saveContract(db, B, clerk, { code: 'K1', contactId: await contact('C-SAAS', B), startDate: '2026-01-01', endDate: '2026-12-31', billingCycle: 'monthly',
      lines: [{ kind: 'subscription', description: 's', amount: '100.00' }] })).rejects.toThrow(/software/u);
    await expect(recordUsage(db, B, { contractCode: 'K1', lineNo: 1, usageDate: '2026-01-01', qty: '1' })).rejects.toThrow(/software/u);
    const exp = await savePurchaseDraft(db, B, clerk, { docType: 'EXP', contactId: await contact('V-LIC', B), issueDate: '2026-02-10', payNow: true, payFrom: '1100100',
      lines: [{ description: 'Royalty', qty: '1', unitPrice: '1000.00', vat: false, accountCode: '5306100', whtType: 'pnd54_royalty' }] });
    await expect(approvePurchase(db, B, mgr, exp)).rejects.toThrow(/software/u);
    // ผู้ขายต่างประเทศ โมดูลปิด: จ่ายแบบ Phase 1 (ไม่มี ภ.พ.36)
    const exp2 = await savePurchaseDraft(db, B, clerk, { docType: 'EXP', contactId: await contact('V-CLOUD', B), issueDate: '2026-02-10', payNow: true, payFrom: '1100100',
      lines: [{ description: 'Cloud', qty: '1', unitPrice: '1000.00', vat: false, accountCode: '5306100' }] });
    await approvePurchase(db, B, mgr, exp2);
    expect(set(await docJournal(exp2, B))).toEqual(set([['Dr', '5306100', '1000.00'], ['Cr', '1100100', '1000.00']]));
    const iv = await saveSalesDraft(db, B, clerk, { docType: 'IV', contactId: await contact('C-SAAS', B), issueDate: '2026-02-01', lines: [{ description: 'บริการ', qty: '1', unitPrice: '1000.00' }] });
    await approveDocument(db, B, mgr, iv);
    expect(set(await docJournal(iv, B))).toEqual(set([['Dr', '1130100', '1070.00'], ['Cr', '4100200', '1000.00'], ['Cr', '2150400', '70.00']]));
    const rc = await reconChecks(db, B, '2026-02');
    expect(rc.checks).toHaveLength(16);
    expect(rc.checks.some((c) => SWT_KEYS.includes(c.key))).toBe(false);
    expect(await glBalance('2170100', B)).toEqual({ dr: null, cr: null });
  });
});
