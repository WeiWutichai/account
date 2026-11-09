// กลุ่ม D: สายอนุมัติจ่าย 3 ขั้น · PromptPay · ไฟล์โอนชุด · กระทบยอดธนาคาร 1 ต่อหลาย + ปิดเดือน + OFX · เงินสดย่อยหลายกอง + ตรวจนับ · ลดหนี้ซื้อเกินยอดค้าง (เครดิตผู้ขาย) · PO
// ตัวเลขจาก fixtures เมื่อมี (PAYRUN-2569-11-28 · PV2611-0031/32/33 · petty_cash · PO2611-0018) — ที่เหลือเป็นยอดทดสอบ
import { fromTuples, toTuples, type JournalLineTuple } from '@innovera/ledger';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoMatch, closeReconciliation, importStatement, matchManually, parseStatement, parseStatementCsv, parseStatementOfx, reconciliation } from '../src/close-ops.ts';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { postJournal } from '../src/ledger-service.ts';
import {
  APPROVAL_DEFAULTS, APPROVAL_KEYS, approvalSettings, approvePayment, approvePurchase, bulkPaymentFile, countPettyCash, createPayment, createPaymentRun, createPettyCashFund,
  payables, pettyCashSummary, reimbursePettyCash, savePettyCash, savePurchaseDraft, setCompanySetting, vendorCredits,
} from '../src/purchase.ts';
import { getDocument, type Actor } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

type FxLine = { desc: string; account: string; amount: string; vat: boolean };
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/sample-company.json', import.meta.url), 'utf8')) as {
  documents: Record<string, Record<string, unknown>>; contacts: { code: string; bank?: string | null }[];
  petty_cash: { fund: string; imprest: string; last_count: string; count_sheet: { cash_counted: string; vouchers: string };
    items_shown: { date?: string; no: string; desc?: string; account?: string; vat?: string; amount: string; input_vat?: string; wht?: string; evidence?: string; by?: string }[] };
};
const D = (no: string) => fx.documents[no]! as Record<string, string> & { lines?: FxLine[]; expected_journal?: JournalLineTuple[] };
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const set = (t: readonly (readonly string[])[]) => new Set(t.map((x) => x.join(' ')));
const clerk: Actor = { userId: '00000000-0000-4000-8000-0000000000c1', role: 'accountant' };
const mgr = { userId: '00000000-0000-4000-8000-0000000000c2', role: 'accounting_manager' as const, approvalLimit: '1000000.00' };
const director = { userId: '00000000-0000-4000-8000-0000000000c3', role: 'owner' as const, approvalLimit: null };
const director2 = { userId: '00000000-0000-4000-8000-0000000000c4', role: 'owner' as const, approvalLimit: null };

let db: Db;
let A = '';
const contact = async (code: string) => (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const journalOf = async (docId: string) => db.withCompany(A, async (tx) => {
  const d = await tx.selectFrom('acct.document').select('journal_id').where('id', '=', docId).executeTakeFirstOrThrow();
  const lines = await tx.selectFrom('acct.journal_line').select(['account_code', 'debit', 'credit']).where('journal_id', '=', d.journal_id!).orderBy('line_no').execute();
  return toTuples(fromTuples(lines.map((l) => (Number(l.debit) > 0 ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit]) as JournalLineTuple)));
});
const apBalance = async (contactId: string) => db.withCompany(A, async (tx) => {
  const r = await tx.selectFrom('acct.journal_line').select((eb) => [eb.fn.sum<string>('debit').as('dr'), eb.fn.sum<string>('credit').as('cr')]).where('account_code', '=', '2110100').where('contact_id', '=', contactId).executeTakeFirstOrThrow();
  return (Number(r.cr ?? 0) - Number(r.dr ?? 0)).toFixed(2);
});
async function bill(code: string, amount: string, account: string, whtType: string | null, vat = false, extra: { refDocumentId?: string; date?: string } = {}) {
  const id = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(code), issueDate: extra.date ?? '2026-11-10', refDocumentId: extra.refDocumentId ?? null,
    lines: [{ description: 'บิล', qty: '1', unitPrice: amount, vat, accountCode: account, whtType }] });
  await approvePurchase(db, A, director, id);
  return id;
}

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
  // บัญชีรับโอนของผู้ขายตาม fixtures contacts[].bank
  for (const c of fx.contacts) if (c.bank) await db.withCompany(A, (tx) => tx.updateTable('acct.contact').set({ bank_account: c.bank! }).where('code', '=', c.code).execute());
}, 120_000);
afterAll(() => db.close());

