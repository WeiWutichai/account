// ข้อมูลหลัก + ทะเบียนเช็ค + ตั้งค่าบริษัท (ScreenContacts / ScreenProducts / ScreenCheque / ScreenSettings)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import {
  bounceCheque, chequeRegister, clearCheque, companySettings, contactDetail, contactsOverview, depositCheques, productDetail, productsOverview, saveCompanySettings, saveContact, saveProduct,
} from '../src/master.ts';
import { approveDocument, openItems, receivePayment, saveSalesDraft, type Actor } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

let db: Db;
let A = '';
const mgr: Actor = { userId: null, role: 'accounting_manager' };
const contact = async (code: string) => (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const balance = async (account: string) => db.withCompany(A, async (tx) => {
  const r = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', 'j.id', 'l.journal_id')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>(eb('l.debit', '-', eb.ref('l.credit'))), eb.val('0')).as('b')).where('l.account_code', '=', account).where('j.status', '!=', 'draft').executeTakeFirstOrThrow();
  return Number(r.b).toFixed(2);
});

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
}, 120_000);
afterAll(() => db.close());

/** IV ฐาน 90,000 + VAT = 96,300 (ยอดเช็ค 10456789 ใน fixtures) แล้วรับชำระด้วยเช็ค */
async function chequeReceipt(no: string, chequeDate: string, receivedOn = '2026-11-30') {
  const cid = await contact('C0055');
  const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: cid, issueDate: '2026-11-02', dueDate: '2026-12-02', priceInclVat: false, lines: [{ description: 'บริการ', qty: '1', unitPrice: '90000.00', vat: true }] });
  await approveDocument(db, A, mgr, iv);
  await receivePayment(db, A, mgr, { contactId: cid, date: receivedOn, receiveAccount: '1150100', cheque: { chequeNo: no, bank: '[ธนาคาร B] พระราม 9', chequeDate }, applications: [{ documentId: iv, applied: '96300.00' }] });
  const reg = await chequeRegister(db, A, 'received', '2026-11-30');
  return { iv, cid, cheque: reg.rows.find((r) => r.cheque_no === no)! };
}

describe('ทะเบียนเช็ครับ (ScreenCheque · สูตร CHQ-IN)', () => {
  it('รับ → นำฝาก → ผ่าน: ลงบัญชีทุกขั้น ยอดเช็ครอเรียกเก็บกลับเป็นศูนย์', async () => {
    const { cheque } = await chequeReceipt('10456789', '2026-11-30');
    expect(cheque).toMatchObject({ status: 'on_hand', amount: '96300.00', dueToday: true, postdated: false, payer: '[ลูกค้า E] จำกัด' });
    let reg = await chequeRegister(db, A, 'received', '2026-11-30');
    expect(reg.summary.dueToday).toEqual({ total: '96300.00', count: 1 });
    expect(await balance('1150100')).toBe('96300.00');
    await depositCheques(db, A, mgr, [cheque.id], '2026-11-30');
    expect(await balance('1150100')).toBe('0.00');
    expect(await balance('1150200')).toBe('96300.00');
    reg = await chequeRegister(db, A, 'received', '2026-11-30');
    expect(reg.summary.deposited).toEqual({ total: '96300.00', count: 1 });
    await expect(depositCheques(db, A, mgr, [cheque.id], '2026-11-30')).rejects.toThrow(/ไม่ได้อยู่ในมือ/u);
    const bankBefore = Number(await balance('1100100'));
    await clearCheque(db, A, mgr, cheque.id, { date: '2026-11-30', bankAccount: '1100100' });
    expect(await balance('1150200')).toBe('0.00');
    expect((Number(await balance('1100100')) - bankBefore).toFixed(2)).toBe('96300.00');
  });

  it('เช็คลงวันที่ล่วงหน้านำฝากก่อนวันที่บนเช็คไม่ได้', async () => {
    const { cheque } = await chequeReceipt('00881234', '2026-12-15');
    expect(cheque).toMatchObject({ postdated: true, dueToday: false });
    await expect(depositCheques(db, A, mgr, [cheque.id], '2026-11-30')).rejects.toThrow(/ล่วงหน้า/u);
    const reg = await chequeRegister(db, A, 'received', '2026-11-30');
    expect(reg.summary.onHand).toMatchObject({ total: '96300.00', count: 1, postdated: 1 });
  });

  it('เช็คคืนหลังนำฝาก: ใบรับชำระถูกยกเลิก ใบแจ้งหนี้กลับมาค้างรับ สุทธิ Dr ลูกหนี้ / Cr 1150200', async () => {
    const { cheque, iv, cid } = await chequeReceipt('77100456', '2026-11-30');
    await depositCheques(db, A, mgr, [cheque.id], '2026-11-30');
    const ar = await balance('1130100');
    await expect(bounceCheque(db, A, mgr, cheque.id, { date: '2026-11-30', reason: ' ' })).rejects.toThrow(/เหตุผล/u);
    await bounceCheque(db, A, mgr, cheque.id, { date: '2026-11-30', reason: 'เงินไม่พอ' });
    expect((Number(await balance('1130100')) - Number(ar)).toFixed(2)).toBe('96300.00');
    expect(await balance('1150200')).toBe('0.00');
    expect((await openItems(db, A, cid)).map((d) => d.id)).toContain(iv);
    const reg = await chequeRegister(db, A, 'received', '2026-11-30');
    expect(reg.rows.find((r) => r.id === cheque.id)).toMatchObject({ status: 'bounced', bounce_reason: 'เงินไม่พอ' });
    expect(reg.summary.bounced90).toEqual({ total: '96300.00', count: 1 });
  });
});

