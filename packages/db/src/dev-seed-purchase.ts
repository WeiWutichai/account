// dev seed (DEV ONLY): เอกสารซื้อ/จ่ายเงินจาก fixtures ผ่าน purchase service จริง (เลขที่ตรง fixtures) — หน้าจอ M5
import type { Db } from './index.ts';
import { fromTuples } from '@innovera/ledger';
import { postJournal } from './ledger-service.ts';
import { approvePayment, approvePurchase, createPaymentRun, savePettyCash, savePurchaseDraft, type PurchaseDraftInput } from './purchase.ts';
import { submitDocument, type Actor } from './sales.ts';

type Fx = Record<string, unknown> & { type: string; date?: string; due?: string; contact?: string; status?: string; desc?: string; grand_total?: string; subtotal?: string;
  vendor_invoice?: string; vat_exempt?: string; wht_on_payment?: { rate: number }; lines?: { desc: string; account?: string; amount?: string; qty?: string; price?: string; vat?: boolean; wht?: string | null }[];
  expected_journal?: [string, string, string][] };
export const SEEDED_PURCHASE_TYPES = ['AP', 'EXP', 'CNR', 'PV', 'PO'];
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const clerk: Actor = { userId: '00000000-0000-4000-8000-0000000000c1', role: 'accountant' };   // ผู้จัดทำ (dev)
const approver = { userId: null, role: 'owner' as const, approvalLimit: null };
const WHT_BY_RATE: Record<string, string> = { '0.01': 'transport_domestic', '0.02': 'advertising', '0.03': 'service', '0.05': 'rent' };