describe('ค่าตั้งวงเงินสายอนุมัติ (acct.company_setting)', () => {
  it('ค่าตั้งต้นตามแบบร่าง/fixtures: จ่าย 1,000,000 · PO 300,000 · AP เกิน PO 5%', async () => {
    const s = await approvalSettings(db, A);
    expect(s.payment.l2Limit).toBe((D('PAYRUN-2569-11-28') as unknown as { approval: { l2_limit: string } }).approval.l2_limit);
    expect(s.purchaseOrder.l2Limit).toBe(D('PO2611-0018').approval_limit_l2);
    expect(s).toEqual({ payment: { l2Limit: APPROVAL_DEFAULTS.payment.l2Limit }, purchaseOrder: { ...APPROVAL_DEFAULTS.purchaseOrder } });
  });
});

describe('รอบจ่าย 28/11 (PAYRUN-2569-11-28) · ไม่เกินวงเงินขั้น 2 · ไฟล์โอนชุด · PromptPay', () => {
  const ids: Record<string, string> = {};
  let runIds: string[] = [];
  beforeAll(async () => {
    ids['AP2611-0088'] = await bill('V0102', '600000.00', '5301300', 'transport_domestic');
    ids['AP2611-0091'] = await bill('V0102', '120000.00', '5301300', 'transport_domestic');
    ids['AP2611-0080'] = await bill('V0330', '50000.00', '5303100', 'rent');
    const ap = D('AP2611-0079');
    ids['AP2611-0079'] = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(ap.contact!), issueDate: ce(ap.date!), vendorRef: ap.vendor_invoice!,
      lines: ap.lines!.map((l) => ({ description: l.desc, qty: '1', unitPrice: l.amount, vat: l.vat, accountCode: l.account, whtType: 'service' })) });
    await approvePurchase(db, A, director, ids['AP2611-0079']!);
    const cnr = D('CNR2611-0003');
    const cnrId = await savePurchaseDraft(db, A, clerk, { docType: 'CNR', contactId: await contact(cnr.contact!), issueDate: ce(cnr.date!), refDocumentId: ids['AP2611-0079']!,
      lines: [{ description: cnr.reason!, qty: '1', unitPrice: cnr.subtotal!, vat: true, accountCode: '5301200' }] });
    await approvePurchase(db, A, director, cnrId);
  });
  it('ยอดรอบ 895,500.00 ≤ 1,000,000 → ผู้จัดการบัญชีอนุมัติครั้งเดียวแล้วลงบัญชี (approval_level 2) · ผู้สร้างอนุมัติเองไม่ได้', async () => {
    const run = D('PAYRUN-2569-11-28') as unknown as { selected_bills: string[]; paid_total: string };
    const r = await createPaymentRun(db, A, clerk, { date: '2026-11-28', payFrom: '1100100', billIds: run.selected_bills.map((b) => ids[b]!), batchRef: 'PAYRUN-2569-11-28' });
    expect(r.paidTotal).toBe(run.paid_total);
    runIds = r.vouchers.map((v) => v.id);
    await expect(approvePayment(db, A, { ...clerk, approvalLimit: null }, runIds[0]!)).rejects.toThrow(/แบ่งหน้าที่/u);
    await expect(bulkPaymentFile(db, A, 'PAYRUN-2569-11-28')).rejects.toThrow(/ไม่มีใบสำคัญจ่ายที่อนุมัติแล้ว/u);
    for (const no of ['PV2611-0031', 'PV2611-0032', 'PV2611-0033']) {
      const pv = D(no);
      const v = r.vouchers.find((x) => x.paid === pv.paid)!;
      const a = await approvePayment(db, A, mgr, v.id, { docNo: no, certNos: [pv.wht_cert!] });
      expect([a.posted, a.level, a.needsDirector]).toEqual([true, 2, false]);
      expect(set(await journalOf(v.id))).toEqual(set(pv.expected_journal!));
    }
  });
  it('ไฟล์โอนชุด: 1 บรรทัดต่อ PV · ชื่อผู้รับ · เลขบัญชีจากทะเบียนผู้ติดต่อ · ยอดจ่ายจริง', async () => {
    const f = await bulkPaymentFile(db, A, 'PAYRUN-2569-11-28');
    const lines = f.content.trim().split('\r\n');
    expect(lines[0]).toBe('seq,payee_name,bank,account_no,amount,reference');
    expect(lines.slice(1)).toEqual([
      `1,บจก. ขนส่ง ก.,,xxx-x-x1234-x,${D('PV2611-0031').paid},PV2611-0031`,
      `2,บจก. [ผู้ขาย ข.],,xxx-x-x5678-x,${D('PV2611-0032').paid},PV2611-0032`,
      `3,[ผู้ให้เช่าอาคาร],,xxx-x-x9012-x,${D('PV2611-0033').paid},PV2611-0033`,
    ]);
    expect(f.total).toBe((D('PAYRUN-2569-11-28') as unknown as { paid_total: string }).paid_total);
    expect(f.payFrom).toBe('1100100');
  });
  it('ผู้ขายยังไม่มีบัญชีธนาคาร (V0415 ตาม fixtures) → ไม่สร้างไฟล์ · PromptPay เก็บเป็นวิธีจ่าย · วิธีจ่ายอื่นปฏิเสธ', async () => {
    const b = await bill('V0415', '23000.00', '5305100', null);
    const pv = await createPayment(db, A, clerk, { contactId: await contact('V0415'), date: '2026-11-29', payFrom: '1100100', bills: [{ documentId: b }], method: 'promptpay', batchRef: 'RUN-V0415' });
    expect((await getDocument(db, A, pv.id))?.doc.reference).toBe('promptpay');
    await approvePayment(db, A, mgr, pv.id);
    await expect(bulkPaymentFile(db, A, 'RUN-V0415')).rejects.toThrow(/ยังไม่มีบัญชีธนาคาร: V0415/u);
    const b2 = await bill('V0415', '100.00', '5305100', null);
    await expect(createPayment(db, A, clerk, { contactId: await contact('V0415'), date: '2026-11-29', payFrom: '1100100', bills: [{ documentId: b2 }], method: 'crypto' as never })).rejects.toThrow(/วิธีจ่าย/u);
  });
});

