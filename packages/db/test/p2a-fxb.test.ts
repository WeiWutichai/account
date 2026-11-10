// Phase 2A FXB — หลายสกุลเงิน + สาขา · ตัวเลขจาก fixtures/p2a-fx.json (ร่าง รอ Wei ยืนยัน)
// golden FX · กำไร/ขาดทุนที่เกิดขึ้นจริง · ปรับมูลค่าสิ้นงวด + กลับรายการ · VAT เป็นบาท · ขายส่งออก 0% · กรองสาขาในรายงานภาษี/ภ.พ.30
// · เลขที่แยกสาขา · RLS ตารางใหม่ · บริษัทบาทอย่างเดียว/ปิดโมดูล = Phase 1 เดิม
import { type JournalLineTuple } from '@innovera/ledger';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import {
  companyModules, disableModule, enableModule, fxbSettings, FXB_DEFAULTS, FXB_KEYS, listBranches, listCurrencies, listRates, moduleOn, rateOn, revaluationPreview, revaluationRuns, runRevaluation,
  saveBranch, saveCurrency, saveRate, setFxbSetting,
} from '../src/fx.ts';
import type { Db } from '../src/index.ts';
import { approvePayment, approvePurchase, createPayment, savePurchaseDraft } from '../src/purchase.ts';
import { aging, reconChecks, vatReports } from '../src/reports.ts';
import { approveDocument, convertDocument, receivePayment, saveSalesDraft, voidDocument, type Actor } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { admin, appDb, freshSchema } from './helpers.ts';

type Doc = { doc_no: string; date: string; contact: string; currency?: string; rate?: string; rule?: string; tax_mode?: 'on_payment' | 'immediate'; branch?: string;
  lines?: { desc: string; qty: string; unit_price: string; vat: string | boolean; account?: string }[]; totals_thb?: { grand_total: string; vat: string; base: string };
  expected_journal: JournalLineTuple[]; expected_fx?: [string, string][]; vat_report_row?: { base: string; vat: string; rate?: string } } & Record<string, unknown>;
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/p2a-fx.json', import.meta.url), 'utf8')) as {
  _meta: { status: string }; rates: { currency: string; date: string; source: 'bot_mid'; rate: string }[]; contacts: { code: string; name: string; kind: 'customer' | 'vendor' }[];
  documents: Record<string, Doc>;
  revaluation_2569_11: { as_of: string; lines: { doc: string; open_fx: string; carrying: string; revalued: string; adjustment: string }[]; total: string; expected_journal: JournalLineTuple[]; reversal: { date: string; expected_journal: JournalLineTuple[] } };
  vat_2569_11: Record<'all' | 'branch_00000' | 'branch_00001', { output_vat: string; zero_rated_sales: string; taxable_sales: string; input_vat: string; net_payable: string; sales_base?: string }> & { deferred_vat_2150400: string };
  aging_ar: Record<string, { total: string }>;
};
const D = (k: string) => fx.documents[k]!;
const clerk: Actor = { userId: '00000000-0000-4000-8000-0000000000f1', role: 'accountant' };
const director = { userId: '00000000-0000-4000-8000-0000000000f2', role: 'owner' as const, approvalLimit: null };

let db: Db;
let A = ''; // เปิดทั้งสองโมดูล
let B = ''; // บริษัทอื่น (ทดสอบ RLS)
let T = ''; // บาทอย่างเดียว ปิดโมดูล
const ids: Record<string, string> = {};
const contactIds: Record<string, string> = {};

async function journalOf(company: string, docId: string, which: 'journal_id' | 'void_journal_id' = 'journal_id') {
  return db.withCompany(company, async (tx) => {
    const d = await tx.selectFrom('acct.document').select(['journal_id', 'void_journal_id']).where('id', '=', docId).executeTakeFirstOrThrow();
    return linesOf(company, d[which]!);
  });
}
async function linesOf(company: string, journalId: string) {
  return db.withCompany(company, async (tx) => {
    const ls = await tx.selectFrom('acct.journal_line').select(['account_code', 'debit', 'credit', 'currency', 'amount_fx', 'branch_code']).where('journal_id', '=', journalId).orderBy('line_no').execute();
    return { tuples: ls.map((l) => (Number(l.debit) > 0 ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit]) as JournalLineTuple), raw: ls };
  });
}
const doc = (company: string, id: string) => db.withCompany(company, (tx) => tx.selectFrom('acct.document').selectAll().where('id', '=', id).executeTakeFirstOrThrow());

