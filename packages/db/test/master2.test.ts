// กลุ่ม B: ข้อมูลคู่ค้าในฟอร์ม (GET /v1/contacts) · รายการเอกสาร · ทะเบียนบัญชีธนาคาร · นำเข้า Excel · ช่องใบเสนอราคา · นับการพิมพ์
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { listBankAccounts, saveBankAccount, saveContact, contactDetail } from '../src/master.ts';
import { importMaster, masterTemplate } from '../src/master-import.ts';
import { savePurchaseDraft } from '../src/purchase.ts';
import { listContacts } from '../src/queries.ts';
import {
  approveDocument, convertDocument, createBilling, documentFieldValues, getDocument, listDocuments, markPrinted, receivePayment, saveSalesDraft, vendorRefs, type Actor,
} from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

let db: Db;
let A = '';
let B = '';
const mgr: Actor = { userId: null, role: 'accounting_manager' };
const contact = async (code: string, co = A) => (await db.withCompany(co, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;

async function workbook(header: string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ข้อมูล');
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  B = await createCompany(db, { orgId: org, nameTh: 'บริษัท ข จำกัด' });
  await seedCompany(db, A);
  await seedCompany(db, B, 2569, { sample: false });
}, 120_000);
afterAll(() => db.close());

describe('GET /v1/contacts (listContacts) — ข้อมูลที่ฟอร์มเอกสารใช้', () => {
  it('ส่งเลขผู้เสียภาษี เครดิต WHT ตั้งต้น บัญชีธนาคาร และวงเงินคงเหลือ = วงเงิน − ลูกหนี้คงค้าง', async () => {
    const c12 = await contact('C0012');
    const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c12, issueDate: '2026-11-01', lines: [{ description: 'สินค้า', qty: '1', unitPrice: '10000.00', vat: true }] });
    await approveDocument(db, A, mgr, iv);
    const rows = await listContacts(db, A);
    const c = rows.find((r) => r.code === 'C0012')!;
    expect(c).toMatchObject({ tax_id: '0105xxxxxxx05', credit_days: 30, credit_limit: '500000.00', ar_outstanding: '10700.00', credit_remaining: '489300.00', roles: ['customer'] });
    const v = rows.find((r) => r.code === 'V0210')!;
    expect(v).toMatchObject({ default_wht: 'service', bank_account: 'xxx-x-x5678-x', tax_id: '0105xxxxxxx11', credit_remaining: null });
    expect(rows.find((r) => r.code === 'V0415')!.bank_account).toBeNull();
  });

  it('saveContact: ตรวจ defaultWht · ไม่ส่ง defaultWht = คงค่าเดิม (หน้า ScreenContacts ไม่มีช่องนี้)', async () => {
    const id = await contact('V0008');
    const base = { code: 'V0008', name: 'หจก. ทรัพย์สมบูรณ์ขนส่ง', roles: ['vendor' as const] };
    await expect(saveContact(db, A, null, { ...base, defaultWht: 'nope' }, id)).rejects.toThrow(/ไม่รู้จักประเภทเงินได้/u);
    await saveContact(db, A, null, base, id);
    expect((await contactDetail(db, A, id, '2026-11-30'))!.contact.default_wht).toBe('transport_domestic');
    await saveContact(db, A, null, { ...base, defaultWht: 'service' }, id);
    expect((await contactDetail(db, A, id, '2026-11-30'))!.contact.default_wht).toBe('service');
    await saveContact(db, A, null, { ...base, defaultWht: 'transport_domestic' }, id);
  });
});

describe('GET /v1/documents (listDocuments) + ตรวจเลขใบกำกับผู้ขายซ้ำ', () => {
  it('ค้นด้วยเลขผู้เสียภาษี · ส่ง contact_tax_id · ยอดค้าง = ยอด − รับชำระ − ใบลดหนี้ (ไม่หักมัดจำซ้ำ)', async () => {
    const c44 = await contact('C0044');
    const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c44, issueDate: '2026-11-03', lines: [{ description: 'บริการ', qty: '1', unitPrice: '20000.00', vat: true }] });
    await approveDocument(db, A, mgr, iv);
    await receivePayment(db, A, mgr, { contactId: c44, date: '2026-11-10', receiveAccount: '1100100', applications: [{ documentId: iv, applied: '5000.00' }] });
    const rows = await listDocuments(db, A, { q: '0105xxxxxxx02', docType: 'IV' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: iv, contact_tax_id: '0105xxxxxxx02', outstanding: '16400.00', external_source: null, pay_now: false });
  });

  it('vendorRefs: เลขใบกำกับของผู้ขายรายนี้ (ไม่สนช่องว่าง/ตัวพิมพ์) · ไม่นับใบที่กำลังแก้', async () => {
    const v = await contact('V0210');
    const ap = await savePurchaseDraft(db, A, mgr, { docType: 'AP', contactId: v, issueDate: '2026-11-05', vendorRef: 'INV-2611/0091', lines: [{ description: 'บริการ', qty: '1', unitPrice: '1000.00', vat: true, accountCode: '5301200' }] });
    expect((await vendorRefs(db, A, { contactId: v })).map((r) => r.vendor_ref)).toEqual(['INV-2611/0091']);
    expect(await vendorRefs(db, A, { contactId: v, ref: ' inv-2611/0091 ' })).toHaveLength(1);
    expect(await vendorRefs(db, A, { contactId: v, ref: 'INV-2611/0091', excludeId: ap })).toHaveLength(0);
    expect(await vendorRefs(db, A, { contactId: await contact('V0330'), ref: 'INV-2611/0091' })).toHaveLength(0);
    const list = await listDocuments(db, A, { docType: 'AP', q: 'INV-2611' });
    expect(list[0]).toMatchObject({ id: ap, vendor_ref: 'INV-2611/0091', contact_tax_id: '0105xxxxxxx11' });
  });
});