describe('สายอนุมัติ 3 ขั้น: ยอดรอบเกินวงเงินขั้น 2 ต้องกรรมการ (คนละคน)', () => {
  it('ขั้น 2 ผู้จัดการ (ยังไม่ลงบัญชี) → ขั้น 3 ต้องเป็นเจ้าของ · คนละคนกับขั้น 2 · ผ่านแล้ว approval_level 3', async () => {
    const b1 = await bill('V0210', '700000.00', '5301200', null);
    const b2 = await bill('V0330', '400000.00', '5303100', null);
    const run = await createPaymentRun(db, A, clerk, { date: '2026-11-30', payFrom: '1100100', billIds: [b1, b2], batchRef: 'RUN-BIG' });
    expect(run.paidTotal).toBe('1100000.00');
    const [v1, v2] = run.vouchers.sort((a, b) => b.paid.localeCompare(a.paid));
    const s2 = await approvePayment(db, A, mgr, v1!.id);
    expect([s2.posted, s2.level, s2.needsDirector, s2.journalNo]).toEqual([false, 2, true, null]);
    expect((await getDocument(db, A, v1!.id))?.doc).toMatchObject({ status: 'pending_approval', approval_level: 2 });
    await expect(approvePayment(db, A, { ...mgr, approvalLimit: null }, v1!.id)).rejects.toThrow(/กรรมการ/u);
    // เจ้าของคนเดียวกับผู้อนุมัติขั้น 2 ไม่ได้
    await expect(approvePayment(db, A, { ...director, userId: mgr.userId }, v1!.id)).rejects.toThrow(/คนละคน/u);
    const s3 = await approvePayment(db, A, director, v1!.id);
    expect([s3.posted, s3.level]).toEqual([true, 3]);
    expect((await getDocument(db, A, v1!.id))?.doc).toMatchObject({ status: 'posted', approval_level: 3 });
    // ใบที่สองของรอบ: ขั้น 2 โดยกรรมการคนหนึ่ง → ขั้น 3 ต้องกรรมการอีกคน
    await approvePayment(db, A, director, v2!.id);
    await expect(approvePayment(db, A, director, v2!.id)).rejects.toThrow(/คนละคน/u);
    expect((await approvePayment(db, A, director2, v2!.id)).level).toBe(3);
  });
  it('วงเงินขั้น 2 อ่านจากค่าตั้งบริษัท', async () => {
    await setCompanySetting(db, A, APPROVAL_KEYS.payment, { l2_limit: '10000.00' });
    const b = await bill('V0330', '20000.00', '5303100', null);
    const pv = await createPayment(db, A, clerk, { contactId: await contact('V0330'), date: '2026-11-30', payFrom: '1100100', bills: [{ documentId: b }] });
    expect((await approvePayment(db, A, mgr, pv.id)).posted).toBe(false);
    expect((await approvePayment(db, A, director, pv.id)).level).toBe(3);
    await setCompanySetting(db, A, APPROVAL_KEYS.payment, { l2_limit: APPROVAL_DEFAULTS.payment.l2Limit });
  });
});

