// M4 ขาย + รับเงินบน DB จริง — ตัวเลขจาก fixtures (IV2611-0052 · RV2611-0021 · CN · BN · void · แก้ข้อมูลอ้างอิง)
import { fromTuples, toTuples, type JournalLineTuple } from '@innovera/ledger';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import {
  approveDocument, convertDocument, createBilling, editReference, getDocument, listDocuments, openItems, receivePayment, saveSalesDraft, submitDocument, voidDocument, type Actor,
} from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

type FxLine = { product?: string; desc: string; qty: string; price: string; account?: string };
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/sample-company.json', import.meta.url), 'utf8')) as { documents: Record<string, Record<string, unknown>> };
const D = (no: string) => fx.documents[no]! as Record<string, string> & { lines?: FxLine[]; applications?: { doc: string; applied: string; wht: string; wht_base?: string }[]; expected_journal?: JournalLineTuple[] };
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const mgr: Actor = { userId: null, role: 'accounting_manager' };
const set = (t: JournalLineTuple[] | (readonly [string, string, string])[]) => new Set(t.map((x) => x.join(' ')));

let db: Db;
let A = '';
const contact = async (code: string) => (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const journalOf = async (docId: string) => db.withCompany(A, async (tx) => {
  const d = await tx.selectFrom('acct.document').select('journal_id').where('id', '=', docId).executeTakeFirstOrThrow();
  const lines = await tx.selectFrom('acct.journal_line').select(['account_code', 'debit', 'credit']).where('journal_id', '=', d.journal_id!).orderBy('line_no').execute();
  return toTuples(fromTuples(lines.map((l) => (Number(l.debit) > 0 ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit]) as JournalLineTuple)));
});

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
}, 120_000);
afterAll(() => db.close());

/** ใบแจ้งหนี้บริการยอดเดียว (ใช้สร้างใบที่ RV ตัด) */
async function postedIv(contactCode: string, date: string, base: string, inclVat = false) {
  const id = await saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: await contact(contactCode), issueDate: date, priceInclVat: inclVat, lines: [{ description: 'บริการ', qty: '1', unitPrice: base, vat: true }] });
  await approveDocument(db, A, mgr, id);
  return id;
}

describe('IV2611-0052 (ScreenInvoice) ร่าง → รออนุมัติ → อนุมัติและลงบัญชี', () => {
  let id = '';
  it('ยอด + ลงบัญชีตาม expected_journal · เลขที่ออกตอนอนุมัติ', async () => {
    const iv = D('IV2611-0052');
    id = await saveSalesDraft(db, A, mgr, {
      docType: 'IV', contactId: await contact(iv.contact!), issueDate: ce(iv.date!), dueDate: ce(iv.due!), ruleCode: iv.rule!,
      lines: iv.lines!.map((l) => ({ productCode: l.product ?? null, description: l.desc, qty: l.qty, unitPrice: l.price, vat: true, accountCode: l.account ?? null })),
    });
    let g = await getDocument(db, A, id);
    expect(g?.doc).toMatchObject({ status: 'draft', doc_no: null, subtotal: iv.subtotal, vat: iv.vat, grand_total: iv.grand_total });
    expect(g?.amountText).toBe(iv.amount_text);
    await submitDocument(db, A, mgr, id);
    const r = await approveDocument(db, A, mgr, id);
    expect(r.docNo).toMatch(/^IV2611-\d{4}$/u);
    expect(set(await journalOf(id))).toEqual(set(iv.expected_journal!));
    g = await getDocument(db, A, id);
    expect(g?.doc.status).toBe('posted');
    expect(g?.outstanding).toBe(iv.grand_total);
    expect(g?.events.map((e) => e.event)).toEqual(['created', 'submitted', 'posted']);
  });
  it('ลงแล้วแก้ยอดไม่ได้ · แก้ข้อมูลอ้างอิงได้และบันทึกค่าก่อน/หลัง', async () => {
    await expect(saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: await contact('C0012'), issueDate: '2026-11-04', lines: [{ description: 'x', qty: '1', unitPrice: '1' }] }, id)).rejects.toThrow(/เฉพาะเอกสารร่าง/u);
    await expect(editReference(db, A, mgr, id, { grand_total: '1.00' })).rejects.toThrow(/แก้ไม่ได้หลังผ่านรายการ/u);
    await editReference(db, A, mgr, id, { notes: 'กรุณาชำระภายในกำหนด', due_date: '2026-12-10' });
    const g = await getDocument(db, A, id);
    expect(g?.doc.notes).toBe('กรุณาชำระภายในกำหนด');
    expect(g?.events.at(-1)).toMatchObject({ event: 'reference_edited', detail: { after: { notes: 'กรุณาชำระภายในกำหนด', due_date: '2026-12-10' } } });
  });
});