async function salesDoc(k: string, company = A) {
  const d = D(k);
  const id = await saveSalesDraft(db, company, clerk, {
    docType: 'IV', contactId: contactIds[d.contact]!, issueDate: d.date, ruleCode: d.rule!, taxMode: d.tax_mode!,
    ...(d.currency && d.currency !== 'THB' ? { currency: d.currency } : {}), ...(d.rate_note ? { fxRate: d.rate! } : {}), ...(d.branch && d.branch !== '00000' ? { branchCode: d.branch } : {}),
    lines: d.lines!.map((l) => ({ description: l.desc, qty: l.qty, unitPrice: l.unit_price, vatCode: l.vat as 'vat7' | 'zero', ...(l.account ? { accountCode: l.account } : {}) })),
  });
  const r = await approveDocument(db, company, clerk, id);
  ids[k] = id;
  return r;
}
async function purchaseDoc(k: string) {
  const d = D(k);
  const id = await savePurchaseDraft(db, A, clerk, {
    docType: 'AP', contactId: contactIds[d.contact]!, issueDate: d.date, ...(d.currency && d.currency !== 'THB' ? { currency: d.currency } : {}), ...(d.branch && d.branch !== '00000' ? { branchCode: d.branch } : {}),
    lines: d.lines!.map((l) => ({ description: l.desc, qty: l.qty, unitPrice: l.unit_price, vat: l.vat === true, accountCode: l.account! })),
  });
  const r = await approvePurchase(db, A, director, id);
  ids[k] = id;
  return r;
}

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'กลุ่ม FXB');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ทดสอบสกุลเงิน จำกัด' });
  B = await createCompany(db, { orgId: org, nameTh: 'บริษัท อื่น จำกัด' });
  T = await createCompany(db, { orgId: org, nameTh: 'บริษัท บาทอย่างเดียว จำกัด' });
  for (const c of [A, B, T]) await seedCompany(db, c, 2569, { sample: false });
  for (const c of [A, T]) {
    for (const k of fx.contacts) {
      const r = await db.withCompany(c, (tx) => tx.insertInto('acct.contact').values({ company_id: c, code: k.code, name: k.name, kind: k.kind, tax_id: null, branch_code: null, external_source: null, external_ref: null,
        address: null, contact_person: null, phone: null, email: null, credit_days: null, credit_limit: null }).returning('id').executeTakeFirstOrThrow());
      if (c === A) contactIds[k.code] = r.id;
    }
  }
}, 120_000);
afterAll(() => db.close());

