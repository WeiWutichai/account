// Phase 2A SWT — ภาษีจ่ายต่างประเทศ: ภ.พ.36 (VAT นำส่งแทน) · ภ.ง.ด.54 (หัก ณ ที่จ่ายจ่ายต่างประเทศ)
// จุดรับรู้ = ตอนจ่ายเงินจริง (เหมือน WHT ในประเทศ · CLAUDE.md) — purchase.ts เรียก pnd54Item / foreignTaxOnPaymentTx ตอนอนุมัติจ่าย
// ทุกเงื่อนไข/อัตรา = ค่าตั้งบริษัท "รอยืนยัน" (ผู้สอบบัญชี) · ห้ามตัดสินเอง:
//   tax.pp36.enabled (true) · tax.pnd54.treaty_rates ({} = อัตราตามประมวล) · tax.pnd54.gross_up (false) · tax.pnd54.gross_up_account (ไม่มีค่าตั้งต้น)
import { Money, type CompanyRole, type JournalLine, type MoneyString } from '@innovera/ledger';
import { pnd54Rate, pnd54Tax, PP36_RATE, pp36Vat, type TreatyRates } from '@innovera/tax-th';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, postJournalTx } from './ledger-service.ts';
import { moduleOnTx, settingTx } from './swt-hooks.ts';

export const PP36_INPUT = '1170200';      // ภาษีซื้อรอใช้สิทธิ (ภ.พ.36)
export const PP36_PAYABLE = '2150500';    // ภาษี ภ.พ.36 ค้างนำส่ง
export const PND54_PAYABLE = '2150600';   // ภาษีหัก ณ ที่จ่าย ภ.ง.ด.54 ค้างนำส่ง
export const WHT_PAYABLE = '2150300';
export const INPUT_VAT = '1170100';
export const SWT_TAX_KEYS = {
  pp36Enabled: 'tax.pp36.enabled', treatyRates: 'tax.pnd54.treaty_rates', grossUp: 'tax.pnd54.gross_up', grossUpAccount: 'tax.pnd54.gross_up_account',
} as const;

/** รายการภาษีหัก ณ ที่จ่ายของบิล (ผลของ whtForBill) · pnd = '54' เมื่อเป็นเงินได้จ่ายต่างประเทศ */
export interface WhtItem {
  type: string; label: string; section: string | null; base: MoneyString; rate: string; amount: MoneyString; pendingAuditor: boolean;
  pnd?: '54'; grossUp?: boolean; country?: string | null; treaty?: boolean;
}
/** ยอดที่หักจากเงินที่จ่ายผู้รับ (ไม่รวมภาษีที่ผู้จ่ายออกแทน) */
export const withheldOf = (items: readonly WhtItem[]): Money => Money.sum(items.filter((w) => !w.grossUp).map((w) => Money.of(w.amount)));

/** ภ.ง.ด.54 ของฐาน (บาท) ที่จ่ายผู้รับต่างประเทศ · ต้องเปิดโมดูล + ผู้รับเป็นนิติบุคคลต่างประเทศ */
export async function pnd54Item(tx: CompanyTx, contactId: string | null, type: string, base: Money): Promise<WhtItem> {
  if (!(await moduleOnTx(tx))) throw new LedgerError('ประเภทเงินได้ ภ.ง.ด.54 ใช้ได้เมื่อเปิดโมดูลสัญญา/ซอฟต์แวร์ (software)');
  const c = contactId ? await tx.selectFrom('acct.contact').select(['entity_type', 'country', 'name']).where('id', '=', contactId).executeTakeFirst() : undefined;
  if (c?.entity_type !== 'foreign') throw new LedgerError('ภ.ง.ด.54 ใช้กับผู้รับเงินที่เป็นนิติบุคคลต่างประเทศเท่านั้น (ประเภทผู้ติดต่อ: ต่างประเทศ)');
  const treaty = await settingTx<TreatyRates>(tx, SWT_TAX_KEYS.treatyRates, {});
  const grossUp = (await settingTx<unknown>(tx, SWT_TAX_KEYS.grossUp, false)) === true;
  const r = pnd54Rate(type, c.country, treaty);
  const t = pnd54Tax(base.toString(), r.rate, grossUp);
  // รอผู้สอบบัญชี: อัตราตามประมวล/อนุสัญญา ยังไม่ยืนยัน → ป้าย "รอยืนยัน" ใน 50 ทวิ และรายงาน
  return { type, label: r.label, section: r.section, base: t.base, rate: r.rate, amount: t.tax, pendingAuditor: true, pnd: '54', grossUp, country: c.country, treaty: r.treaty };
}

