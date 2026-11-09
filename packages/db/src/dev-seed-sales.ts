// dev seed (DEV ONLY): เอกสารขาย/รับเงินจาก fixtures สร้างผ่าน sales service จริง (เลขที่ตรง fixtures) — หน้าจอ M4 แสดงตัวเลขตามแบบร่าง
// เรียกจาก dev-seed.ts · journal ของเอกสารเหล่านี้มาจาก Posting Engine (ไม่ใช้ expected_journal ตรง ๆ)
import { docTotals, Money } from '@innovera/ledger';
import { Decimal } from 'decimal.js';
import type { Db } from './index.ts';
import { approveDocument, createBilling, receivePayment, saveSalesDraft, submitDocument, voidDocument, type Actor, type SalesDraftInput } from './sales.ts';

type Fx = Record<string, unknown> & { type: string; date?: string; due?: string; contact?: string; status?: string; desc?: string; subtotal?: string; vat?: string; grand_total?: string; total?: string;
  lines?: { product?: string | null; desc: string; qty?: string; price?: string; price_incl_vat?: string; amount?: string; account?: string; returned_qty?: string }[]; rule?: string; price_incl_vat?: boolean };
export const SEEDED_SALES_TYPES = ['IV', 'CN', 'DN', 'QO', 'DP', 'BN', 'RV'];
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const actor: Actor = { userId: null, role: 'owner' };