describe('โมดูล + ทะเบียน + ค่าตั้ง (รอผู้สอบบัญชี)', () => {
  it('ค่าตั้งต้นชั่วคราว: bot_mid · ไม่ปรับมูลค่าสิ้นงวด · เลขที่ร่วม · ยื่นแยกสาขา', async () => {
    await expect(fxbSettings(db, T)).resolves.toEqual({ ...FXB_DEFAULTS, pendingAuditor: true });
    expect(FXB_DEFAULTS).toEqual({ rateSource: 'bot_mid', revaluePeriodEnd: false, numbering: 'shared', vatFiling: 'separate' });
    await expect(setFxbSetting(db, A, FXB_KEYS.numbering, 'whatever')).rejects.toThrow('ต้องเป็น');
  });
  it('ปิดโมดูล: สกุลต่างประเทศ/สาขา/ทะเบียน ใช้ไม่ได้', async () => {
    expect(await moduleOn(db, T, 'multi_currency')).toBe(false);
    const base = { docType: 'IV' as const, contactId: '', issueDate: '2026-11-05', lines: [{ description: 'x', qty: '1', unitPrice: '1.00' }] };
    base.contactId = (await db.withCompany(T, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', 'FXC01').executeTakeFirstOrThrow())).id;
    await expect(saveSalesDraft(db, T, clerk, { ...base, currency: 'USD', fxRate: '33.000000' })).rejects.toThrow('ยังไม่ได้เปิดโมดูลหลายสกุลเงิน');
    await expect(saveSalesDraft(db, T, clerk, { ...base, branchCode: '00001' })).rejects.toThrow('ยังไม่ได้เปิดโมดูลสาขา');
    await expect(saveCurrency(db, T, { code: 'USD', name: 'ดอลลาร์สหรัฐ' })).rejects.toThrow('ยังไม่ได้เปิดโมดูลหลายสกุลเงิน');
    await expect(saveBranch(db, T, { code: '00001', name: 'สาขา 1' })).rejects.toThrow('ยังไม่ได้เปิดโมดูลสาขา');
  });
  it('เปิดโมดูล: สร้างบัญชี 4910100/5920100 (ไม่ทับชื่อที่แก้) + สำนักงานใหญ่ 00000', async () => {
    await enableModule(db, A, 'multi_currency');
    await db.withCompany(A, (tx) => tx.updateTable('acct.account').set({ name: 'กำไรจากอัตราแลกเปลี่ยน (แก้ชื่อ)' }).where('code', '=', '4910100').execute());
    await enableModule(db, A, 'multi_currency');
    await enableModule(db, A, 'branches');
    const accts = await db.withCompany(A, (tx) => tx.selectFrom('acct.account').select(['code', 'name', 'type']).where('code', 'in', ['4910100', '5920100', '4900100']).orderBy('code').execute());
    expect(accts).toEqual([
      { code: '4900100', name: 'กำไร(ขาดทุน)จากส่วนต่าง', type: 'revenue' },
      { code: '4910100', name: 'กำไรจากอัตราแลกเปลี่ยน (แก้ชื่อ)', type: 'revenue' },
      { code: '5920100', name: 'ขาดทุนจากอัตราแลกเปลี่ยน', type: 'expense' },
    ]);
    expect(await moduleOn(db, A, 'multi_currency')).toBe(true);
    expect(await db.withCompany(T, (tx) => tx.selectFrom('acct.account').select('code').where('code', 'in', ['4910100', '5920100']).execute())).toEqual([]);
    await saveBranch(db, A, { code: '00001', name: 'สาขา 1', address: 'ถนนทดสอบ' });
    await expect(saveBranch(db, A, { code: '1', name: 'ผิด' })).rejects.toThrow('5 หลัก');
    expect((await listBranches(db, A)).map((b) => [b.code, b.name, b.files_separately])).toEqual([['00000', 'สำนักงานใหญ่', true], ['00001', 'สาขา 1', true]]);
  });
  it('สกุลเงิน + อัตรา (กรอกเอง) · อัตรา ณ วันที่ = ล่าสุดที่ไม่เกินวันนั้น', async () => {
    await saveCurrency(db, A, { code: 'USD', name: 'ดอลลาร์สหรัฐ' });
    await expect(saveCurrency(db, A, { code: 'THB', name: 'บาท' })).rejects.toThrow('ไม่ใช่ THB');
    for (const r of fx.rates) await saveRate(db, A, clerk.userId, r);
    await expect(saveRate(db, A, null, { currency: 'USD', date: '2026-11-01', rate: '-1' })).rejects.toThrow('มากกว่า 0');
    await expect(saveRate(db, A, null, { currency: 'EUR', date: '2026-11-01', rate: '36.000000' })).rejects.toThrow('ยังไม่ได้ตั้งสกุลเงิน EUR');
    expect(await listCurrencies(db, A)).toEqual([{ code: 'USD', name: 'ดอลลาร์สหรัฐ', decimals: 2, active: true }]);
    expect((await listRates(db, A, { currency: 'USD' })).length).toBe(fx.rates.length);
    expect(await rateOn(db, A, 'USD', '2026-11-22')).toBe('33.800000');
    await expect(rateOn(db, A, 'USD', '2026-11-01')).rejects.toThrow('ไม่มีอัตราแลกเปลี่ยน');
  });
});

describe('เอกสารสกุลต่างประเทศ → journal บาท (fixtures/p2a-fx.json)', () => {
  it(`ร่างชุดตัวเลข: ${fx._meta.status}`, () => expect(fx._meta.status).toBe('ร่าง รอ Wei ยืนยัน'));
  it('IV-USD: 10,700.00 USD @ 33.25 → ลูกหนี้ 355,775.00 · ภาษีขายยังไม่ถึงกำหนด 23,275.00 · บรรทัดเก็บยอด USD', async () => {
    const d = D('IV-USD');
    const r = await salesDoc('IV-USD');
    expect(r.docNo).toBe(d.doc_no);
    const j = await journalOf(A, ids['IV-USD']!);
    expect(j.tuples).toEqual(d.expected_journal);
    expect(j.raw.map((l) => [l.account_code, l.amount_fx])).toEqual(d.expected_fx);
    expect(j.raw.every((l) => l.currency === 'USD')).toBe(true);
    const row = await doc(A, ids['IV-USD']!);
    expect([row.currency, row.fx_rate, row.grand_total, row.vat]).toEqual(['USD', d.rate, '10700.00', '700.00']);
    expect([row.grand_total_thb, row.vat_thb, row.base_thb]).toEqual([d.totals_thb!.grand_total, d.totals_thb!.vat, d.totals_thb!.base]);
  });
  it('IV-EXPORT: อัตราที่ระบุบนเอกสาร 33.30 · บรรทัด 0% (vat_rate 0) · ไม่มีภาษีขาย', async () => {
    const d = D('IV-EXPORT');
    expect((await salesDoc('IV-EXPORT')).docNo).toBe(d.doc_no);
    expect((await journalOf(A, ids['IV-EXPORT']!)).tuples).toEqual(d.expected_journal);
    const line = await db.withCompany(A, (tx) => tx.selectFrom('acct.document_line').select('vat_rate').where('document_id', '=', ids['IV-EXPORT']!).executeTakeFirstOrThrow());
    expect(line.vat_rate).toBe('0.0000');
    expect((await doc(A, ids['IV-EXPORT']!)).grand_total_thb).toBe(d.totals_thb!.grand_total);
    await expect(saveSalesDraft(db, A, clerk, { docType: 'IV', contactId: contactIds.FXC02!, issueDate: '2026-11-12', lines: [
      { description: 'a', qty: '1', unitPrice: '1.00', vatCode: 'zero' }, { description: 'b', qty: '1', unitPrice: '1.00', vatCode: 'vat7' }] })).rejects.toThrow('ทั้ง VAT 7% และ 0%');
  });
  it('แปลง QO สกุลต่างประเทศ → IV: สกุล อัตรา และบรรทัด 0% ตามต้นทาง (ร่าง ไม่ลงบัญชี)', async () => {
    const qo = await saveSalesDraft(db, A, clerk, { docType: 'QO', contactId: contactIds.FXC02!, issueDate: '2026-11-12', currency: 'USD',
      lines: [{ description: 'บริการส่งออก', qty: '2', unitPrice: '100.00', vatCode: 'zero' }] });
    expect((await doc(A, qo)).fx_rate).toBe('33.400000'); // อัตราล่าสุดไม่เกินวันที่เอกสาร (10/11)
    await approveDocument(db, A, clerk, qo);
    const iv = await convertDocument(db, A, clerk, qo, 'IV', { issueDate: '2026-11-12' });
    const row = await doc(A, iv);
    expect([row.status, row.currency, row.fx_rate, row.vat, row.grand_total]).toEqual(['draft', 'USD', '33.400000', '0.00', '200.00']);
    const l = await db.withCompany(A, (tx) => tx.selectFrom('acct.document_line').select('vat_rate').where('document_id', '=', iv).executeTakeFirstOrThrow());
    expect(l.vat_rate).toBe('0.0000');
  });
  it('AP-USD: 2,000.00 USD @ 33.40 → เจ้าหนี้ 66,800.00', async () => {
    const d = D('AP-USD');
    expect((await purchaseDoc('AP-USD')).docNo).toBe(d.doc_no);
    expect((await journalOf(A, ids['AP-USD']!)).tuples).toEqual(d.expected_journal);
    await expect(savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: contactIds.FXV01!, issueDate: '2026-11-10', currency: 'USD',
      lines: [{ description: 'x', qty: '1', unitPrice: '1.00', vat: false, accountCode: '5306100', whtType: 'service' }] })).rejects.toThrow('ภ.ง.ด.54');
  });
  it('RV-USD-partial: รับ 5,350.00 USD @ 33.80 ล้างลูกหนี้ @ 33.25 → กำไรที่เกิดขึ้นจริง 2,942.50 (4910100) · โอนภาษีขายเป็นบาท', async () => {
    const d = D('RV-USD-partial');
    const r = await receivePayment(db, A, clerk, { contactId: contactIds.FXC01!, date: d.date, receiveAccount: d.receive_account as string, fxRate: d.rate!,
      applications: [{ documentId: ids['IV-USD']!, applied: '5350.00' }] });
    ids['RV-USD-partial'] = r.id;
    expect(r.docNo).toBe(d.doc_no);
    const j = await journalOf(A, r.id);
    expect(j.tuples).toEqual(d.expected_journal);
    expect(j.raw.find((l) => l.account_code === '1130100')).toMatchObject({ currency: 'USD', amount_fx: '5350.00' });
    expect(j.raw.find((l) => l.account_code === '4910100')).toMatchObject({ currency: null, amount_fx: null });
    const s = await db.withCompany(A, (tx) => tx.selectFrom('acct.settlement').select(['applied', 'settled_thb', 'vat_due', 'vat_due_thb']).where('payment_id', '=', r.id).executeTakeFirstOrThrow());
    expect(s).toEqual({ applied: '5350.00', settled_thb: d.ar_cleared_thb, vat_due: d.vat_due_fx, vat_due_thb: d.vat_due_thb });
  });
  it('PV-USD: จ่าย 2,000.00 USD @ 33.60 ล้างเจ้าหนี้ @ 33.40 → ขาดทุนที่เกิดขึ้นจริง 400.00 (5920100)', async () => {
    const d = D('PV-USD');
    const pv = await createPayment(db, A, clerk, { contactId: contactIds.FXV01!, date: d.date, payFrom: d.pay_from as string, fxRate: d.rate!, bills: [{ documentId: ids['AP-USD']!, settle: '2000.00' }] });
    const r = await approvePayment(db, A, director, pv.id);
    ids['PV-USD'] = pv.id;
    expect(r.docNo).toBe(d.doc_no);
    expect((await journalOf(A, pv.id)).tuples).toEqual(d.expected_journal);
    expect((await doc(A, pv.id)).grand_total_thb).toBe(d.paid_thb);
  });
});