describe('RV2611-0021 (ScreenReceipt) ตัด 2 ใบ + 50 ทวิ + ค่าธรรมเนียม', () => {
  const rv = D('RV2611-0021');
  let iv49 = '';
  let iv53 = '';
  let rvId = '';
  beforeAll(async () => {
    const a = D('IV2610-0049');
    const b = D('IV2611-0053');
    iv49 = await postedIv(rv.contact!, ce(a.date!), a.subtotal!);
    iv53 = await postedIv(rv.contact!, ce(b.date!), b.grand_total!, true);
  });
  it('ใบที่สร้างมียอดตาม fixtures · ค้างชำระเรียงตามครบกำหนด', async () => {
    const items = await openItems(db, A, await contact(rv.contact!));
    expect(items.map((i) => [i.grand_total, i.vat])).toEqual([[D('IV2610-0049').grand_total, D('IV2610-0049').vat], [D('IV2611-0053').grand_total, D('IV2611-0053').vat]]);
  });
  it('รับชำระ → journal ตาม expected_journal · ยอดค้างเหลือตาม fixtures', async () => {
    const ids: Record<string, string> = { 'IV2610-0049': iv49, 'IV2611-0053': iv53 };
    const r = await receivePayment(db, A, mgr, {
      contactId: await contact(rv.contact!), date: ce(rv.date!), receiveAccount: rv.bank_account!, fee: rv.bank_fee!, feeAccount: rv.fee_account!, whtCertNo: '0045/2569', whtRate: '0.03',
      applications: rv.applications!.map((x) => ({ documentId: ids[x.doc]!, applied: x.applied, wht: x.wht, ...(x.wht_base ? { whtBase: x.wht_base } : {}) })),
    });
    rvId = r.id;
    expect(r.docNo).toMatch(/^RV2611-\d{4}$/u);
    expect([r.totals.applied, r.totals.wht, r.totals.cashIn]).toEqual([rv.total_applied, rv.total_wht, rv.cash_in]);
    expect(r.warnings).toEqual([]);
    expect(set(await journalOf(rvId))).toEqual(set(rv.expected_journal!));
    expect((await getDocument(db, A, iv49))?.outstanding).toBe('0.00');
    expect((await getDocument(db, A, iv53))?.outstanding).toBe(D('IV2611-0053').outstanding_2569_11_30);
  });
  it('ตัดเกินยอดค้างไม่ได้ · ยกเลิก IV ที่มีการรับชำระไม่ได้', async () => {
    await expect(receivePayment(db, A, mgr, { contactId: await contact(rv.contact!), date: '2026-11-30', receiveAccount: '1100100', applications: [{ documentId: iv53, applied: '1200.01' }] })).rejects.toThrow(/เกินยอดค้าง/u);
    await expect(voidDocument(db, A, mgr, iv49, { reason: 'ทดสอบ' })).rejects.toThrow(/ยกเลิกเอกสารเหล่านั้นก่อน/u);
  });
  it('ยกเลิก RV → กลับรายการเลขเดิม+R · ยอดค้างกลับมา', async () => {
    const r = await voidDocument(db, A, mgr, rvId, { reason: 'บันทึกผิดบัญชี', date: '2026-11-30' });
    expect(r.reversal).toMatch(/R$/u);
    expect((await getDocument(db, A, iv49))?.outstanding).toBe(D('IV2610-0049').grand_total);
    expect((await getDocument(db, A, rvId))?.doc.status).toBe('voided');
  });
});