describe('ทะเบียนบัญชีธนาคารของบริษัท (acct.bank_account)', () => {
  it('seed จาก fixtures company.bank_accounts · บัญชีแรกเป็นบัญชีรับโอนตั้งต้น', async () => {
    const rows = await listBankAccounts(db, A);
    expect(rows.map((r) => [r.gl_account, r.bank_name, r.account_no, r.is_default_receive])).toEqual([
      ['1100100', '[ธนาคาร A]', 'xxx-x-x1234-x', true],
      ['1100200', '[ธนาคาร B]', 'xxx-x-x5678-x', false],
    ]);
  });
  it('ตั้งบัญชีรับโอนตั้งต้นใหม่ = ยกเลิกบัญชีเดิม · บัญชีที่ไม่ใช่สินทรัพย์ถูกปฏิเสธ · แยกบริษัท (RLS)', async () => {
    await saveBankAccount(db, A, null, { glAccount: '1100200', bankName: '[ธนาคาร B]', accountNo: 'xxx-x-x5678-x', branch: 'พระราม 9', isDefaultReceive: true });
    let rows = await listBankAccounts(db, A);
    expect(rows[0]).toMatchObject({ gl_account: '1100200', branch: 'พระราม 9', is_default_receive: true });
    expect(rows.filter((r) => r.is_default_receive)).toHaveLength(1);
    await expect(saveBankAccount(db, A, null, { glAccount: '4100100', bankName: 'x', accountNo: '1' })).rejects.toThrow(/ไม่ใช่บัญชีสินทรัพย์/u);
    expect(await listBankAccounts(db, B)).toEqual([]);
    await saveBankAccount(db, A, null, { glAccount: '1100100', bankName: '[ธนาคาร A]', accountNo: 'xxx-x-x1234-x', isDefaultReceive: true });
    rows = await listBankAccounts(db, A);
    expect(rows[0]!.gl_account).toBe('1100100');
  });
});

describe('ใบเสนอราคา: พนักงานขาย · โครงการ · เงื่อนไขชำระ · ระดับราคา · ต้นทุนประมาณ', () => {
  it('บันทึก อ่าน และคัดลอกเมื่อแปลงเป็นใบสั่งขาย · ตัวเลือกจากค่าที่เคยใช้', async () => {
    const c12 = await contact('C0012');
    const qo = await saveSalesDraft(db, A, mgr, {
      docType: 'QO', contactId: c12, issueDate: '2026-11-08', salesperson: '[พนักงานขาย ก.]', projectCode: 'PRJ-09 ระบบจองห้อง', paymentTerms: 'มัดจำ 30% · ส่วนที่เหลือเครดิต 30 วัน', priceLevel: 1,
      lines: [
        { productCode: 'S-0001', description: 'พัฒนาซอฟต์แวร์', qty: '120', unitPrice: '1500.00', discount: '26100.00', estCost: '96000.00' },
        { description: 'อบรมผู้ใช้ 1 วัน ของแถม', qty: '1', unitPrice: '0.00', estCost: '6000.00' },
      ],
    });
    await approveDocument(db, A, mgr, qo);
    const d = (await getDocument(db, A, qo))!;
    expect(d.doc).toMatchObject({ salesperson: '[พนักงานขาย ก.]', project_code: 'PRJ-09 ระบบจองห้อง', payment_terms: 'มัดจำ 30% · ส่วนที่เหลือเครดิต 30 วัน', price_level: 1, print_count: 0 });
    expect(d.lines.map((l) => [l.est_cost, l.product_est_cost])).toEqual([['96000.00', '800.0000'], ['6000.00', null]]);
    const so = await convertDocument(db, A, mgr, qo, 'SO', { issueDate: '2026-11-09' });
    const s = (await getDocument(db, A, so))!;
    expect(s.doc.salesperson).toBe('[พนักงานขาย ก.]');
    expect(s.lines[0]!.est_cost).toBe('96000.00');
    expect(await documentFieldValues(db, A)).toEqual({ salespersons: ['[พนักงานขาย ก.]'], projects: ['PRJ-09 ระบบจองห้อง'] });
    await expect(saveSalesDraft(db, A, mgr, { docType: 'QO', contactId: c12, issueDate: '2026-11-08', priceLevel: 6, lines: [{ description: 'x', qty: '1', unitPrice: '1.00' }] })).rejects.toThrow(/ระดับราคา/u);
  });
});