describe('สาขา: เลขที่แยกสาขา (branch.numbering) · journal_line.branch_code', () => {
  it('IV-HQ เลขที่ร่วม · ตั้ง per_branch แล้ว IV-B1/AP-B1 ได้เลขของสาขา 00001', async () => {
    expect((await salesDoc('IV-HQ')).docNo).toBe(D('IV-HQ').doc_no);
    await setFxbSetting(db, A, FXB_KEYS.numbering, 'per_branch');
    expect((await salesDoc('IV-B1')).docNo).toBe(D('IV-B1').doc_no);
    expect((await purchaseDoc('AP-B1')).docNo).toBe(D('AP-B1').doc_no);
    for (const k of ['IV-HQ', 'IV-B1', 'AP-B1']) expect((await journalOf(A, ids[k]!)).tuples).toEqual(D(k).expected_journal);
    const b1 = await journalOf(A, ids['IV-B1']!);
    expect(b1.raw.every((l) => l.branch_code === '00001' && l.currency === null)).toBe(true);
    await expect(saveSalesDraft(db, A, clerk, { docType: 'IV', contactId: contactIds.FXC03!, issueDate: '2026-11-16', branchCode: '00009', lines: [{ description: 'x', qty: '1', unitPrice: '1.00' }] }))
      .rejects.toThrow('ไม่พบสาขา 00009');
  });
});