export async function seedSalesDocuments(db: Db, companyId: string, docs: Record<string, Fx>): Promise<string[]> {
  const log: string[] = [];
  const ids: Record<string, string> = {};
  const contacts = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.contact').select(['id', 'code']).execute());
  const cid = (code?: string) => contacts.find((c) => c.code === code)?.id;

  /** บรรทัดของเอกสาร: ใช้ lines ใน fixtures ถ้ามี ไม่งั้น 1 บรรทัดจากยอด (ราคารวม VAT ถ้ายอดก่อนภาษี × 7% ไม่เท่า VAT ของใบ) */
  function linesOf(no: string, d: Fx): Pick<SalesDraftInput, 'lines' | 'priceInclVat'> {
    if (d.lines?.length) {
      const ls = d.lines.filter((l) => !l.returned_qty || l.returned_qty !== '0');
      const incl = d.price_incl_vat ?? d.lines.some((l) => l.price_incl_vat !== undefined);
      return { priceInclVat: incl, lines: ls.map((l) => {
        const qty = l.returned_qty ?? l.qty ?? '1';
        const price = l.price ?? l.price_incl_vat ?? l.amount!;
        // ส่วนลดแบบ % ซ้อน (เช่น "10% + 5%" ใน QO2611-0014) เก็บเป็นยอดส่วนลดของบรรทัด = จำนวน × ราคา − จำนวนเงิน
        const gross = Money.parse(new Decimal(qty).times(price).toFixed(2));
        const disc = l.amount && !l.returned_qty ? gross.minus(Money.of(l.amount as never)) : Money.zero();
        return { productCode: l.product ?? null, description: l.desc ?? no, qty, unitPrice: price, discount: disc.toString(), vat: true, accountCode: l.account ?? null };
      }) };
    }
    const total = d.grand_total ?? d.total!;
    const sub = d.subtotal ?? Money.of(total as never).ratio(Money.parse('100.00'), Money.parse('107.00')).round().toString();
    const ex = docTotals([{ qty: '1', unitPrice: sub, vat: true }], { priceInclVat: false });
    const incl = d.price_incl_vat || ex.grandTotal !== total;
    return { priceInclVat: incl, lines: [{ description: d.desc ?? 'ค่าบริการ', qty: '1', unitPrice: incl ? total : sub, vat: true }] };
  }
  async function doc(no: string, docType: SalesDraftInput['docType'], extra: Partial<SalesDraftInput> = {}) {
    const d = docs[no]!;
    const contactId = cid(d.contact);
    if (!contactId) { log.push(`ข้าม ${no}: ไม่มีคู่ค้า ${d.contact}`); return null; }
    // TODO(Wei): บางเอกสารใน fixtures ไม่มีวันที่ (IV2611-0058) → ใช้วันที่ใกล้เคียงตามลำดับเลขที่
    const date = ce(d.date ?? extra.issueDate ?? '2569-11-12');
    const id = await saveSalesDraft(db, companyId, actor, { docType, contactId, dueDate: d.due ? ce(d.due) : null, ...(d.rule ? { ruleCode: d.rule } : {}), ...linesOf(no, d), ...extra, issueDate: date } as SalesDraftInput);
    ids[no] = id;
    return id;
  }
  const post = async (no: string, id: string | null) => { if (id) await approveDocument(db, companyId, actor, id, { docNo: no }); };

  // ใบเสนอราคา (อนุมัติแล้ว ไม่ลงบัญชี)
  for (const no of ['QO2611-0014', 'QO2611-0030']) await post(no, await doc(no, 'QO'));
  // เงินมัดจำ (รับเข้าบัญชีออมทรัพย์)
  for (const no of ['DP2605-0001', 'DP2610-0006']) {
    const d = docs[no]!;
    const base = (d.deposit_base as string | undefined) ?? Money.of(d.total as never).ratio(Money.parse('100.00'), Money.parse('107.00')).round().toString();
    await post(no, await doc(no, 'DP', { receiveAccount: '1100100', lines: [{ description: `เงินมัดจำ ${(d.ref as string | undefined) ?? ''}`.trim(), qty: '1', unitPrice: base, vat: true }], priceInclVat: false }));
  }
  // ใบแจ้งหนี้ที่ลงบัญชีแล้ว (รวมค้างชำระ/ชำระแล้ว)
  for (const no of ['IV2610-0047', 'IV2610-0048', 'IVS2610-0008', 'IV2610-0049', 'IV2611-0001', 'IV2611-0051', 'IV2611-0053', 'IV2611-0056', 'IV2611-0058', 'IV2611-0059']) {
    const d = docs[no];
    if (!d) continue;
    const immediate = no === 'IV2611-0001'; // ขายสินค้า: ใบกำกับทันที (ข้อสังเกต 6 ใน PROGRESS — รอ Wei)
    await post(no, await doc(no, 'IV', immediate ? { taxMode: 'immediate', ruleCode: 'Credit[IV]' } : {}));
    if (d.status === 'voided') await voidDocument(db, companyId, actor, ids[no]!, { reason: String(d.void_reason ?? 'ยกเลิก') });
  }
  // รออนุมัติ / ร่าง
  const pending = await doc('IV2611-0052', 'IV');
  if (pending) await submitDocument(db, companyId, actor, pending);
  await doc('CN2611-0003', 'CN', { refDocumentId: ids['IV2611-0001']!, taxMode: 'immediate', ruleCode: 'CN[ref IV]', issueDate: '2569-11-20' });
  await doc('DN2612-0001', 'DN', { refDocumentId: ids['IV2610-0047']! });
  // ใบวางบิล — TODO(Wei): fixtures ไม่มีวันที่ออกของ BN2611-0002 (มีแต่วันนัดรับเงิน) → ใช้ 15/11/2569
  for (const [no, date] of [['BN2611-0002', '2026-11-15'], ['BN2611-0004', '2026-11-16']] as const) {
    const d = docs[no]!;
    const inv = (d.invoices as string[]).map((n) => ids[n]).filter((x): x is string => !!x);
    await createBilling(db, companyId, actor, { contactId: cid(d.contact)!, date, dueDate: d.collect_date ? ce(d.collect_date as string) : null, documentIds: inv, docNo: no });
  }
  // รับชำระ
  const rv21 = docs['RV2611-0021']! as Fx & { applications: { doc: string; applied: string; wht: string; wht_base?: string }[]; bank_account: string; bank_fee: string; fee_account: string };
  await receivePayment(db, companyId, actor, { docNo: 'RV2611-0021', contactId: cid(rv21.contact)!, date: ce(rv21.date!), receiveAccount: rv21.bank_account, fee: rv21.bank_fee, feeAccount: rv21.fee_account,
    whtCertNo: '0045/2569', whtRate: '0.03', billingId: null, applications: rv21.applications.map((a) => ({ documentId: ids[a.doc]!, applied: a.applied, wht: a.wht, ...(a.wht_base ? { whtBase: a.wht_base } : {}) })) });
  const rv22 = docs['RV2611-0022']!;
  await receivePayment(db, companyId, actor, { docNo: 'RV2611-0022', contactId: cid(rv22.contact)!, date: ce(rv22.date!), receiveAccount: String(rv22.pay_to), whtRate: '0.03',
    applications: [{ documentId: ids['IV2610-0047']!, applied: String(rv22.cash_in), wht: String(rv22.wht), whtBase: '10000.00' }] });
  const rv25 = docs['RV2611-0025']!;
  await receivePayment(db, companyId, actor, { docNo: 'RV2611-0025', contactId: cid(rv25.contact)!, date: ce(rv25.date!), receiveAccount: '1150100',
    cheque: { chequeNo: String(rv25.cheque), bank: '[ธนาคาร]', chequeDate: ce(rv25.date!) }, applications: [{ documentId: ids['IV2611-0059']!, applied: String(rv25.amount) }] });
  // TODO(Wei): IV2611-0051 สถานะ "paid" แต่ fixtures ไม่มีใบรับชำระ · RV2611-0024 อ้าง IV2611-0063 ที่ไม่มีใน fixtures → ไม่สร้าง
  log.push(`เอกสารขาย ${Object.keys(ids).length} ใบ + RV 3 ใบ + BN 2 ใบ`);
  return log;
}