describe('ใบลดหนี้ซื้อเกินยอดค้าง → เครดิตคงเหลือกับผู้ขาย (CNR[Credit]) · ใช้หักในการจ่ายครั้งถัดไป', () => {
  it('บิลจ่ายแล้ว 32,100.00 → ลดหนี้ 2,140.00 เป็นเครดิต · จ่ายบิลถัดไปหักเครดิต · เจ้าหนี้ผู้ขายเป็นศูนย์', async () => {
    const v = await contact('V0210');
    const before = await apBalance(v);
    const ap = await bill('V0210', '30000.00', '5301200', null, true);
    const pv = await createPayment(db, A, clerk, { contactId: v, date: '2026-11-12', payFrom: '1100100', bills: [{ documentId: ap }] });
    await approvePayment(db, A, mgr, pv.id);
    // เกินมูลค่าบิลเดิมไม่ได้
    const tooBig = await savePurchaseDraft(db, A, clerk, { docType: 'CNR', contactId: v, issueDate: '2026-11-15', refDocumentId: ap, lines: [{ description: 'ลดราคา', qty: '1', unitPrice: '30000.01', vat: true, accountCode: '5301200' }] });
    await expect(approvePurchase(db, A, director, tooBig)).rejects.toThrow(/ไม่เกินมูลค่าบิลเดิม/u);
    const cnr = await savePurchaseDraft(db, A, clerk, { docType: 'CNR', contactId: v, issueDate: '2026-11-15', refDocumentId: ap, lines: [{ description: 'ลดราคา', qty: '1', unitPrice: '2000.00', vat: true, accountCode: '5301200' }] });
    await approvePurchase(db, A, director, cnr);
    expect((await getDocument(db, A, cnr))?.doc.rule_code).toBe('CNR[Credit]');
    expect(set(await journalOf(cnr))).toEqual(set([['Dr', '2110100', '2140.00'], ['Cr', '5301200', '2000.00'], ['Cr', '1170100', '140.00']]));
    expect((await vendorCredits(db, A, v)).map((c) => c.remaining)).toEqual(['2140.00']);
    expect(await apBalance(v)).toBe((Number(before) - 2140).toFixed(2));
    // จ่ายบิลถัดไป 5,000.00 โดยใช้เครดิต → จ่ายจริง 2,860.00 · Dr เจ้าหนี้ 2,860.00 / Cr ธนาคาร 2,860.00
    const next = await bill('V0210', '5000.00', '5301200', null);
    await expect(createPayment(db, A, clerk, { contactId: v, date: '2026-11-20', payFrom: '1100100', bills: [{ documentId: next }], credits: [{ documentId: cnr, amount: '2140.01' }] })).rejects.toThrow(/ไม่เกิน 2140.00/u);
    const p2 = await createPayment(db, A, clerk, { contactId: v, date: '2026-11-20', payFrom: '1100100', bills: [{ documentId: next }], credits: [{ documentId: cnr }] });
    expect([p2.settled, p2.credit, p2.paid]).toEqual(['5000.00', '2140.00', '2860.00']);
    // ใบที่รออนุมัติจองเครดิตไว้แล้ว (ใช้ซ้ำไม่ได้)
    expect(await vendorCredits(db, A, v)).toEqual([]);
    await approvePayment(db, A, mgr, p2.id);
    expect(set(await journalOf(p2.id))).toEqual(set([['Dr', '2110100', '2860.00'], ['Cr', '1100100', '2860.00']]));
    expect(await apBalance(v)).toBe(before);
    expect((await payables(db, A, v)).some((p) => p.id === next)).toBe(false);
  });
  it('ลดหนี้ภายในยอดค้าง ยังใช้สูตร CNR (ลดเจ้าหนี้) ตามเดิม', async () => {
    const v = await contact('V0330');
    const ap = await bill('V0330', '10000.00', '5303100', null);
    const cnr = await savePurchaseDraft(db, A, clerk, { docType: 'CNR', contactId: v, issueDate: '2026-11-15', refDocumentId: ap, lines: [{ description: 'ลด', qty: '1', unitPrice: '1000.00', vat: false, accountCode: '5303100' }] });
    await approvePurchase(db, A, director, cnr);
    expect((await getDocument(db, A, cnr))?.doc.rule_code).toBe('CNR');
    expect((await payables(db, A, v)).find((p) => p.id === ap)?.outstanding).toBe('9000.00');
    expect(await vendorCredits(db, A, v)).toEqual([]);
  });
});