describe('รายงานภาษี 11/2569: ยอดบาท · ขายส่งออก 0% · กรองสาขา · ภ.พ.30', () => {
  it('ทั้งบริษัท', async () => {
    const v = await vatReports(db, A, '2026-11');
    const e = fx.vat_2569_11.all;
    expect([v.sales.vat, v.sales.base, v.pp30.zeroRatedSales, v.pp30.taxableSales, v.pp30.inputVat, v.pp30.netPayable]).toEqual([e.output_vat, e.sales_base, e.zero_rated_sales, e.taxable_sales, e.input_vat, e.net_payable]);
    expect(v.pp30.salesTotal).toBe(e.sales_base);
    const rv = v.sales.rows.find((r) => r.docId === ids['RV-USD-partial']);
    const rvRow = D('RV-USD-partial').vat_report_row!;
    expect({ base: rv?.base, vat: rv?.vat }).toEqual({ base: rvRow.base, vat: rvRow.vat });
    const ex = v.sales.rows.find((r) => r.docId === ids['IV-EXPORT']);
    expect({ base: ex?.base, vat: ex?.vat, rate: ex?.rate }).toEqual(D('IV-EXPORT').vat_report_row);
    expect(v.deferredService.map((x) => x.vatPending)).toEqual([fx.vat_2569_11.deferred_vat_2150400]);
    expect(v.vatFiling).toBe('separate');
    expect(v.byBranch).toEqual([
      { branch: '00000', outputVat: fx.vat_2569_11.branch_00000.output_vat, inputVat: fx.vat_2569_11.branch_00000.input_vat, netPayable: fx.vat_2569_11.branch_00000.net_payable },
      { branch: '00001', outputVat: fx.vat_2569_11.branch_00001.output_vat, inputVat: fx.vat_2569_11.branch_00001.input_vat, netPayable: fx.vat_2569_11.branch_00001.net_payable },
    ]);
  });
  it.each(['00000', '00001'] as const)('สาขา %s', async (b) => {
    const v = await vatReports(db, A, '2026-11', { branch: b });
    const e = fx.vat_2569_11[`branch_${b}`];
    expect([v.branch, v.pp30.outputVat, v.pp30.zeroRatedSales, v.pp30.taxableSales, v.pp30.inputVat, v.pp30.netPayable]).toEqual([b, e.output_vat, e.zero_rated_sales, e.taxable_sales, e.input_vat, e.net_payable]);
    expect(v.sales.rows.every((r) => r.docBranch === b)).toBe(true);
    expect(v.purchases.rows.every((r) => r.docBranch === b)).toBe(true);
  });
});