export async function seedPurchaseDocuments(db: Db, companyId: string, docs: Record<string, Fx>): Promise<string[]> {
  const ids: Record<string, string> = {};
  const contacts = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.contact').select(['id', 'code']).execute());
  const cid = (code?: string) => contacts.find((c) => c.code === code)?.id;
  // TODO(Wei): บิลซื้อหลายใบใน fixtures ไม่มีวันที่ (AP2611-0088/0091/0080/0094) → ใช้ 15/11/2569
  const dateOf = (d: Fx) => ce(d.date ?? '2569-11-15');
  /** บรรทัด: จาก lines ถ้ามี · ไม่งั้น 1 บรรทัด (บัญชีจากฝั่ง Dr ของ expected_journal · VAT ถ้าไม่ใช่รายการยกเว้น · ประเภทเงินได้จากอัตรา wht_on_payment) */
  function draft(no: string, d: Fx, docType: PurchaseDraftInput['docType'], extra: Partial<PurchaseDraftInput> = {}): PurchaseDraftInput | null {
    const contactId = cid(d.contact);
    if (!contactId) return null;
    const whtType = d.wht_on_payment ? WHT_BY_RATE[String(d.wht_on_payment.rate)] ?? null : d.vat_exempt === '81(1)(ต)' ? 'transport_domestic' : d.vat_exempt === '81(1)(ฑ)' ? 'rent' : null;
    const lines = d.lines?.length
      ? d.lines.map((l) => ({ description: l.desc, qty: l.qty ?? '1', unitPrice: l.price ?? l.amount!, vat: l.vat ?? true, accountCode: l.account ?? '5301200', whtType: l.wht === undefined ? whtType : l.wht }))
      : [{ description: d.desc ?? no, qty: '1', unitPrice: d.vat_exempt ? d.grand_total! : (d.subtotal ?? d.grand_total!), vat: !d.vat_exempt, accountCode: d.expected_journal?.find((x) => x[0] === 'Dr' && x[1] !== '1170100')?.[1] ?? '5301200', whtType }];
    const priceInclVat = !d.lines?.length && !d.vat_exempt && !d.subtotal;
    return { docType, contactId, issueDate: dateOf(d), dueDate: d.due ? ce(d.due) : null, vendorRef: d.vendor_invoice ?? null, priceInclVat, lines, ...extra };
  }
  async function make(no: string, docType: PurchaseDraftInput['docType'], extra: Partial<PurchaseDraftInput> = {}) {
    const d = docs[no];
    const input = d ? draft(no, d, docType, extra) : null;
    if (!input) return null;
    ids[no] = await savePurchaseDraft(db, companyId, clerk, input);
    return ids[no]!;
  }
  const post = async (no: string, id: string | null) => { if (id) await approvePurchase(db, companyId, { userId: null, role: 'owner' }, id, { docNo: no }); };

  await post('PO2611-0018', await make('PO2611-0018', 'PO'));
  const exp = docs['EXP2611-0019']!;
  const expId = await make('EXP2611-0019', 'EXP', { payNow: true, payFrom: String(exp.pay_from) });
  if (expId) await approvePurchase(db, companyId, { userId: null, role: 'owner' }, expId, { docNo: 'EXP2611-0019', certNos: [String(exp.wht_cert)] });
  for (const no of ['AP2611-0079', 'AP2611-0088', 'AP2611-0091', 'AP2611-0080', 'AP2611-0043']) await post(no, await make(no, 'AP'));
  const cnr = docs['CNR2611-0003']!;
  await post('CNR2611-0003', await make('CNR2611-0003', 'CNR', { refDocumentId: ids['AP2611-0079']!, vendorRef: String(cnr.vendor_cn),
    lines: [{ description: String(cnr.reason), qty: '1', unitPrice: String(cnr.subtotal), vat: true, accountCode: '5301200' }] }));
  const pending = await make('AP2611-0042', 'AP');
  if (pending) await submitDocument(db, companyId, clerk, pending);
  await make('AP2611-0094', 'AP');
  // รอบจ่าย 28/11 → PV2611-0031/32/33 + 50 ทวิ WHT2611-0012/13/14
  const run = docs['PAYRUN-2569-11-28']! as unknown as { selected_bills: string[] };
  const r = await createPaymentRun(db, companyId, clerk, { date: '2026-11-28', payFrom: '1100100', billIds: run.selected_bills.map((b) => ids[b]!), batchRef: 'PAYRUN-2569-11-28' });
  for (const no of ['PV2611-0031', 'PV2611-0032', 'PV2611-0033']) {
    const pv = docs[no]! as Fx & { paid: string; wht_cert: string };
    const v = r.vouchers.find((x) => x.paid === pv.paid);
    if (v) await approvePayment(db, companyId, approver, v.id, { docNo: no, certNos: [pv.wht_cert] });
  }
  // เงินสดย่อย: ตั้งวงเงิน + รายการที่แสดงในแบบร่าง (ยังไม่เบิกชดเชย) — TODO(Wei): อีก 6 รายการ (17,346.00) ไม่มีรายละเอียดใน fixtures
  const pc = (docs as unknown as Record<string, unknown>).__petty as { imprest: string; items_shown: { date?: string; no: string; desc?: string; account?: string; vat?: string; amount: string; input_vat?: string; wht?: string; evidence?: string; by?: string }[] } | undefined;
  if (pc) {
    await postJournal(db, companyId, { date: '2026-10-01', lines: fromTuples([['Dr', '1000200', pc.imprest], ['Cr', '1100100', pc.imprest]]), role: 'owner', description: 'ตั้งวงเงินเงินสดย่อย' });
    for (const i of pc.items_shown.filter((x) => x.date)) {
      await savePettyCash(db, companyId, clerk, { date: ce(i.date!), description: i.desc!, accountCode: i.account!, amount: i.amount, vatMode: i.vat as 'none', inputVat: i.input_vat ?? null,
        whtType: i.wht ? 'hire_of_work' : null, contactId: i.wht ? cid('P0001')! : null, evidence: i.evidence!, paidBy: i.by!, docNo: i.no });
    }
  }
  // TODO(Wei): AP2610-0038 / AP2611-0090 / AP2610-0071 / EXP2611-0021 / EXP2611-0023 / AP2611-0085 อ้างผู้ขายที่ไม่มีรหัสใน fixtures → ไม่สร้าง
  return [`เอกสารซื้อ ${Object.keys(ids).length} ใบ + ใบสำคัญจ่าย ${r.vouchers.length} ใบ`];
}