describe('คู่ค้า (ScreenContacts)', () => {
  it('ภาพรวม: นับตามบทบาท · ค้างรับตามบัญชีคุมรายคู่ค้า · ค้นหา', async () => {
    const o = await contactsOverview(db, A);
    expect(o.counts.total).toBe(o.rows.length);
    expect(o.rows.find((r) => r.code === 'C0055')?.ar).toBe('96300.00'); // ใบที่เช็คคืนกลับมาค้าง (2 ใบอื่นรับชำระแล้ว / เช็คในมือ)
    expect((await contactsOverview(db, A, { q: 'c0055' })).rows.map((r) => r.code)).toEqual(['C0055']);
    expect((await contactsOverview(db, A, { role: 'vendor' })).rows.every((r) => r.roles.includes('vendor'))).toBe(true);
  });
  it('เพิ่ม/แก้: หลายบทบาท · ตรวจเลขผู้เสียภาษี · รหัสซ้ำไม่ได้ · บันทึก audit', async () => {
    await expect(saveContact(db, A, null, { code: 'C9001', name: 'ทดสอบ', roles: ['customer'], taxId: '1234567890123' })).rejects.toThrow(/เลขประจำตัวผู้เสียภาษี/u);
    await expect(saveContact(db, A, null, { code: 'C0055', name: 'ซ้ำ', roles: ['customer'] })).rejects.toThrow(/มีอยู่แล้ว/u);
    const { id } = await saveContact(db, A, null, { code: 'C9001', name: '[ลูกค้า C] จำกัด', roles: ['customer', 'vendor'], taxId: '0105536000992', branchCode: '00000',
      creditDays: 30, creditLimit: '500000.00', arAccount: '1130100', pndForm: '53', priceLevel: 2, bankAccount: 'กสิกรไทย xxx-x-x5678-x' });
    const d = await contactDetail(db, A, id, '2026-11-30');
    expect(d?.contact).toMatchObject({ kind: 'both', roles: ['customer', 'vendor'], price_level: 2, pnd_form: '53', ar_account_label: '1130100 ลูกหนี้การค้า' });
    await saveContact(db, A, null, { code: 'C9001', name: '[ลูกค้า C] จำกัด', roles: ['vendor'] }, id);
    expect((await contactDetail(db, A, id, '2026-11-30'))?.contact.kind).toBe('vendor');
    const log = await db.withCompany(A, (tx) => tx.selectFrom('acct.audit_log').select('action').where('entity_id', '=', id).orderBy('id').execute());
    expect(log.map((l) => l.action)).toEqual(['contact.create', 'contact.update']);
  });
  it('รายละเอียด: ค้างรับ/เกินกำหนด/เอกสารล่าสุด', async () => {
    const d = await contactDetail(db, A, await contact('C0055'), '2026-12-31');
    expect(d?.openAr).toEqual({ count: 1, total: '96300.00', overdue: 1 });
    expect(d?.lastDoc).toMatch(/^RV2611-/u);
  });
});