describe('ปรับมูลค่าสิ้นงวด 11/2569 (fx.revalue_period_end) + กลับรายการ 1/12', () => {
  const rv = fx.revaluation_2569_11;
  it('ค่าตั้งต้นปิด → รันไม่ได้', async () => {
    await expect(runRevaluation(db, A, director, { fiscalYear: 2569, periodNo: 11 })).rejects.toThrow('ปิดการปรับมูลค่าสิ้นงวดอยู่');
  });
  it('ตัวอย่าง + ลงบัญชี + กลับรายการ · รันซ้ำไม่ได้', async () => {
    await setFxbSetting(db, A, FXB_KEYS.revaluePeriodEnd, true);
    const p = await revaluationPreview(db, A, { fiscalYear: 2569, periodNo: 11 });
    expect(p.lines.map((l) => [l.documentId, l.openFx, l.carrying, l.revalued, l.adjustment])).toEqual(rv.lines.map((l) => [ids[l.doc], l.open_fx, l.carrying, l.revalued, l.adjustment]));
    const r = await runRevaluation(db, A, director, { fiscalYear: 2569, periodNo: 11 });
    expect([r.asOf, r.total]).toEqual([rv.as_of, rv.total]);
    const runs = await revaluationRuns(db, A, 2569);
    expect(runs.map((x) => [x.journal_no, x.reversal_no, x.reversal_date])).toEqual([[r.journalNo, `${r.journalNo}R`, rv.reversal.date]]);
    const ids2 = await db.withCompany(A, (tx) => tx.selectFrom('acct.fx_revaluation').select(['journal_id', 'reversal_journal_id']).executeTakeFirstOrThrow());
    expect((await linesOf(A, ids2.journal_id!)).tuples).toEqual(rv.expected_journal);
    expect((await linesOf(A, ids2.reversal_journal_id!)).tuples).toEqual(rv.reversal.expected_journal);
    await expect(runRevaluation(db, A, director, { fiscalYear: 2569, periodNo: 11 })).rejects.toThrow('งวดนี้แล้ว');
  });
  it('อายุลูกหนี้ = GL 1130100 ทั้งสิ้นงวด (รวมปรับมูลค่า) และหลังกลับรายการ', async () => {
    for (const asOf of ['2026-11-30', '2026-12-01']) {
      const a = await aging(db, A, asOf, 'AR');
      expect([a.totals.total, a.gl.balance, a.gl.diff]).toEqual([fx.aging_ar[asOf]!.total, fx.aging_ar[asOf]!.total, '0.00']);
    }
    const ap = await aging(db, A, '2026-11-30', 'AP');
    expect(ap.gl.diff).toBe('0.00');
  });
  it('รายงานตรวจความถูกต้อง 11/2569: ทุกจุดตรวจผ่าน (เอกสาร ↔ GL · ภาษี ↔ GL · ลูกหนี้/เจ้าหนี้ ↔ บัญชีคุม)', async () => {
    const r = await reconChecks(db, A, '2026-11');
    expect(r.checks.filter((c) => !c.ok).map((c) => [c.key, c.byDocs, c.byGl])).toEqual([]);
  });
});