describe('ลดหนี้ · ใบวางบิล · ใบเสนอราคา', () => {
  it('CN อ้าง IV ลดยอดค้าง · ลดเกินยอดค้างไม่ได้', async () => {
    const iv = await postedIv('C0012', '2026-11-10', '10000.00');
    const cn = await saveSalesDraft(db, A, mgr, { docType: 'CN', contactId: await contact('C0012'), issueDate: '2026-11-15', refDocumentId: iv, lines: [{ description: 'คืน', qty: '2', unitPrice: '400.00', vat: true }] });
    await approveDocument(db, A, mgr, cn);
    expect(await journalOf(cn)).toEqual([['Dr', '4100100', '800.00'], ['Dr', '2150100', '56.00'], ['Cr', '1130100', '856.00']]);
    expect((await getDocument(db, A, iv))?.outstanding).toBe('9844.00'); // 10,700 − 856 (รูปแบบเดียวกับ CN2611-0003)
    const big = await saveSalesDraft(db, A, mgr, { docType: 'CN', contactId: await contact('C0012'), issueDate: '2026-11-15', refDocumentId: iv, lines: [{ description: 'เกิน', qty: '1', unitPrice: '10000.00', vat: true }] });
    await expect(approveDocument(db, A, mgr, big)).rejects.toThrow(/ลดหนี้เกินยอดค้าง/u);
  });
  it('BN รวมยอดค้างของใบที่เลือก ไม่ลงบัญชี', async () => {
    const c = await contact('C0044');
    const a = await postedIv('C0044', '2026-11-01', '1000.00');
    const b = await postedIv('C0044', '2026-11-02', '2000.00');
    const bn = await createBilling(db, A, mgr, { contactId: c, date: '2026-11-27', documentIds: [a, b] });
    expect(bn.total).toBe('3210.00');
    const g = await getDocument(db, A, bn.id);
    expect(g?.doc).toMatchObject({ doc_type: 'BN', status: 'approved', journal_id: null });
    expect(g?.billing).toHaveLength(2);
  });
  it('QO อนุมัติ (ไม่ลงบัญชี) → แปลงเป็น IV ร่างอ้างอิง QO · ยอดเท่าเดิม', async () => {
    const qo = D('QO2611-0030');
    const id = await saveSalesDraft(db, A, mgr, { docType: 'QO', contactId: await contact(qo.contact!), issueDate: ce(qo.date!), lines: qo.lines!.map((l) => ({ description: l.desc, qty: l.qty, unitPrice: l.price, vat: true })) });
    const r = await approveDocument(db, A, mgr, id);
    expect(r.journalNo).toBeUndefined();
    const ivId = await convertDocument(db, A, mgr, id, 'IV', { issueDate: '2026-11-25' });
    const g = await getDocument(db, A, ivId);
    expect(g?.doc).toMatchObject({ doc_type: 'IV', status: 'draft', ref_document_id: id, subtotal: qo.subtotal, vat: qo.vat, grand_total: qo.grand_total });
    expect((await listDocuments(db, A, { docType: 'QO' })).map((d) => d.doc_no)).toEqual([r.docNo]);
  });
  it('ยกเลิก IV ที่ไม่มีการรับชำระ → กลับรายการ', async () => {
    const iv = await postedIv('C0012', '2026-11-20', '500.00');
    const r = await voidDocument(db, A, mgr, iv, { reason: 'ออกผิดลูกค้า' });
    expect(r.reversal).toMatch(/^JV2611-\d{4}R$/u);
  });
});

describe('เลขที่เอกสารเรียงต่อเนื่อง (ม.86/4)', () => {
  it('ระบุเลขที่เอง (นำเข้า/seed) แล้วใบถัดไปต่อจากเลขนั้น ไม่ย้อน', async () => {
    const c = (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', 'C0063').executeTakeFirstOrThrow())).id;
    const mk = async () => saveSalesDraft(db, A, mgr, { docType: 'IV', contactId: c, issueDate: '2026-12-03', lines: [{ description: 'x', qty: '1', unitPrice: '100.00', vat: true }] });
    await approveDocument(db, A, mgr, await mk(), { docNo: 'IV2612-0041' });
    expect((await approveDocument(db, A, mgr, await mk())).docNo).toBe('IV2612-0042');
  });
});