describe('แบบพิมพ์: นับการพิมพ์ต้นฉบับ · ใบรับชำระอ้างใบวางบิล', () => {
  it('ร่างพิมพ์ต้นฉบับไม่ได้ · พิมพ์ครั้งแรก = 1 (ต้นฉบับ) ครั้งต่อไป = สำเนา', async () => {
    const c = await contact('C0063');
    const draft = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c, issueDate: '2026-11-04', lines: [{ description: 'บริการ', qty: '1', unitPrice: '100.00' }] });
    await expect(markPrinted(db, A, mgr, draft)).rejects.toThrow(/ร่าง/u);
    await approveDocument(db, A, mgr, draft);
    expect(await markPrinted(db, A, mgr, draft)).toEqual({ printCount: 1 });
    expect(await markPrinted(db, A, mgr, draft)).toEqual({ printCount: 2 });
    expect((await getDocument(db, A, draft))!.doc.print_count).toBe(2);
  });
  it('receivePayment billingId → ref ของใบรับชำระคือใบวางบิล', async () => {
    const c = await contact('C0081');
    const iv = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c, issueDate: '2026-11-04', lines: [{ description: 'บริการ', qty: '1', unitPrice: '1000.00' }] });
    await approveDocument(db, A, mgr, iv);
    const bn = await createBilling(db, A, mgr, { contactId: c, date: '2026-11-05', documentIds: [iv] });
    const rv = await receivePayment(db, A, mgr, { contactId: c, date: '2026-11-20', receiveAccount: '1100100', billingId: bn.id, applications: [{ documentId: iv, applied: '1070.00' }] });
    expect((await getDocument(db, A, rv.id))!.ref).toMatchObject({ id: bn.id, doc_type: 'BN', doc_no: bn.docNo });
  });
});