describe('Dr = Cr ทุก journal · ยกเลิกใบรับสกุลต่างประเทศ', () => {
  it('ทุก journal ของบริษัทดุล', async () => {
    const bad = await db.withCompany(A, (tx) => tx.selectFrom('acct.journal_line').select(['journal_id']).groupBy('journal_id').having((eb) => eb(eb.fn.sum('debit'), '<>', eb.fn.sum('credit'))).execute());
    expect(bad).toEqual([]);
  });
  it('ยกเลิก RV สกุลต่างประเทศ → กลับรายการพร้อมยอด USD · ลูกหนี้กลับเป็นยอดเดิม', async () => {
    const id = ids['RV-USD-partial']!;
    await voidDocument(db, A, director, id, { reason: 'ทดสอบ', date: '2026-12-01' });
    const rev = await journalOf(A, id, 'void_journal_id');
    expect(rev.raw.find((l) => l.account_code === '1130100')).toMatchObject({ debit: '177887.50', currency: 'USD', amount_fx: '5350.00' });
  });
});

describe('บริษัทบาทอย่างเดียว (ปิดโมดูล) = Phase 1 เดิม', () => {
  it('IV + RV บาท: ไม่มี fx_rate / ยอดบาทแยก / currency บน journal', async () => {
    const c = (await db.withCompany(T, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', 'FXC03').executeTakeFirstOrThrow())).id;
    const id = await saveSalesDraft(db, T, clerk, { docType: 'IV', contactId: c, issueDate: '2026-11-05', lines: [{ description: 'บริการ', qty: '1', unitPrice: '10000.00' }] });
    const iv = await approveDocument(db, T, clerk, id);
    expect(iv.docNo).toBe('IV2611-0001');
    expect((await journalOf(T, id)).tuples).toEqual([['Dr', '1130100', '10700.00'], ['Cr', '4100200', '10000.00'], ['Cr', '2150400', '700.00']]);
    const r = await receivePayment(db, T, clerk, { contactId: c, date: '2026-11-20', receiveAccount: '1100100', applications: [{ documentId: id, applied: '10700.00' }] });
    expect((await journalOf(T, r.id)).tuples).toEqual([['Dr', '1100100', '10700.00'], ['Dr', '2150400', '700.00'], ['Cr', '1130100', '10700.00'], ['Cr', '2150100', '700.00']]);
    for (const d of [id, r.id]) {
      const row = await doc(T, d);
      expect([row.currency, row.fx_rate, row.grand_total_thb, row.vat_thb, row.base_thb, row.branch_code]).toEqual(['THB', null, null, null, null, '00000']);
      expect((await journalOf(T, d)).raw.every((l) => l.currency === null && l.amount_fx === null && l.branch_code === '00000')).toBe(true);
    }
    const s = await db.withCompany(T, (tx) => tx.selectFrom('acct.settlement').select(['settled_thb', 'vat_due_thb']).executeTakeFirstOrThrow());
    expect(s).toEqual({ settled_thb: null, vat_due_thb: null });
    const v = await vatReports(db, T, '2026-11');
    expect([v.pp30.outputVat, v.pp30.taxableSales, v.pp30.zeroRatedSales, v.pp30.salesTotal, v.byBranch.length]).toEqual(['700.00', '10000.00', '0.00', '10000.00', 1]);
  });
});

describe('RLS: ตารางใหม่ไม่รั่วข้ามบริษัท', () => {
  it('บริษัท B มองไม่เห็นสกุลเงิน/อัตรา/สาขา/ปรับมูลค่าของ A และเขียนแทน A ไม่ได้', async () => {
    const seen = await db.withCompany(B, async (tx) => ({
      currency: (await tx.selectFrom('acct.currency').select('code').execute()).length,
      rate: (await tx.selectFrom('acct.exchange_rate').select('rate').execute()).length,
      branch: (await tx.selectFrom('acct.branch').select('code').execute()).length,
      reval: (await tx.selectFrom('acct.fx_revaluation').select('total').execute()).length,
    }));
    expect(seen).toEqual({ currency: 0, rate: 0, branch: 0, reval: 0 });
    await expect(db.withCompany(B, (tx) => tx.insertInto('acct.branch').values({ company_id: A, code: '00002', name: 'แอบเขียน', address: null, tax_id: null }).execute())).rejects.toThrow();
    const n = await admin(async (c) => (await c.query<{ n: string }>("select count(*) n from pg_policies where schemaname = 'acct' and tablename in ('currency', 'exchange_rate', 'branch', 'fx_revaluation')")).rows[0]!.n);
    expect(n).toBe('4');
  });
});

describe('สถานะโมดูล + ปิดโมดูล (หน้า ตั้งค่า / โมดูล)', () => {
  it('companyModules: บริษัทบาทอย่างเดียว = ปิดทุกโมดูล · บริษัท A เปิดหลายสกุลเงิน + สาขา', async () => {
    await expect(companyModules(db, B)).resolves.toEqual({ inventory: false, multi_currency: false, branches: false, software: false });
    await expect(companyModules(db, A)).resolves.toEqual({ inventory: false, multi_currency: true, branches: true, software: false });
  });
  it('ปิดไม่ได้เมื่อมีเอกสารสกุลต่างประเทศ/สาขาอื่นแล้ว · ยังไม่มีเอกสาร = ปิดได้ (ข้อมูลทะเบียนคงอยู่)', async () => {
    await expect(disableModule(db, A, 'multi_currency')).rejects.toThrow('มีเอกสารสกุลต่างประเทศแล้ว');
    await expect(disableModule(db, A, 'branches')).rejects.toThrow('มีเอกสารของสาขาอื่นแล้ว');
    await enableModule(db, B, 'multi_currency');
    await enableModule(db, B, 'branches');
    await saveCurrency(db, B, { code: 'EUR', name: 'ยูโร' });
    await disableModule(db, B, 'multi_currency');
    await disableModule(db, B, 'branches');
    await expect(companyModules(db, B)).resolves.toEqual({ inventory: false, multi_currency: false, branches: false, software: false });
    expect((await listCurrencies(db, B)).map((c) => c.code)).toEqual(['EUR']);
    await expect(saveCurrency(db, B, { code: 'JPY', name: 'เยน' })).rejects.toThrow('ยังไม่ได้เปิดโมดูลหลายสกุลเงิน');
  });
});