interface Pp36Calc { billId: string; contactId: string; base: Money; vat: Money }
/**
 * ภ.พ.36 ของการจ่ายบิล: ผู้ขายต่างประเทศ (entity_type = foreign) · บรรทัดไม่มี VAT ที่ไม่ใช่สินค้า (goods = นำเข้า เสีย VAT ที่ศุลกากร)
 * ฐาน = ยอดบรรทัดบริการ (ก่อนหัก ณ ที่จ่าย) ตามสัดส่วนที่จ่ายสะสม · จ่ายครบ = ยอดเต็ม (ไม่มีเศษ)
 * TODO(Wei) รอผู้สอบบัญชี: เงื่อนไข ภ.พ.36 แต่ละกรณี (ค่า cloud/โฆษณา/license · ผู้ขายจด VAT e-service) · ฐานเมื่อผู้จ่ายออกภาษี ภ.ง.ด.54 แทน · อัตราแลกเปลี่ยน ณ วันจ่าย (โมดูล FX)
 */
async function pp36ForBill(tx: CompanyTx, billId: string, settle: Money, outstandingBefore: Money): Promise<Pp36Calc | null> {
  const bill = await tx.selectFrom('acct.document as d').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.grand_total', 'd.subtotal', 'd.discount', 'd.contact_id', 'c.entity_type']).where('d.id', '=', billId).executeTakeFirst();
  if (!bill || bill.entity_type !== 'foreign' || !bill.contact_id) return null;
  const lines = await tx.selectFrom('acct.document_line as l').leftJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'l.product_code').onRef('p.company_id', '=', 'l.company_id'))
    .select(['l.amount', 'l.vat_rate', 'p.kind']).where('l.document_id', '=', billId).where('l.line_type', '=', 'item').execute();
  let base0 = Money.sum(lines.filter((l) => l.vat_rate === null && l.kind !== 'goods').map((l) => Money.parse(l.amount)));
  if (base0.isZero()) return null;
  const subtotal = Money.parse(bill.subtotal);
  if (!Money.parse(bill.discount).isZero() && !subtotal.isZero()) base0 = base0.ratio(subtotal.minus(Money.parse(bill.discount)), subtotal).round();
  const total = Money.parse(bill.grand_total);
  const cum = total.minus(outstandingBefore).plus(settle);
  const target = cum.equals(total) ? base0 : base0.ratio(cum, total).round();
  const prior = await tx.selectFrom('acct.pp36_entry as e').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 'e.payment_id').onRef('p.company_id', '=', 'e.company_id'))
    .select([sql<string>`coalesce(sum(e.base), 0)`.as('base'), sql<string>`coalesce(sum(e.vat), 0)`.as('vat')]).where('e.bill_id', '=', billId).where('p.status', '<>', 'voided').executeTakeFirstOrThrow();
  const base = target.minus(Money.parse(prior.base));
  const vat = Money.of(pp36Vat(target.toString())).minus(Money.parse(prior.vat));
  if (!base.gt(Money.zero())) return null;
  return { billId, contactId: bill.contact_id, base, vat };
}

/**
 * ปรับบรรทัดบัญชีของการจ่าย (PV / EXP จ่ายทันที) ตามภาษีต่างประเทศ · ไม่มีผู้ขายต่างประเทศ/โมดูลปิด = คืนบรรทัดเดิม
 * - ภ.ง.ด.54 ที่หักจากผู้รับ: ย้าย Cr 2150300 → Cr 2150600 · ผู้จ่ายออกแทน (gross-up): Dr บัญชีภาษีออกแทน / Cr 2150600
 * - ภ.พ.36: Dr 1170200 ภาษีซื้อรอใช้สิทธิ / Cr 2150500 ภาษี ภ.พ.36 ค้างนำส่ง
 * commit() บันทึก acct.pp36_entry หลังลงบัญชี
 */