describe('นำเข้า Excel คู่ค้า / สินค้า (ตรวจก่อน แล้วบันทึกทั้งชุด)', () => {
  it('แม่แบบอ่านกลับได้ และแถวตัวอย่างผ่านการตรวจ', async () => {
    const r = await importMaster(db, B, null, 'products', await masterTemplate('products'), { commit: false });
    expect(r).toMatchObject({ ok: true, committed: false, rows: [{ row: 2, code: 'S-0001', action: 'create' }], issues: [] });
  });

  it('ข้อผิดพลาดรายแถว → ไม่บันทึกอะไรเลย', async () => {
    const buf = await workbook(['รหัส', 'ชื่อ', 'บทบาท', 'เลขผู้เสียภาษี', 'สาขา', 'WHT ตั้งต้น'], [
      ['C9001', 'ลูกค้าใหม่', 'ลูกค้า', '', '00000', ''],
      ['C9002', 'ผู้ขายใหม่', 'ผู้ขาย', '1234567890123', '', ''],
      ['C9003', '', 'ลูกค้า', '', '', ''],
      ['C9004', 'x', 'เพื่อน', '', '', ''],
      ['C9001', 'ซ้ำ', 'ลูกค้า', '', '', ''],
      ['C9005', 'y', 'ผู้ขาย', '', '1', 'rent'],
    ]);
    const r = await importMaster(db, A, null, 'contacts', buf, { commit: true });
    expect(r.ok).toBe(false);
    expect(r.committed).toBe(false);
    expect(r.issues.map((i) => i.row)).toEqual([3, 4, 5, 6, 7]);
    expect(r.issues[0]!.message).toMatch(/เลขประจำตัวผู้เสียภาษี/u);
    expect(r.issues[3]!.message).toMatch(/ซ้ำในไฟล์/u);
    expect(await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('code').where('code', '=', 'C9001').executeTakeFirst())).toBeUndefined();
  });

  it('dry-run แสดงสร้าง/แก้ไข · commit สร้างใหม่และแก้เฉพาะช่องที่กรอก', async () => {
    const buf = await workbook(['รหัส', 'ชื่อ', 'บทบาท', 'ประเภทบุคคล', 'เครดิต (วัน)', 'วงเงินเครดิต', 'WHT ตั้งต้น', 'บัญชีธนาคาร'], [
      ['C9101', 'ลูกค้าใหม่ จำกัด', 'ลูกค้า, ผู้ขาย', 'นิติบุคคล', '45', '100,000', '', ''],
      ['V0330', '', '', '', '', '', '', 'xxx-x-x0000-x'],
    ]);
    const dry = await importMaster(db, A, null, 'contacts', buf, { commit: false });
    expect(dry).toMatchObject({ ok: true, committed: false, rows: [{ code: 'C9101', action: 'create' }, { code: 'V0330', name: '[ผู้ให้เช่าอาคาร]', action: 'update' }] });
    expect(await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('code').where('code', '=', 'C9101').executeTakeFirst())).toBeUndefined();
    const r = await importMaster(db, A, null, 'contacts', buf, { commit: true });
    expect(r).toMatchObject({ ok: true, committed: true });
    const rows = await listContacts(db, A);
    expect(rows.find((c) => c.code === 'C9101')).toMatchObject({ roles: ['customer', 'vendor'], kind: 'both', credit_days: 45, credit_limit: '100000.00' });
    expect(rows.find((c) => c.code === 'V0330')).toMatchObject({ name: '[ผู้ให้เช่าอาคาร]', default_wht: 'rent', tax_id: '0105xxxxxxx17', bank_account: 'xxx-x-x0000-x' });
  });

  it('สินค้า: ราคา รหัสภาษี เหตุยกเว้น VAT ต้นทุนประมาณ · บัญชีต้องมีในผัง', async () => {
    const buf = await workbook(['รหัส', 'ชื่อ', 'ประเภท', 'หน่วย', 'ราคา 1', 'รหัสภาษี', 'เหตุยกเว้น VAT', 'ต้นทุนประมาณ', 'บัญชีรายได้'], [
      ['R-0001', 'ค่าเช่าพื้นที่', 'บริการ', 'เดือน', '24000', 'ยกเว้น', 'ให้เช่าอสังหาริมทรัพย์ ได้รับยกเว้นภาษีมูลค่าเพิ่ม ม.81(1)(ฑ)', '', '4100100'],
      ['S-0002', '', '', '', '', '', '', '2000', ''],
      ['R-0002', 'x', 'สินค้าชุด', '', '', '', '', '', ''],
      ['R-0003', 'y', 'บริการ', '', '', '', '', '', '9999999'],
    ]);
    const bad = await importMaster(db, A, null, 'products', buf, { commit: false });
    expect(bad.issues.map((i) => [i.row, i.message])).toEqual([[4, expect.stringMatching(/ประเภทไม่ถูกต้อง/u)], [5, 'ไม่มีบัญชี 9999999 ในผังบัญชี']]);
    const ok = await importMaster(db, A, null, 'products', await workbook(['รหัส', 'ชื่อ', 'ประเภท', 'หน่วย', 'ราคา 1', 'รหัสภาษี', 'เหตุยกเว้น VAT', 'ต้นทุนประมาณ', 'บัญชีรายได้'],
      [['R-0001', 'ค่าเช่าพื้นที่', 'บริการ', 'เดือน', '24000', 'ยกเว้น', 'ให้เช่าอสังหาริมทรัพย์ ได้รับยกเว้นภาษีมูลค่าเพิ่ม ม.81(1)(ฑ)', '', '4100100'], ['S-0002', '', '', '', '', '', '', '2000', '']]), { commit: true });
    expect(ok.committed).toBe(true);
    const ps = await db.withCompany(A, (tx) => tx.selectFrom('acct.product').select(['code', 'name', 'price', 'vat', 'vat_code', 'vat_exempt_reason', 'est_cost']).where('code', 'in', ['R-0001', 'S-0002']).orderBy('code').execute());
    expect(ps).toEqual([
      { code: 'R-0001', name: 'ค่าเช่าพื้นที่', price: '24000.0000', vat: false, vat_code: 'exempt', vat_exempt_reason: 'ให้เช่าอสังหาริมทรัพย์ ได้รับยกเว้นภาษีมูลค่าเพิ่ม ม.81(1)(ฑ)', est_cost: null },
      { code: 'S-0002', name: 'ค่าดูแลระบบ (รายเดือน)', price: '8000.0000', vat: true, vat_code: 'vat7', vat_exempt_reason: null, est_cost: '2000.0000' },
    ]);
  });

  it('ไฟล์ที่ไม่ใช่ Excel / ไม่มีคอลัมน์ที่ต้องมี', async () => {
    expect((await importMaster(db, A, null, 'contacts', Buffer.from('hello'), { commit: false })).issues[0]!.message).toMatch(/อ่านไฟล์ไม่ได้/u);
    expect((await importMaster(db, A, null, 'contacts', await workbook(['ชื่อ'], [['x']]), { commit: false })).issues[0]!.message).toMatch(/ไม่มีคอลัมน์ รหัส, บทบาท/u);
  });
});