describe('สินค้าและบริการ (ScreenProducts)', () => {
  it('นับตามประเภท · ราคา 1–5 · รหัสภาษี · สินค้าชุดต้องเปิดสต๊อก', async () => {
    const before = await productsOverview(db, A);
    await saveProduct(db, A, null, { code: 'E-0003', name: 'ค่าจ้างภายนอก', kind: 'expense', unit: 'งาน', vatCode: 'exempt', defaultWht: 'service', expenseAccount: '5301200' });
    await saveProduct(db, A, null, { code: 'S-0001', name: 'พัฒนาซอฟต์แวร์', kind: 'service', unit: 'ชั่วโมง', prices: ['1500.00', '1200.00', '1000.00'], vatCode: 'vat7', revenueAccount: '4100100' }, 'S-0001');
    await expect(saveProduct(db, A, null, { code: 'K-1', name: 'ชุด', kind: 'kit' })).rejects.toThrow(/สต๊อก/u);
    await expect(saveProduct(db, A, null, { code: 'S-0001', name: 'x', kind: 'service' })).rejects.toThrow(/มีอยู่แล้ว/u);
    const after = await productsOverview(db, A);
    expect(after.counts.total).toBe(before.counts.total + 1);
    expect(after.counts.expense).toBe(before.counts.expense + 1);
    const p = await productDetail(db, A, 'S-0001');
    expect(p?.product).toMatchObject({ price: '1500.0000', price_2: '1200.0000', price_3: '1000.0000', price_4: null, vat_code: 'vat7' });
    expect(p?.revenueLabel).toMatch(/^4100100 /u);
    expect((await productDetail(db, A, 'E-0003'))?.product).toMatchObject({ vat: false, vat_code: 'exempt' });
  });
});

describe('ตั้งค่าบริษัท (ScreenSettings)', () => {
  it('บันทึกข้อมูลบริษัท + ค่าเริ่มต้นเอกสาร · จุดภาษีเมื่อออกใบกำกับยังไม่รองรับ', async () => {
    const s = await companySettings(db, A);
    expect(s.defaults).toMatchObject({ saleCreditDays: 30, priceDefault: 'exclude_vat', rounding: 'last_line', printFont: 'Sarabun' });
    const input = { nameTh: 'บริษัท [ชื่อบริษัท] จำกัด', nameEn: '[Company Name] Co., Ltd.', taxId: '0105xxxxxxxxx', branchCode: '00000', address: '[เลขที่ ถนน แขวง เขต] กรุงเทพมหานคร 10xxx',
      phone: '02-xxx-xxxx', email: 'ar@[company].co.th', businessType: 'service' as const, vatRegistered: true, serviceTaxPoint: 'on_payment' as const,
      defaults: { ...s.defaults, purchaseCreditDays: 45, etax: true } };
    const saved = await saveCompanySettings(db, A, null, input);
    expect(saved.company).toMatchObject({ name_en: '[Company Name] Co., Ltd.', phone: '02-xxx-xxxx' });
    expect(saved.defaults).toMatchObject({ purchaseCreditDays: 45, etax: true });
    await expect(saveCompanySettings(db, A, null, { ...input, serviceTaxPoint: 'on_invoice' })).rejects.toThrow(/ยังไม่รองรับ/u);
    await expect(saveCompanySettings(db, A, null, { ...input, branchCode: '1' })).rejects.toThrow(/5 หลัก/u);
  });
});

describe('รายงานตรวจความถูกต้อง (ScreenReconReport) — จุดตรวจที่เพิ่ม', () => {
  it('ทะเบียนเช็ค ↔ GL · เอกสาร ↔ GL ผ่าน · JV คีย์มือเข้าค่าใช้จ่ายถูกจับเป็นผลต่างพร้อมเลข JV', async () => {
    const { reconChecks } = await import('../src/reports.ts');
    const { postJournal } = await import('../src/ledger-service.ts');
    const { Money } = await import('@innovera/ledger');
    let r = await reconChecks(db, A, '2026-11');
    expect(r.checks).toHaveLength(16); // ข้อ 1: 6 · ข้อ 2: 5 · ข้อ 3: 5
    const k = (key: string) => r.checks.find((c) => c.key === key)!;
    expect(k('cheques')).toMatchObject({ ok: true, byDocs: '96300.00', count: '1 ฉบับ' });
    for (const key of ['doc_iv', 'doc_rv', 'doc_ap_exp', 'doc_orphans', 'vat_deferred', 'wht_received']) expect(k(key).ok, key).toBe(true);
    const jv = await postJournal(db, A, { date: '2026-11-20', role: 'accounting_manager', lines: [
      { side: 'Dr', account: '5301200', amount: Money.parse('2000.00') }, { side: 'Cr', account: '1100100', amount: Money.parse('2000.00') }] });
    r = await reconChecks(db, A, '2026-11');
    expect(k('doc_ap_exp')).toMatchObject({ ok: false, diff: '2000.00', note: `${jv.journalNo} คีย์มือ ไม่มีเอกสารอ้างอิง` });
    expect(k('doc_orphans')).toMatchObject({ ok: false, count: '0 / 1' });
  });
});