export async function foreignTaxOnPaymentTx(tx: CompanyTx, companyId: string, p: { paymentId: string; date: string; bills: { billId: string; settle: Money; outstandingBefore: Money }[]; certs: readonly WhtItem[]; lines: JournalLine[] }) {
  const none = { lines: p.lines, pp36: [] as Pp36Calc[], commit: async () => {} };
  if (!(await moduleOnTx(tx))) return none;
  const lines = p.lines.map((l) => ({ ...l }));
  const f54 = p.certs.filter((c) => c.pnd === '54');
  const withheld = Money.sum(f54.filter((c) => !c.grossUp).map((c) => Money.of(c.amount)));
  const borne = Money.sum(f54.filter((c) => c.grossUp).map((c) => Money.of(c.amount)));
  if (!withheld.isZero()) {
    const i = lines.findIndex((l) => l.side === 'Cr' && l.account === WHT_PAYABLE);
    if (i < 0 || lines[i]!.amount.lt(withheld)) throw new LedgerError('ยอดภาษีหัก ณ ที่จ่ายในบรรทัดบัญชีไม่พอสำหรับ ภ.ง.ด.54');
    lines[i] = { ...lines[i]!, amount: lines[i]!.amount.minus(withheld) };
    lines.push({ side: 'Cr', account: PND54_PAYABLE, amount: withheld, memo: 'ภ.ง.ด.54' });
  }
  if (!borne.isZero()) {
    const acct = await settingTx<string | null>(tx, SWT_TAX_KEYS.grossUpAccount, null);
    if (!acct) throw new LedgerError(`ยังไม่ได้กำหนดบัญชีภาษีที่ผู้จ่ายออกแทน (${SWT_TAX_KEYS.grossUpAccount}) — รอยืนยัน`);
    lines.push({ side: 'Dr', account: acct, amount: borne, memo: 'ภาษี ภ.ง.ด.54 ที่ผู้จ่ายออกแทน (gross-up)' }, { side: 'Cr', account: PND54_PAYABLE, amount: borne, memo: 'ภ.ง.ด.54 (ออกแทน)' });
  }
  const pp36: Pp36Calc[] = [];
  if ((await settingTx<unknown>(tx, SWT_TAX_KEYS.pp36Enabled, true)) !== false) {
    for (const b of p.bills) {
      const c = await pp36ForBill(tx, b.billId, b.settle, b.outstandingBefore);
      if (c) pp36.push(c);
    }
  }
  const vat = Money.sum(pp36.map((c) => c.vat));
  if (!vat.isZero()) lines.push({ side: 'Dr', account: PP36_INPUT, amount: vat, memo: 'ภาษีซื้อรอใช้สิทธิ (ภ.พ.36)' }, { side: 'Cr', account: PP36_PAYABLE, amount: vat, memo: 'ภ.พ.36 ค้างนำส่ง' });
  return {
    lines: lines.filter((l) => !l.amount.isZero()), pp36,
    commit: async () => {
      for (const c of pp36) {
        await tx.insertInto('acct.pp36_entry').values({ company_id: companyId, payment_id: p.paymentId, bill_id: c.billId, contact_id: c.contactId, pay_date: p.date,
          base: c.base.toString(), rate: PP36_RATE, vat: c.vat.toString(), filing_id: null }).execute();
      }
    },
  };
}

// ---------- รายงาน + ยื่น ภ.พ.36 ----------

const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
};
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/u;
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

async function pp36Rows(tx: CompanyTx, from: string, to: string) {
  return tx.selectFrom('acct.pp36_entry as e').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 'e.payment_id').onRef('p.company_id', '=', 'e.company_id'))
    .innerJoin('acct.document as b', (j) => j.onRef('b.id', '=', 'e.bill_id').onRef('b.company_id', '=', 'e.company_id'))
    .innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'e.contact_id').onRef('c.company_id', '=', 'e.company_id'))
    .select(['e.id', 'e.pay_date', 'e.base', 'e.rate', 'e.vat', 'e.filing_id', 'p.doc_no as payment_no', 'b.doc_no as bill_no', 'b.vendor_ref', 'c.name', 'c.country', 'c.tax_id'])
    .where('p.status', '=', 'posted').where('e.pay_date', '>=', from).where('e.pay_date', '<=', to).orderBy('e.pay_date').orderBy('p.doc_no').execute();
}