describe('ใบสั่งซื้อ (PO2611-0018): วงเงินอนุมัติ · AP เกิน PO > 5% ต้องยืนยัน · ปิดอัตโนมัติเมื่อรับบิลครบ', () => {
  const po = D('PO2611-0018') as unknown as { contact: string; date: string; lines: { desc: string; account: string; qty: string; price: string; vat: boolean }[]; grand_total: string };
  const draftPo = async (lines = po.lines) => savePurchaseDraft(db, A, clerk, { docType: 'PO', contactId: await contact(po.contact), issueDate: ce(po.date),
    lines: lines.map((l) => ({ description: l.desc, qty: l.qty, unitPrice: l.price, vat: l.vat, accountCode: l.account })) });
  it('PO 224,700.00 ≤ 300,000 ผู้จัดการอนุมัติได้ · PO เกินวงเงินต้องกรรมการ', async () => {
    const big = await draftPo([{ ...po.lines[0]!, price: '300000.00' }]);
    await expect(approvePurchase(db, A, mgr, big)).rejects.toThrow(/กรรมการ/u);
    expect((await approvePurchase(db, A, director, big)).docNo).toBeTruthy();
  });
  it('บิลบางส่วนไม่ปิด PO · ครบแล้วปิดอัตโนมัติ · เกิน 5% ต้องผู้อนุมัติ PO ยืนยัน', async () => {
    const id = await draftPo();
    await approvePurchase(db, A, mgr, id);
    const apFor = async (amount: string) => savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(po.contact), issueDate: '2026-11-20', refDocumentId: id,
      lines: [{ description: 'ตาม PO', qty: '1', unitPrice: amount, vat: true, accountCode: '5301200' }] });
    await approvePurchase(db, A, director, await apFor('150000.00'));
    expect((await getDocument(db, A, id))?.doc.closed_at).toBeNull();
    const over = await apFor('80000.00'); // 160,500 + 85,600 = 246,100 > 224,700 + 5% (235,935.00)
    await expect(approvePurchase(db, A, director, over)).rejects.toThrow(/มากกว่า 5% — ต้องให้ผู้อนุมัติ PO ยืนยัน/u);
    await expect(approvePurchase(db, A, { ...clerk, role: 'accounting_manager' }, over, { confirmOverPo: true })).rejects.toThrow(/เฉพาะผู้อนุมัติ/u);
    await approvePurchase(db, A, mgr, over, { confirmOverPo: true });
    const d = await getDocument(db, A, id);
    expect(d?.doc.closed_at).not.toBeNull();
    expect(d?.events.some((e) => e.event === 'edited' && (e.detail as { closed?: boolean }).closed === true)).toBe(true);
  });
});

