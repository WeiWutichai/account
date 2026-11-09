// M5 ซื้อ + จ่ายเงินบน DB จริง — ตัวเลขจาก fixtures (EXP2611-0019 · AP2611-0079 + CNR2611-0003 · PAYRUN-2569-11-28 · PV2611-0031/32/33)
import { fromTuples, toTuples, type JournalLineTuple } from '@innovera/ledger';
import { WHT_TYPES } from '@innovera/tax-th';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import { approvePayment, approvePurchase, createPayment, createPaymentRun, payables, savePurchaseDraft, setCompanySetting, whtCertificates } from '../src/purchase.ts';
import { getDocument, type Actor } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

type FxLine = { desc: string; account: string; amount: string; vat: boolean; wht?: string | null };
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/sample-company.json', import.meta.url), 'utf8')) as { documents: Record<string, Record<string, unknown>>; wht_rates: Record<string, { rate: number; pnd: string; status?: string }> };
const D = (no: string) => fx.documents[no]! as Record<string, string> & { lines?: FxLine[]; expected_journal?: JournalLineTuple[]; bills?: string[] };
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const set = (t: readonly (readonly string[])[]) => new Set(t.map((x) => x.join(' ')));
const clerk: Actor = { userId: '00000000-0000-4000-8000-0000000000c1', role: 'accountant' };
const mgr = { userId: '00000000-0000-4000-8000-0000000000c2', role: 'accounting_manager' as const, approvalLimit: null };

let db: Db;
let A = '';
const contact = async (code: string) => (await db.withCompany(A, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const journalOf = async (docId: string) => db.withCompany(A, async (tx) => {
  const d = await tx.selectFrom('acct.document').select('journal_id').where('id', '=', docId).executeTakeFirstOrThrow();
  const lines = await tx.selectFrom('acct.journal_line').select(['account_code', 'debit', 'credit']).where('journal_id', '=', d.journal_id!).orderBy('line_no').execute();
  return toTuples(fromTuples(lines.map((l) => (Number(l.debit) > 0 ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit]) as JournalLineTuple)));
});
/** บิลซื้อบรรทัดเดียว (VAT ตามที่ระบุ) */
async function bill(code: string, amount: string, account: string, whtType: string | null, vat = false, date = '2026-11-10') {
  const id = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(code), issueDate: date, lines: [{ description: 'บิล', qty: '1', unitPrice: amount, vat, accountCode: account, whtType }] });
  await approvePurchase(db, A, mgr, id);
  return id;
}

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  A = await createCompany(db, { orgId: org, nameTh: 'บริษัท ก จำกัด' });
  await seedCompany(db, A);
}, 120_000);
afterAll(() => db.close());

it('อัตราหัก ณ ที่จ่ายตามกฎหมายใน tax-th ตรงกับ fixtures wht_rates', () => {
  for (const [k, v] of Object.entries(fx.wht_rates)) {
    if (!WHT_TYPES[k]) continue; // interest_received = ฝั่งรับ
    expect(Number(WHT_TYPES[k]!.rate)).toBe(v.rate);
  }
  expect(WHT_TYPES.freelance_software_dev!.status).toBe('PENDING_AUDITOR');
});

describe('EXP2611-0019 จ่ายทันที + หัก ณ ที่จ่ายฟรีแลนซ์ (รอยืนยัน)', () => {
  it('journal ตาม expected_journal · 50 ทวิ ภ.ง.ด.3 ติดธงรอผู้สอบบัญชี', async () => {
    const e = D('EXP2611-0019');
    const id = await savePurchaseDraft(db, A, clerk, { docType: 'EXP', contactId: await contact(e.contact!), issueDate: ce(e.date!), payNow: true, payFrom: e.pay_from!,
      lines: e.lines!.map((l) => ({ description: l.desc, qty: '1', unitPrice: l.amount, vat: l.vat, accountCode: l.account, whtType: l.wht ?? null })) });
    const r = await approvePurchase(db, A, mgr, id);
    expect(set(await journalOf(id))).toEqual(set(e.expected_journal!));
    expect(r.certificates).toHaveLength(1);
    expect(r.certificates?.[0]).toMatchObject({ pnd: e.pnd, amount: e.wht, pendingAuditor: true, section: '40(2)' });
  });
  it('ตั้งค่าเป็นอัตราก้าวหน้า → ระบบไม่คำนวณเอง (รอผู้สอบบัญชี) และไม่บันทึกอะไร', async () => {
    await setCompanySetting(db, A, 'tax.wht.freelance_software_dev', { income_type: '40(2)', method: 'progressive' });
    const id = await savePurchaseDraft(db, A, clerk, { docType: 'EXP', contactId: await contact('P0001'), issueDate: '2026-11-12', payNow: true, payFrom: '1100100',
      lines: [{ description: 'ค่าจ้าง', qty: '1', unitPrice: '20000.00', vat: false, accountCode: '5301200', whtType: 'freelance_software_dev' }] });
    await expect(approvePurchase(db, A, mgr, id)).rejects.toThrow(/รอผู้สอบบัญชี/u);
    expect((await getDocument(db, A, id))?.doc.status).toBe('draft');
    await setCompanySetting(db, A, 'tax.wht.freelance_software_dev', { income_type: '40(2)', method: 'flat', rate: '0.03' });
  });
});