describe('แก้บิลซื้อที่ผ่านรายการแล้ว (ScreenDocEdit · ตัวอย่าง AP2611-0079)', () => {
  it('เลขผู้เสียภาษี/ใบกำกับผู้ขาย/มิติ แก้ได้ · ย้ายบัญชีค่าใช้จ่ายสร้าง JV โอนย้าย · ยอดไม่เปลี่ยน · ปิดแข็งแก้ไม่ได้', async () => {
    const { savePurchaseDraft, approvePurchase } = await import('../src/purchase.ts');
    const { editPurchaseDoc, getDocument } = await import('../src/sales.ts');
    const { vatReports } = await import('../src/reports.ts');
    const { closePeriod } = await import('../src/close-ops.ts');
    const id = await savePurchaseDraft(db, A, mgr, { docType: 'AP', contactId: await contact('V0210'), issueDate: '2026-11-05', vendorRef: 'INV-5521',
      lines: [{ description: 'ค่าจ้างภายนอก', qty: '1', unitPrice: '120000.00', vat: true, accountCode: '5301200' }, { description: 'ค่าซอฟต์แวร์', qty: '1', unitPrice: '30000.00', vat: true, accountCode: '5301200' }] });
    await approvePurchase(db, A, mgr, id);
    const g = await getDocument(db, A, id);
    const line2 = g!.lines[1]!;
    await expect(editPurchaseDoc(db, A, mgr, id, { reason: ' ', date: '2026-11-30', vendorRef: 'x' })).rejects.toThrow(/เหตุผล/u);
    await expect(editPurchaseDoc(db, A, mgr, id, { reason: 'r', date: '2026-11-30', partyTaxId: '010555123456' })).rejects.toThrow(/13 หลัก/u);
    await expect(editPurchaseDoc(db, A, mgr, id, { reason: 'r', date: '2026-11-30', vendorInvoiceDate: '2026-10-31' })).rejects.toThrow(/งวดเดียวกัน/u);
    const before = await vatReports(db, A, '2026-11');
    const r = await editPurchaseDoc(db, A, mgr, id, { reason: 'ผู้ขายแจ้งเลขผู้เสียภาษีผิด', date: '2026-11-30', partyTaxId: '0105536000992', projectCode: 'PRJ-09',
      lines: [{ lineId: line2.id, accountCode: '5306100' }] });
    expect(r.changed).toBe(3);
    expect(r.journalNo).toMatch(/^JV2611-/u);
    const after = await vatReports(db, A, '2026-11');
    expect(after.purchases.vat).toBe(before.purchases.vat);
    expect(after.purchases.rows.find((x) => x.docId === id)?.taxId).toBe('0105536000992');
    expect((await balance('5306100'))).toBe('30000.00');
    const doc = await getDocument(db, A, id);
    expect(doc!.doc).toMatchObject({ grand_total: '160500.00', project_code: 'PRJ-09' });
    expect(doc!.lines[1]!.account_code).toBe('5306100');
    const { reconChecks } = await import('../src/reports.ts');
    expect((await reconChecks(db, A, '2026-11')).checks.find((c) => c.key === 'doc_ap_exp')?.note ?? '').not.toContain(r.journalNo!); // JV โอนย้ายผูกเอกสาร ไม่ใช่คีย์มือ
    for (let p = 1; p <= 11; p++) await closePeriod(db, A, { userId: null, role: 'owner' }, { fiscalYear: 2569, periodNo: p, to: 'hard_closed' });
    await expect(editPurchaseDoc(db, A, mgr, id, { reason: 'r', date: '2026-12-01', vendorRef: 'INV-1' })).rejects.toThrow(/ปิดแข็ง/u);
  });
});