/** รายงาน ภ.พ.36 ของเดือนที่จ่าย · กำหนดยื่นภายในวันที่ 7 ของเดือนถัดไป (TODO(Wei): ยื่นออนไลน์ขยายเป็นวันที่ 15 หรือไม่ — รอยืนยัน) */
export async function pp36Report(db: Db, companyId: string, ym: string) {
  if (!YM_RE.test(ym)) throw new LedgerError('ระบุเดือนภาษีเป็น YYYY-MM');
  const { from, to } = monthRange(ym);
  return db.withCompany(companyId, async (tx) => {
    const rows = await pp36Rows(tx, from, to);
    const filings = await tx.selectFrom('acct.tax_filing as f').leftJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'f.journal_id').onRef('j.company_id', '=', 'f.company_id'))
      .select(['f.id', 'f.seq', 'f.filed_at', 'f.reference_no', 'f.amount', 'j.journal_no']).where('f.form', '=', 'pp36').where('f.month', '=', ym).orderBy('f.seq').execute();
    return { month: ym, rows, base: Money.sum(rows.map((r) => Money.parse(r.base))).toString(), vat: Money.sum(rows.map((r) => Money.parse(r.vat))).toString(),
      unfiled: Money.sum(rows.filter((r) => !r.filing_id).map((r) => Money.parse(r.vat))).toString(), dueDate: `${nextMonth(ym)}-07`, pendingAuditor: true,
      status: filings.length ? 'filed' as const : 'draft' as const, filings };
  });
}

/**
 * บันทึกยื่น ภ.พ.36 + ชำระ: Dr 2150500 / Cr บัญชีที่จ่าย · ภาษีที่ชำระแล้วใช้เป็นภาษีซื้อเดือนที่ชำระ: Dr 1170100 / Cr 1170200
 * (JV ลงวันที่ยื่น → เข้ารายงานภาษีซื้อ/ภ.พ.30 ของเดือนที่ยื่น = เดือนถัดจากเดือนที่จ่ายค่าบริการ)
 * ยื่นซ้ำเดือนเดิม = ยื่นเพิ่มเติมเฉพาะรายการที่ยังไม่ยื่น
 */
export async function filePp36(db: Db, companyId: string, actor: { userId: string | null; role: CompanyRole }, p: { month: string; filedAt: string; payFrom: string; referenceNo?: string | null }) {
  if (!YM_RE.test(p.month)) throw new LedgerError('ระบุเดือนภาษีเป็น YYYY-MM');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(p.filedAt)) throw new LedgerError('ระบุวันที่ยื่นเป็น YYYY-MM-DD');
  if (p.filedAt < `${nextMonth(p.month)}-01`) throw new LedgerError('ยื่นแบบได้ตั้งแต่เดือนถัดจากเดือนที่จ่าย');
  const { from, to } = monthRange(p.month);
  return db.withCompany(companyId, async (tx) => {
    const rows = (await pp36Rows(tx, from, to)).filter((r) => !r.filing_id);
    const vat = Money.sum(rows.map((r) => Money.parse(r.vat)));
    if (!vat.gt(Money.zero())) throw new LedgerError('ไม่มีรายการ ภ.พ.36 ที่ยังไม่ยื่นในเดือนนี้');
    const seq = Number((await tx.selectFrom('acct.tax_filing').select(sql<string>`count(*)`.as('n')).where('form', '=', 'pp36').where('month', '=', p.month).executeTakeFirstOrThrow()).n);
    const lines: JournalLine[] = [
      { side: 'Dr', account: PP36_PAYABLE, amount: vat }, { side: 'Cr', account: p.payFrom, amount: vat },
      { side: 'Dr', account: INPUT_VAT, amount: vat, memo: 'ภาษีซื้อจาก ภ.พ.36' }, { side: 'Cr', account: PP36_INPUT, amount: vat },
    ];
    const be = `${p.month.slice(5)}/${Number(p.month.slice(0, 4)) + 543}`;
    const j = await postJournalTx(tx, companyId, { date: p.filedAt, lines, role: actor.role, book: 'GJ', description: `ยื่น/ชำระ ภ.พ.36 เดือน ${be}${seq ? ` (ยื่นเพิ่มเติม ครั้งที่ ${seq})` : ''}` });
    const f = await tx.insertInto('acct.tax_filing').values({ company_id: companyId, form: 'pp36', month: p.month, seq, status: 'filed', filed_at: p.filedAt, filed_by: actor.userId,
      reference_no: p.referenceNo ?? null, amount: vat.toString(), output_vat: null, input_vat: vat.toString(), carried_in: '0.00', carry_forward: '0.00', journal_id: j.id }).returning('id').executeTakeFirstOrThrow();
    await tx.updateTable('acct.pp36_entry').set({ filing_id: f.id }).where('id', 'in', rows.map((r) => r.id)).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'tax.filed', entity: 'tax_filing', entity_id: f.id,
      before: null, after: JSON.stringify({ form: 'pp36', month: p.month, seq, amount: vat.toString(), journal: j.journalNo }), prev_hash: null, hash: null }).execute();
    return { id: f.id, form: 'pp36' as const, month: p.month, seq, amount: vat.toString(), journalNo: j.journalNo, claimMonth: p.filedAt.slice(0, 7) };
  });
}