describe('PAYRUN-2569-11-28: AP2611-0079 (+ CNR2611-0003) · AP2611-0088/0091 · AP2611-0080', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const ap = D('AP2611-0079');
    ids['AP2611-0079'] = await savePurchaseDraft(db, A, clerk, { docType: 'AP', contactId: await contact(ap.contact!), issueDate: ce(ap.date!), vendorRef: ap.vendor_invoice!,
      lines: ap.lines!.map((l) => ({ description: l.desc, qty: '1', unitPrice: l.amount, vat: l.vat, accountCode: l.account, whtType: 'service' })) });
    await approvePurchase(db, A, mgr, ids['AP2611-0079']!);
    const cnr = D('CNR2611-0003');
    const cnrId = await savePurchaseDraft(db, A, clerk, { docType: 'CNR', contactId: await contact(cnr.contact!), issueDate: ce(cnr.date!), refDocumentId: ids['AP2611-0079']!, vendorRef: cnr.vendor_cn!,
      lines: [{ description: cnr.reason!, qty: '1', unitPrice: cnr.subtotal!, vat: true, accountCode: '5301200' }] });
    await approvePurchase(db, A, mgr, cnrId);
    expect(set(await journalOf(cnrId))).toEqual(set(cnr.expected_journal!));
    ids['AP2611-0088'] = await bill('V0102', '600000.00', '5301300', 'transport_domestic');
    ids['AP2611-0091'] = await bill('V0102', '120000.00', '5301300', 'transport_domestic');
    ids['AP2611-0080'] = await bill('V0330', '50000.00', '5303100', 'rent');
  });
  it('ยอดค้างหลังลดหนี้ + ภาษีหักที่จะหักตอนจ่าย', async () => {
    const p = await payables(db, A);
    const ap79 = p.find((x) => x.id === ids['AP2611-0079'])!;
    expect(ap79.outstanding).toBe(D('CNR2611-0003').ap_after);
    expect(ap79.wht[0]).toMatchObject({ base: D('PV2611-0032').wht_base, amount: D('PV2611-0032').wht });
  });
  it('รอบจ่าย 4 บิล → ใบสำคัญจ่าย 3 ใบ (ต่อผู้ขาย) ยอดรวมตาม fixtures', async () => {
    const run = D('PAYRUN-2569-11-28') as unknown as { selected_bills: string[]; selected_total: string; total_wht: string; paid_total: string };
    const r = await createPaymentRun(db, A, clerk, { date: '2026-11-28', payFrom: '1100100', billIds: run.selected_bills.map((b) => ids[b]!), batchRef: 'PAYRUN-2569-11-28' });
    expect(r.vouchers).toHaveLength(3);
    expect([r.selectedTotal, r.totalWht, r.paidTotal]).toEqual([run.selected_total, run.total_wht, run.paid_total]);
    // ผู้สร้างอนุมัติเองไม่ได้ · เกินวงเงินไม่ได้
    const v0102 = r.vouchers.find((v) => v.paid === D('PV2611-0031').paid)!;
    await expect(approvePayment(db, A, { ...clerk, approvalLimit: null }, v0102.id)).rejects.toThrow(/แบ่งหน้าที่/u);
    await expect(approvePayment(db, A, { ...mgr, approvalLimit: '500000.00' }, v0102.id)).rejects.toThrow(/เกินวงเงิน/u);
    // อนุมัติ → journal + 50 ทวิ ตาม PV2611-0031/32/33
    for (const no of ['PV2611-0031', 'PV2611-0032', 'PV2611-0033']) {
      const pv = D(no);
      const v = r.vouchers.find((x) => x.paid === pv.paid)!;
      const a = await approvePayment(db, A, mgr, v.id, { docNo: no, certNos: [pv.wht_cert!] });
      expect(set(await journalOf(v.id))).toEqual(set(pv.expected_journal!));
      expect(a.certificates[0]).toMatchObject({ certNo: pv.wht_cert, pnd: pv.pnd, amount: pv.wht });
    }
    expect((await payables(db, A)).filter((x) => Object.values(ids).includes(x.id))).toEqual([]);
    const certs = await whtCertificates(db, A, { pnd: '53', from: '2026-11-01', to: '2026-11-30' });
    expect(certs.map((c) => c.cert_no)).toEqual(['WHT2611-0012', 'WHT2611-0013', 'WHT2611-0014']);
  });
  it('จ่ายบางส่วน: ภาษีหักตามสัดส่วน · จ่ายเกินยอดค้างไม่ได้', async () => {
    const b = await bill('V0330', '10000.00', '5303100', 'rent');
    const p = await createPayment(db, A, clerk, { contactId: await contact('V0330'), date: '2026-11-29', payFrom: '1100100', bills: [{ documentId: b, settle: '4000.00' }] });
    expect([p.settled, p.wht, p.paid]).toEqual(['4000.00', '200.00', '3800.00']);
    await expect(createPayment(db, A, clerk, { contactId: await contact('V0330'), date: '2026-11-29', payFrom: '1100100', bills: [{ documentId: b, settle: '10000.01' }] })).rejects.toThrow(/ไม่เกินยอดค้าง/u);
  });
});