describe('กระทบยอดธนาคาร: 1 ต่อหลาย · รายการที่จับคู่แล้วพร้อมเลข journal · ปิดเดือน · OFX', () => {
  it('BULK 2811 batch 0042 (−895,500.00) ↔ PV2611-0031 + 0032 + 0033 (ตามรอบจ่าย) จับคู่อัตโนมัติ', async () => {
    const m = (D('PAYRUN-2569-11-28') as unknown as { bank_statement_match: { desc: string; amount: string } }).bank_statement_match;
    await importStatement(db, A, '1100100', parseStatementCsv(`วันที่,รายการ,จำนวนเงิน\n28/11/2569,${m.desc},${m.amount}`), 'nov');
    const pre = await reconciliation(db, A, '1100100', '2026-11-30');
    const prop = pre.proposals.find((p) => p.kind === 'batch')!;
    expect(prop.journals.map((j) => j.doc_no).sort()).toEqual(['PV2611-0031', 'PV2611-0032', 'PV2611-0033']);
    expect(prop.batchRef).toBe('PAYRUN-2569-11-28');
    expect(await autoMatch(db, A, '1100100')).toEqual({ matched: 1, remaining: 0 });
    const rec = await reconciliation(db, A, '1100100', '2026-11-30');
    const line = rec.matchedLines.find((l) => l.description === m.desc)!;
    expect(line.journals.map((j) => j.doc_no).sort()).toEqual(['PV2611-0031', 'PV2611-0032', 'PV2611-0033']);
    expect(line.journals.reduce((s, j) => s + Number(j.amount), 0).toFixed(2)).toBe(m.amount);
    expect(rec.unmatchedGl.some((g) => line.journals.some((j) => j.id === g.id))).toBe(false);
    // ยกเลิกจับคู่ แล้วจับคู่เอง: ยอดรวมต้องตรง
    await matchManually(db, A, line.id, []);
    const ids = line.journals.map((j) => j.id);
    await expect(matchManually(db, A, line.id, ids.slice(0, 2))).rejects.toThrow(/ยอดรวม/u);
    await matchManually(db, A, line.id, ids);
    const again = await reconciliation(db, A, '1100100', '2026-11-30');
    expect(again.matchedLines.find((l) => l.id === line.id)?.match_status).toBe('manual');
    expect(again.matchedLines.find((l) => l.id === line.id)?.journals).toHaveLength(3);
  });
  it('ปิดกระทบยอดเดือน: ผลต่างต้อง 0.00 · ปิดแล้วจับคู่/ยกเลิก/นำเข้าเดือนนั้นไม่ได้', async () => {
    // บัญชีกระแสรายวัน 1100200: GL ต.ค. 1,000.00 · statement ต.ค. 1,000.00
    const j = await postJournal(db, A, { date: '2026-10-05', lines: fromTuples([['Dr', '1100200', '1000.00'], ['Cr', '3000100', '1000.00']]), role: 'owner', description: 'ทดสอบ' });
    await importStatement(db, A, '1100200', parseStatementCsv('05/10/2569,ฝากเงิน,500.00'), 'oct-a');
    await expect(closeReconciliation(db, A, director, '1100200', '2026-10')).rejects.toThrow(/ผลต่างเป็น 0.00/u);
    await importStatement(db, A, '1100200', parseStatementCsv('06/10/2569,ฝากเงิน 2,500.00'), 'oct-b');
    const lines = (await reconciliation(db, A, '1100200', '2026-10-31')).unmatchedStatement;
    expect(lines).toHaveLength(2);
    await matchManually(db, A, lines[0]!.id, [j.id]);
    await expect(closeReconciliation(db, A, director, '1100200', '2026-10')).resolves.toMatchObject({ statementBalance: '1000.00', glBalance: '1000.00' });
    const rec = await reconciliation(db, A, '1100200', '2026-10-31');
    expect(rec.closed).not.toBeNull();
    await expect(matchManually(db, A, lines[0]!.id, [])).rejects.toThrow(/ถูกล็อก/u);
    await expect(matchManually(db, A, lines[1]!.id, null)).rejects.toThrow(/ถูกล็อก/u);
    await expect(importStatement(db, A, '1100200', parseStatementCsv('07/10/2569,ฝาก,1.00'), 'oct-c')).rejects.toThrow(/ถูกล็อก/u);
    await expect(closeReconciliation(db, A, director, '1100200', '2026-10')).rejects.toThrow(/แล้ว/u);
    // เดือนถัดไปยังนำเข้าได้
    await expect(importStatement(db, A, '1100200', parseStatementCsv('01/11/2569,ฝาก,1.00'), 'nov-a')).resolves.toEqual({ added: 1, skipped: 0 });
  });
  it('OFX: ตรวจจากเนื้อไฟล์ · วันที่/ยอด/รายละเอียด/FITID · ยอดคงเหลือ LEDGERBAL', () => {
    const ofx = `OFXHEADER:100
DATA:OFXSGML

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>THB<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261128120000[+7:ICT]<TRNAMT>-895500.00<FITID>0042<NAME>BULK 2811 batch 0042
<STMTTRN><TRNTYPE>INT<DTPOSTED>20261130<TRNAMT>1230.15<FITID>0043<NAME>INTEREST<MEMO>ดอกเบี้ยรับ
</BANKTRANLIST><LEDGERBAL><BALAMT>2318420.15<DTASOF>20261130</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const rows = parseStatement(ofx);
    expect(rows).toEqual(parseStatementOfx(ofx));
    expect(rows).toEqual([
      { date: '2026-11-28', description: 'BULK 2811 batch 0042', amount: '-895500.00', balance: null, ref: '0042' },
      { date: '2026-11-30', description: 'INTEREST ดอกเบี้ยรับ', amount: '1230.15', balance: '2318420.15', ref: '0043' },
    ]);
    expect(parseStatement('28/11/2569,BULK,-895500.00')).toEqual([{ date: '2026-11-28', description: 'BULK', amount: '-895500.00', balance: null }]);
  });
});

describe('เงินสดย่อยหลายกอง + ตรวจนับ (ScreenPettyCash · fixtures petty_cash)', () => {
  it('ยังไม่ตั้งกอง = กองเดียวแบบเดิม · ตั้งกองตั้งต้นตาม fixtures · ตรวจนับ "ตรงกัน" ตาม count_sheet', async () => {
    const pc = fx.petty_cash;
    await postJournal(db, A, { date: '2026-10-01', lines: fromTuples([['Dr', '1000200', pc.imprest], ['Cr', '1100100', pc.imprest]]), role: 'owner', description: 'ตั้งวงเงินเงินสดย่อย' });
    const legacy = await pettyCashSummary(db, A);
    expect([legacy.fund, legacy.imprest, legacy.lastCount]).toEqual([null, pc.imprest, null]);
    await expect(countPettyCash(db, A, mgr, { date: '2026-11-03', cashCounted: '30000.00' })).rejects.toThrow(/ยังไม่ได้ตั้งกอง/u);
    const office = await createPettyCashFund(db, A, { code: pc.fund, name: 'กองสำนักงานใหญ่', holder: '[พนักงานธุรการ]', imprest: pc.imprest as never });
    const c0 = await countPettyCash(db, A, mgr, { date: ce(pc.last_count), cashCounted: pc.count_sheet.cash_counted as never, countedByName: '[ผู้จัดการบัญชี]' });
    expect([c0.fundId, c0.cashCounted, c0.vouchers, c0.difference, c0.balanced]).toEqual([office.id, pc.count_sheet.cash_counted, pc.count_sheet.vouchers, '0.00', true]);
    const s = await pettyCashSummary(db, A);
    expect(s.fund).toMatchObject({ id: office.id, code: pc.fund, name: 'กองสำนักงานใหญ่', isDefault: true });
    expect(s.lastCount).toMatchObject({ count_date: ce(pc.last_count), cash_counted: pc.count_sheet.cash_counted, difference: '0.00', counted_by_name: '[ผู้จัดการบัญชี]' });
  });
  it('รายการแยกตามกอง · กองตั้งต้นรวมรายการที่ไม่ระบุกอง · ตรวจนับมีผลต่าง · เบิกชดเชยเฉพาะกองที่เลือก', async () => {
    const pc = fx.petty_cash;
    const payee = await contact('P0001');
    for (const i of pc.items_shown.filter((x) => x.date)) {
      await savePettyCash(db, A, clerk, { date: ce(i.date!), description: i.desc!, accountCode: i.account!, amount: i.amount, vatMode: i.vat as 'none', inputVat: i.input_vat ?? null,
        whtType: i.wht ? 'hire_of_work' : null, contactId: i.wht ? payee : null, evidence: i.evidence!, paidBy: i.by!, docNo: i.no });
    }
    // กองที่สอง (ชื่อ/วงเงินตามแบบร่าง "กองคลังสินค้า · วงเงิน 10,000")
    const wh = await createPettyCashFund(db, A, { code: 'warehouse', name: 'กองคลังสินค้า', imprest: '10000.00' });
    await savePettyCash(db, A, clerk, { date: '2026-11-20', description: 'ค่าน้ำมัน', accountCode: '5302100', amount: '500.00', vatMode: 'none', evidence: 'ใบเสร็จ', paidBy: '[คลัง]', fundId: wh.id });
    const office = await pettyCashSummary(db, A);
    expect([office.spentPending, office.onHand]).toEqual(['6072.00', '23928.00']);
    expect(office.funds.map((f) => f.code)).toEqual([pc.fund, 'warehouse']);
    const whs = await pettyCashSummary(db, A, wh.id);
    expect([whs.imprest, whs.spentPending, whs.onHand, whs.items.length]).toEqual(['10000.00', '500.00', '9500.00', 1]);
    const c1 = await countPettyCash(db, A, mgr, { date: '2026-11-30', cashCounted: '23900.00' });
    expect([c1.vouchers, c1.difference, c1.balanced]).toEqual(['6072.00', '-28.00', false]);
    const r = await reimbursePettyCash(db, A, director, { date: '2026-11-30', payFrom: '1100100', fundId: wh.id });
    expect([r.total, r.items]).toEqual(['500.00', 1]);
    expect((await pettyCashSummary(db, A)).spentPending).toBe('6072.00');
    expect((await pettyCashSummary(db, A, wh.id)).spentPending).toBe('0.00');
  });
});