/** ภาษีซื้อจาก ภ.พ.36 ที่ชำระแล้ว (เข้ารายงานภาษีซื้อ/ภ.พ.30 เดือนที่ยื่น) · reports.ts purchaseRows ใช้ */
export async function pp36ClaimRows(tx: CompanyTx, fromYm: string, toYm: string) {
  const claim = sql<string>`to_char(f.filed_at, 'YYYY-MM')`;
  return tx.selectFrom('acct.tax_filing as f').select(['f.id', 'f.month', 'f.seq', 'f.filed_at', 'f.amount', 'f.reference_no', claim.as('claim_month'),
    sql<string>`coalesce((select sum(e.base) from acct.pp36_entry e where e.filing_id = f.id and e.company_id = f.company_id), 0)`.as('base')])
    .where('f.form', '=', 'pp36').where('f.status', '=', 'filed').where(claim, '>=', fromYm).where(claim, '<=', toYm).orderBy('f.filed_at').execute();
}

/** จุดตรวจ SWT ของภาษี (reconChecks · ต่อท้ายเมื่อเปิดโมดูล) */
export async function foreignTaxTotals(tx: CompanyTx, from: string, to: string) {
  const pp36 = Money.sum((await pp36Rows(tx, from, to)).map((r) => Money.parse(r.vat)));
  const pnd54 = await tx.selectFrom('acct.wht_certificate').select(sql<string>`coalesce(sum(amount), 0)`.as('a')).where('pnd', '=', '54').where('voided', '=', false)
    .where('pay_date', '>=', from).where('pay_date', '<=', to).executeTakeFirstOrThrow();
  return { pp36, pnd54: Money.parse(pnd54.a) };
}

/** ประเทศของผู้รับเงินต่างประเทศ (ISO 3166-1 alpha-2) สำหรับอัตราตามอนุสัญญา · ประเภทผู้ติดต่อต้องเป็น "ต่างประเทศ" */
export async function setContactCountry(db: Db, companyId: string, actorId: string | null, contactId: string, country: string | null) {
  if (country !== null && !/^[A-Z]{2}$/u.test(country)) throw new LedgerError('รหัสประเทศต้องเป็นตัวอักษรอังกฤษพิมพ์ใหญ่ 2 ตัว (ISO 3166-1)');
  return db.withCompany(companyId, async (tx) => {
    const c = await tx.selectFrom('acct.contact').select(['entity_type', 'country']).where('id', '=', contactId).executeTakeFirst();
    if (!c) throw new LedgerError('ไม่พบผู้ติดต่อ');
    if (country && c.entity_type !== 'foreign') throw new LedgerError('กำหนดประเทศได้เฉพาะผู้ติดต่อประเภทต่างประเทศ');
    await tx.updateTable('acct.contact').set({ country }).where('id', '=', contactId).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: 'contact.update', entity: 'contact', entity_id: contactId,
      before: JSON.stringify({ country: c.country }), after: JSON.stringify({ country }), prev_hash: null, hash: null }).execute();
  });
}

/** ผู้ติดต่อประเภทต่างประเทศ + ประเทศ (หน้าจอชั่วคราว P2A /tax/foreign) */
export async function foreignContacts(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.contact').select(['id', 'code', 'name', 'kind', 'tax_id', 'country']).where('entity_type', '=', 'foreign').orderBy('code').execute());
}
