// ข้อมูลหลัก + ทะเบียนเช็ค + ตั้งค่าบริษัท
// ScreenContacts.dc.html · ScreenProducts.dc.html · ScreenCheque.dc.html · ScreenSettings.dc.html
import { Money, type JournalLine, type MoneyString } from '@innovera/ledger';
import { validateTaxId, WHT_TYPES } from '@innovera/tax-th';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, postJournalTx } from './ledger-service.ts';
import { voidDocumentTx, type Actor } from './sales.ts';

// ---------- คู่ค้า (ScreenContacts) ----------

export const CONTACT_ROLES = ['customer', 'vendor', 'contractor', 'employee'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** ยอดคงค้างตามบัญชีคุม (ลูกหนี้ = Dr − Cr ของบัญชี ar · เจ้าหนี้ = Cr − Dr ของบัญชี ap) แยกตามคู่ค้า */
export async function balancesByContact(tx: CompanyTx) {
  const rows = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
    .innerJoin('acct.account as a', (jn) => jn.onRef('a.code', '=', 'l.account_code').onRef('a.company_id', '=', 'l.company_id'))
    .select(['l.contact_id', 'a.control_kind', sql<string>`sum(l.debit - l.credit)`.as('net')])
    .where('j.status', '!=', 'draft').where('a.control_kind', 'in', ['ar', 'ap']).where('l.contact_id', 'is not', null)
    .groupBy(['l.contact_id', 'a.control_kind']).execute();
  const m = new Map<string, { ar: Money; ap: Money }>();
  for (const r of rows) {
    const cur = m.get(r.contact_id!) ?? { ar: Money.zero(), ap: Money.zero() };
    const net = Money.parse(r.net);
    if (r.control_kind === 'ar') cur.ar = cur.ar.plus(net); else cur.ap = cur.ap.minus(net);
    m.set(r.contact_id!, cur);
  }
  return m;
}

export async function contactsOverview(db: Db, companyId: string, f: { q?: string; role?: ContactRole } = {}) {
  return db.withCompany(companyId, async (tx) => {
    const all = await tx.selectFrom('acct.contact').select(['id', 'code', 'name', 'roles', 'tax_id', 'branch_code', 'entity_type', 'external_source']).orderBy('code').execute();
    const bal = await balancesByContact(tx);
    const counts = { total: all.length, customer: 0, vendor: 0, contractor: 0, employee: 0 };
    for (const c of all) for (const r of c.roles) if (r in counts) counts[r as ContactRole]++;
    const q = f.q?.trim().toLowerCase();
    const rows = all.filter((c) => (!f.role || c.roles.includes(f.role)) && (!q || [c.name, c.code, c.tax_id ?? ''].some((x) => x.toLowerCase().includes(q))))
      .map((c) => {
        const b = bal.get(c.id);
        return { ...c, ar: b && b.ar.gt(Money.zero()) ? b.ar.toString() : null, ap: b && b.ap.gt(Money.zero()) ? b.ap.toString() : null };
      });
    return { counts, rows };
  });
}

export async function contactDetail(db: Db, companyId: string, id: string, today: string) {
  return db.withCompany(companyId, async (tx) => {
    const c = await tx.selectFrom('acct.contact').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) return null;
    const docs = await tx.selectFrom('acct.document').select(['id', 'doc_no', 'doc_type', 'issue_date', 'due_date', 'status', 'grand_total']).where('contact_id', '=', id).where('doc_no', 'is not', null)
      .orderBy('issue_date', 'desc').orderBy('doc_no', 'desc').execute();
    // ใบค้างรับ = IV/DN ที่ผ่านแล้ว ยอด − ที่ตัดชำระ (ไม่นับใบที่ยกเลิก) > 0
    const settled = await tx.selectFrom('acct.settlement').select(['document_id', sql<string>`sum(applied + wht)`.as('paid')]).where('voided', '=', false).groupBy('document_id').execute();
    const paid = new Map(settled.map((s) => [s.document_id, Money.parse(s.paid)]));
    const open = docs.filter((d) => ['IV', 'DN'].includes(d.doc_type) && d.status === 'posted')
      .map((d) => ({ ...d, outstanding: Money.parse(d.grand_total).minus(paid.get(d.id) ?? Money.zero()) })).filter((d) => d.outstanding.gt(Money.zero()));
    const accounts = await tx.selectFrom('acct.account').select(['code', 'name']).where('code', 'in', [c.ar_account ?? '1130100', c.ap_account ?? '2110100']).execute();
    const name = (code: string | null) => (code ? `${code} ${accounts.find((a) => a.code === code)?.name ?? ''}`.trim() : null);
    return {
      contact: { ...c, ar_account_label: name(c.ar_account), ap_account_label: name(c.ap_account) },
      addressCount: [c.address, c.ship_address].filter(Boolean).length,
      docCount: docs.length,
      lastDoc: docs[0]?.doc_no ?? null,
      openAr: { count: open.length, total: Money.sum(open.map((d) => d.outstanding)).toString(), overdue: open.filter((d) => d.due_date && d.due_date < today).length },
      docs: docs.slice(0, 50),
    };
  });
}

export interface ContactInput {
  code: string; name: string; roles: ContactRole[]; entityType?: 'juristic' | 'individual' | 'foreign';
  taxId?: string | null; branchCode?: string | null; address?: string | null; shipAddress?: string | null; contactPerson?: string | null; phone?: string | null; email?: string | null;
  creditDays?: number | null; creditLimit?: string | null; arAccount?: string | null; apAccount?: string | null; whtReceived?: string | null; pndForm?: '3' | '53' | null;
  priceLevel?: number; bankAccount?: string | null;
  /** ประเภทเงินได้ตั้งต้นของผู้ขาย (คีย์ WHT_TYPES) · ไม่ส่ง = คงค่าเดิม (หน้า ScreenContacts ไม่มีช่องนี้) */
  defaultWht?: string | null;
}

const kindOf = (roles: ContactRole[]): 'customer' | 'vendor' | 'both' | 'contractor' | 'employee' =>
  roles.includes('customer') && (roles.includes('vendor') || roles.includes('contractor')) ? 'both' : roles[0]!;

/** ตรวจ + แปลงเป็นคอลัมน์ (ใช้ร่วมกับนำเข้า Excel) · โยน LedgerError ถ้าไม่ถูกต้อง */
export function contactValues(c: ContactInput) {
  if (!c.code?.trim() || !c.name?.trim()) throw new LedgerError('ต้องระบุรหัสและชื่อคู่ค้า');
  if (!c.roles?.length || c.roles.some((r) => !CONTACT_ROLES.includes(r))) throw new LedgerError('ต้องเลือกบทบาทอย่างน้อย 1 บทบาท');
  if (c.entityType && !['juristic', 'individual', 'foreign'].includes(c.entityType)) throw new LedgerError('ประเภทบุคคลไม่ถูกต้อง');
  if (c.taxId && !/x/u.test(c.taxId) && !validateTaxId(c.taxId)) throw new LedgerError('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
  if (c.branchCode && !/^\d{5}$/u.test(c.branchCode)) throw new LedgerError('รหัสสาขาต้องเป็นตัวเลข 5 หลัก');
  if (c.creditDays !== undefined && c.creditDays !== null && (!Number.isInteger(c.creditDays) || c.creditDays < 0)) throw new LedgerError('เครดิต (วัน) ต้องเป็นจำนวนเต็มไม่ติดลบ');
  if (c.creditLimit && !/^\d+(\.\d{1,2})?$/u.test(c.creditLimit)) throw new LedgerError('วงเงินเครดิตไม่ถูกต้อง');
  if (c.priceLevel !== undefined && (c.priceLevel < 1 || c.priceLevel > 5)) throw new LedgerError('ระดับราคาต้องเป็น 1–5');
  // หลายประเภทคั่นด้วย "+" (เช่น ขนส่ง + ค่าบริการ · ScreenPurchaseBill "WHT ตั้งต้น 1% ค่าขนส่ง / 3% ค่าติดตั้ง") เหมือน wht_received
  if (c.defaultWht && c.defaultWht.split('+').some((k) => !WHT_TYPES[k.trim()])) throw new LedgerError(`ไม่รู้จักประเภทเงินได้ ${c.defaultWht}`);
  return {
    code: c.code.trim(), name: c.name.trim(), kind: kindOf(c.roles), roles: c.roles, entity_type: c.entityType ?? 'juristic',
    tax_id: c.taxId || null, branch_code: c.branchCode || null, address: c.address || null, ship_address: c.shipAddress || null, contact_person: c.contactPerson || null,
    phone: c.phone || null, email: c.email || null, credit_days: c.creditDays ?? null, credit_limit: c.creditLimit || null, ar_account: c.arAccount || null, ap_account: c.apAccount || null,
    wht_received: c.whtReceived || null, pnd_form: c.pndForm ?? null, price_level: c.priceLevel ?? 1, bank_account: c.bankAccount || null,
    ...(c.defaultWht !== undefined ? { default_wht: c.defaultWht || null } : {}),
  };
}

const contactById = (tx: CompanyTx, id: string) => tx.selectFrom('acct.contact').selectAll().where('id', '=', id).executeTakeFirst();
/** แถวในฐานข้อมูล → ContactInput (นำเข้า Excel: แก้เฉพาะช่องที่กรอก) */
export function contactInputOf(c: NonNullable<Awaited<ReturnType<typeof contactById>>>): ContactInput {
  return {
    code: c.code, name: c.name, roles: c.roles as ContactRole[], entityType: c.entity_type, taxId: c.tax_id, branchCode: c.branch_code, address: c.address, shipAddress: c.ship_address,
    contactPerson: c.contact_person, phone: c.phone, email: c.email, creditDays: c.credit_days, creditLimit: c.credit_limit, arAccount: c.ar_account, apAccount: c.ap_account,
    whtReceived: c.wht_received, pndForm: c.pnd_form, priceLevel: c.price_level, bankAccount: c.bank_account, defaultWht: c.default_wht,
  };
}

export async function saveContactTx(tx: CompanyTx, companyId: string, actorId: string | null, values: ReturnType<typeof contactValues>, id?: string, action?: string) {
  const dup = await tx.selectFrom('acct.contact').select('id').where('code', '=', values.code).executeTakeFirst();
  if (dup && dup.id !== id) throw new LedgerError(`รหัส ${values.code} มีอยู่แล้ว`);
  let before: unknown = null;
  let rowId = id;
  if (id) {
    before = await contactById(tx, id);
    if (!before) throw new LedgerError('ไม่พบคู่ค้า');
    await tx.updateTable('acct.contact').set(values).where('id', '=', id).execute();
  } else {
    rowId = (await tx.insertInto('acct.contact').values({ company_id: companyId, ...values, external_source: null, external_ref: null }).returning('id').executeTakeFirstOrThrow()).id;
  }
  await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: action ?? (id ? 'contact.update' : 'contact.create'), entity: 'contact', entity_id: rowId!,
    before: before ? JSON.stringify(before) : null, after: JSON.stringify(values), prev_hash: null, hash: null }).execute();
  return { id: rowId! };
}

export async function saveContact(db: Db, companyId: string, actorId: string | null, c: ContactInput, id?: string) {
  const values = contactValues(c);
  return db.withCompany(companyId, (tx) => saveContactTx(tx, companyId, actorId, values, id));
}

// ---------- สินค้าและบริการ (ScreenProducts) ----------

export async function productsOverview(db: Db, companyId: string, f: { kind?: 'service' | 'goods' | 'expense' | 'kit' } = {}) {
  return db.withCompany(companyId, async (tx) => {
    const all = await tx.selectFrom('acct.product').selectAll().orderBy('code').execute();
    const counts = { total: all.length, service: 0, goods: 0, expense: 0, kit: 0 };
    for (const p of all) counts[p.kind]++;
    return { counts, rows: all.filter((p) => !f.kind || p.kind === f.kind) };
  });
}

export async function productDetail(db: Db, companyId: string, code: string) {
  return db.withCompany(companyId, async (tx) => {
    const p = await tx.selectFrom('acct.product').selectAll().where('code', '=', code).executeTakeFirst();
    if (!p) return null;
    const used = await tx.selectFrom('acct.document_line').select(sql<string>`count(distinct document_id)`.as('n')).where('product_code', '=', code).executeTakeFirstOrThrow();
    const accts = await tx.selectFrom('acct.account').select(['code', 'name']).where('code', 'in', [p.revenue_account ?? '', p.expense_account ?? '']).execute();
    const label = (c: string | null) => (c ? `${c} ${accts.find((a) => a.code === c)?.name ?? ''}`.trim() : null);
    return { product: p, usedIn: Number(used.n), revenueLabel: label(p.revenue_account), expenseLabel: label(p.expense_account) };
  });
}

export interface ProductInput {
  code: string; name: string; kind: 'service' | 'goods' | 'expense' | 'kit'; unit?: string | null;
  prices?: (string | null)[]; vatCode?: 'vat7' | 'exempt' | 'zero'; defaultWht?: string | null; sku?: string | null;
  revenueAccount?: string | null; expenseAccount?: string | null;
  /** ต้นทุนประมาณต่อหน่วย · ไม่ส่ง = คงค่าเดิม (ScreenProducts ไม่มีช่องนี้) */
  estCost?: string | null;
  /** เหตุยกเว้น VAT ใต้รายการ (PrintReceiptNoVat) · ไม่ส่ง = คงค่าเดิม */
  vatExemptReason?: string | null;
}

/** ตรวจ + แปลงเป็นคอลัมน์ (ใช้ร่วมกับนำเข้า Excel) · บัญชีในผังตรวจใน saveProductTx (ต้องอ่าน DB) */
export function productValues(p: ProductInput) {
  if (!p.code?.trim() || !p.name?.trim()) throw new LedgerError('ต้องระบุรหัสและชื่อรายการ');
  if (!['service', 'goods', 'expense', 'kit'].includes(p.kind)) throw new LedgerError('ประเภทรายการไม่ถูกต้อง');
  if (p.kind === 'kit') throw new LedgerError('สินค้าชุดใช้ได้เมื่อเปิดโมดูลสต๊อก'); // ScreenProducts: "สินค้าชุด จะปรากฏเมื่อเปิดโมดูลสต๊อก" · v1 ไม่มีสต็อก
  const prices = [...(p.prices ?? []), null, null, null, null, null].slice(0, 5).map((x) => (x && x.trim() ? x.trim() : null));
  for (const x of prices) if (x && !/^\d+(\.\d{1,4})?$/u.test(x)) throw new LedgerError(`ราคา ${x} ไม่ถูกต้อง`);
  if (p.estCost && !/^\d+(\.\d{1,4})?$/u.test(p.estCost.trim())) throw new LedgerError(`ต้นทุนประมาณ ${p.estCost} ไม่ถูกต้อง`);
  const vatCode = p.vatCode ?? 'vat7';
  if (!['vat7', 'exempt', 'zero'].includes(vatCode)) throw new LedgerError('รหัสภาษีไม่ถูกต้อง');
  if (p.defaultWht && !WHT_TYPES[p.defaultWht]) throw new LedgerError(`ไม่รู้จักประเภทเงินได้ ${p.defaultWht}`);
  return {
    code: p.code.trim(),
    name: p.name.trim(), kind: p.kind, unit: p.unit || null, price: prices[0]!, price_2: prices[1]!, price_3: prices[2]!, price_4: prices[3]!, price_5: prices[4]!,
    vat_code: vatCode, vat: vatCode !== 'exempt', default_wht: p.defaultWht || null, sku: p.sku || null, revenue_account: p.revenueAccount || null, expense_account: p.expenseAccount || null,
    ...(p.estCost !== undefined ? { est_cost: p.estCost?.trim() || null } : {}),
    ...(p.vatExemptReason !== undefined ? { vat_exempt_reason: p.vatExemptReason?.trim() || null } : {}),
  };
}

export async function saveProductTx(tx: CompanyTx, companyId: string, actorId: string | null, all: ReturnType<typeof productValues>, existingCode?: string, action?: string) {
  const { code, ...values } = all;
  for (const a of [values.revenue_account, values.expense_account]) {
    if (a && !(await tx.selectFrom('acct.account').select('code').where('code', '=', a).executeTakeFirst())) throw new LedgerError(`ไม่มีบัญชี ${a} ในผังบัญชี`);
  }
  let before: unknown = null;
  if (existingCode) {
    if (existingCode !== code) throw new LedgerError('เปลี่ยนรหัสรายการไม่ได้ (เอกสารเดิมอ้างรหัสนี้)');
    before = await tx.selectFrom('acct.product').selectAll().where('code', '=', code).executeTakeFirst();
    if (!before) throw new LedgerError('ไม่พบรายการ');
    await tx.updateTable('acct.product').set(values).where('code', '=', code).execute();
  } else {
    if (await tx.selectFrom('acct.product').select('code').where('code', '=', code).executeTakeFirst()) throw new LedgerError(`รหัส ${code} มีอยู่แล้ว`);
    await tx.insertInto('acct.product').values({ company_id: companyId, code, ...values }).execute();
  }
  await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: action ?? (existingCode ? 'product.update' : 'product.create'), entity: 'product', entity_id: code,
    before: before ? JSON.stringify(before) : null, after: JSON.stringify({ code, ...values }), prev_hash: null, hash: null }).execute();
  return { code };
}

export async function saveProduct(db: Db, companyId: string, actorId: string | null, p: ProductInput, existingCode?: string) {
  const values = productValues(p);
  return db.withCompany(companyId, (tx) => saveProductTx(tx, companyId, actorId, values, existingCode));
}

// ---------- ทะเบียนบัญชีธนาคารของบริษัท (แบบพิมพ์ "โอนเข้าบัญชี [ธนาคาร A] เลขที่ … ชื่อบัญชี …") ----------
// TODO(Wei): ไม่มีแบบร่างหน้าจอแก้ทะเบียนบัญชีธนาคารของบริษัท → มีแค่ API (GET/PUT /v1/bank-accounts)

export interface BankAccountInput { glAccount: string; bankName: string; branch?: string | null; accountNo: string; accountName?: string | null; isDefaultReceive?: boolean }

export async function listBankAccounts(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.bank_account as b')
    .innerJoin('acct.account as a', (j) => j.onRef('a.code', '=', 'b.gl_account').onRef('a.company_id', '=', 'b.company_id'))
    .select(['b.id', 'b.gl_account', 'a.name as gl_name', 'b.bank_name', 'b.branch', 'b.account_no', 'b.account_name', 'b.is_default_receive'])
    .orderBy('b.is_default_receive', 'desc').orderBy('b.gl_account').execute());
}

/** เพิ่ม/แก้ตามรหัสบัญชี GL (1 บัญชี GL = 1 บัญชีธนาคาร) · บัญชีรับโอนตั้งต้นมีได้บัญชีเดียว */
export async function saveBankAccount(db: Db, companyId: string, actorId: string | null, b: BankAccountInput) {
  if (!b.glAccount || !b.bankName?.trim() || !b.accountNo?.trim()) throw new LedgerError('ต้องระบุบัญชีในผัง ชื่อธนาคาร และเลขที่บัญชี');
  return db.withCompany(companyId, async (tx) => {
    const acc = await tx.selectFrom('acct.account').select(['code', 'type']).where('code', '=', b.glAccount).executeTakeFirst();
    if (!acc || acc.type !== 'asset') throw new LedgerError(`บัญชี ${b.glAccount} ไม่ใช่บัญชีสินทรัพย์ในผังบัญชี`);
    if (b.isDefaultReceive) await tx.updateTable('acct.bank_account').set({ is_default_receive: false }).where('gl_account', '!=', b.glAccount).execute();
    const values = { bank_name: b.bankName.trim(), branch: b.branch?.trim() || null, account_no: b.accountNo.trim(), account_name: b.accountName?.trim() || null, is_default_receive: b.isDefaultReceive ?? false };
    const r = await tx.insertInto('acct.bank_account').values({ company_id: companyId, gl_account: b.glAccount, ...values })
      .onConflict((oc) => oc.columns(['company_id', 'gl_account']).doUpdateSet(values)).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: 'bank_account.save', entity: 'bank_account', entity_id: r.id,
      before: null, after: JSON.stringify({ gl_account: b.glAccount, ...values }), prev_hash: null, hash: null }).execute();
    return { id: r.id };
  });
}

// ---------- ทะเบียนเช็ค (ScreenCheque) ----------
// เช็ครับ: รับ (ใบรับชำระลง Dr 1150100) → นำฝาก Dr 1150200 / Cr 1150100 → ผ่าน Dr ธนาคาร / Cr 1150200
// คืน: ยกเลิกใบรับชำระ (ใบแจ้งหนี้กลับมาค้างรับ) + ถ้านำฝากแล้ว กลับรายการนำฝาก → สุทธิ Dr 1130100 / Cr 1150200 ตามแบบร่าง
export const CHEQUE_ON_HAND = '1150100';
export const CHEQUE_DEPOSITED = '1150200';

type ChequeRow = Awaited<ReturnType<typeof chequeRows>>[number];
async function chequeRows(tx: CompanyTx, direction: 'received' | 'issued') {
  return tx.selectFrom('acct.cheque as c').leftJoin('acct.document as d', (j) => j.onRef('d.id', '=', 'c.document_id').onRef('d.company_id', '=', 'c.company_id'))
    .leftJoin('acct.contact as k', (j) => j.onRef('k.id', '=', 'c.contact_id').onRef('k.company_id', '=', 'c.company_id'))
    .select(['c.id', 'c.cheque_no', 'c.bank', 'c.branch', 'c.cheque_date', 'c.amount', 'c.status', 'c.deposited_on', 'c.cleared_on', 'c.bounced_on', 'c.bounce_reason',
      'c.document_id', 'd.doc_no', 'd.issue_date as received_on', 'c.ref_no', 'k.name as contact_name', 'c.payer_name', 'c.created_at'])
    .where('c.direction', '=', direction).where('c.status', '!=', 'cancelled').orderBy('c.cheque_date', 'desc').execute();
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** วันทำการระหว่าง 2 วัน (ไม่นับเสาร์–อาทิตย์ · TODO(Wei): วันหยุดธนาคาร) */
function businessDaysBetween(from: string, to: string) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export async function chequeRegister(db: Db, companyId: string, direction: 'received' | 'issued', today: string) {
  return db.withCompany(companyId, async (tx) => {
    const rows = await chequeRows(tx, direction);
    const sum = (xs: ChequeRow[]) => ({ total: Money.sum(xs.map((x) => Money.parse(x.amount))).toString(), count: xs.length });
    const onHand = rows.filter((r) => r.status === 'on_hand');
    const since90 = addDays(today, -90);
    const summary = {
      onHand: { ...sum(onHand), postdated: onHand.filter((r) => r.cheque_date > today).length },
      deposited: sum(rows.filter((r) => r.status === 'deposited')),
      dueToday: sum(onHand.filter((r) => r.cheque_date === today)),
      dueTodayReceivedToday: onHand.filter((r) => r.cheque_date === today && r.received_on === today).length,
      bounced90: sum(rows.filter((r) => r.status === 'bounced' && (r.bounced_on ?? r.cheque_date) >= since90)),
      issuedOutstanding: sum(rows.filter((r) => r.status === 'issued' || r.status === 'presented')),
    };
    return {
      today, summary,
      rows: rows.map((r) => ({
        ...r, ref: r.doc_no ?? r.ref_no, payer: r.contact_name ?? r.payer_name,
        postdated: r.status === 'on_hand' && r.cheque_date > today, dueToday: r.status === 'on_hand' && r.cheque_date <= today,
        // fixtures: นำฝาก 25/11 ณ 30/11 (ผ่านไป 3 วันทำการ) = "รอผ่านเกิน 3 วันทำการ" → ครบ 3 วันทำการแล้วยังไม่ผ่าน = เกินกำหนด · TODO(Wei): ยืนยันเกณฑ์
        overdueClearing: r.status === 'deposited' && r.deposited_on ? businessDaysBetween(r.deposited_on, today) >= 3 : false,
      })),
    };
  });
}

async function chequeOrThrow(tx: CompanyTx, id: string) {
  const c = await tx.selectFrom('acct.cheque').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw new LedgerError('ไม่พบเช็ค');
  return c;
}

/** นำฝาก (เลือกหลายฉบับ = 1 journal) · เช็คลงวันที่ล่วงหน้านำฝากก่อนวันที่บนเช็คไม่ได้ */
export async function depositCheques(db: Db, companyId: string, actor: Actor, ids: string[], date: string) {
  if (!ids.length) throw new LedgerError('เลือกเช็คที่จะนำฝาก');
  return db.withCompany(companyId, async (tx) => {
    const cs = await Promise.all(ids.map((id) => chequeOrThrow(tx, id)));
    for (const c of cs) {
      if (c.direction !== 'received' || c.status !== 'on_hand') throw new LedgerError(`เช็ค ${c.cheque_no} ไม่ได้อยู่ในมือ`);
      if (c.cheque_date > date) throw new LedgerError(`เช็ค ${c.cheque_no} ลงวันที่ล่วงหน้า นำฝากได้ตั้งแต่ ${c.cheque_date}`);
    }
    const total = Money.sum(cs.map((c) => Money.parse(c.amount)));
    const lines: JournalLine[] = [{ side: 'Dr', account: CHEQUE_DEPOSITED, amount: total }, { side: 'Cr', account: CHEQUE_ON_HAND, amount: total }];
    const j = await postJournalTx(tx, companyId, { date, lines, role: actor.role, book: 'GJ', description: `นำฝากเช็ค ${cs.map((c) => c.cheque_no).join(', ')}` });
    for (const c of cs) await tx.updateTable('acct.cheque').set({ status: 'deposited', deposited_on: date, journal_ids: [...c.journal_ids, j.id] }).where('id', '=', c.id).execute();
    return { journalNo: j.journalNo, total: total.toString() };
  });
}

/** เช็คผ่าน: Dr บัญชีธนาคารที่นำฝาก / Cr 1150200 */
export async function clearCheque(db: Db, companyId: string, actor: Actor, id: string, p: { date: string; bankAccount: string }) {
  return db.withCompany(companyId, async (tx) => {
    const c = await chequeOrThrow(tx, id);
    if (c.direction === 'received') {
      if (c.status !== 'deposited') throw new LedgerError(`เช็ค ${c.cheque_no} ยังไม่ได้นำฝาก`);
      const bank = await tx.selectFrom('acct.account').select('code').where('code', '=', p.bankAccount).where('code', 'like', '11%').executeTakeFirst();
      if (!bank) throw new LedgerError('เลือกบัญชีเงินฝากธนาคาร');
      const amt = Money.parse(c.amount);
      const j = await postJournalTx(tx, companyId, { date: p.date, lines: [{ side: 'Dr', account: p.bankAccount, amount: amt }, { side: 'Cr', account: CHEQUE_DEPOSITED, amount: amt }],
        role: actor.role, book: 'GJ', description: `เช็ค ${c.cheque_no} ผ่าน` });
      await tx.updateTable('acct.cheque').set({ status: 'cleared', cleared_on: p.date, journal_ids: [...c.journal_ids, j.id] }).where('id', '=', id).execute();
      return { journalNo: j.journalNo };
    }
    // เช็คจ่าย: ใบสำคัญจ่ายลงเครดิตธนาคารแล้วตอนจ่าย (purchase.ts) — บันทึกผ่านเป็นสถานะสำหรับกระทบยอด ไม่ลงบัญชีซ้ำ
    if (c.status !== 'issued' && c.status !== 'presented') throw new LedgerError(`เช็ค ${c.cheque_no} สถานะ ${c.status}`);
    await tx.updateTable('acct.cheque').set({ status: 'cleared', cleared_on: p.date }).where('id', '=', id).execute();
    return { journalNo: null };
  });
}

/**
 * เช็คคืน: ยกเลิกใบรับชำระ (ลูกหนี้ ภาษีขาย ภาษีถูกหัก กลับเหมือนยังไม่ได้รับ) + ถ้านำฝากแล้ว กลับรายการนำฝาก
 * TODO(ผู้สอบบัญชี): จุดภาษีบริการเมื่อเช็คคืน — ระบบกลับภาษีขายเป็น "ยังไม่ถึงกำหนด" ตามการยกเลิกใบรับชำระ
 */
export async function bounceCheque(db: Db, companyId: string, actor: Actor, id: string, p: { date: string; reason: string }) {
  if (!p.reason.trim()) throw new LedgerError('ระบุเหตุผลที่เช็คคืน');
  return db.withCompany(companyId, async (tx) => {
    const c = await chequeOrThrow(tx, id);
    if (c.direction !== 'received' || !['on_hand', 'deposited'].includes(c.status)) throw new LedgerError(`เช็ค ${c.cheque_no} สถานะ ${c.status} บันทึกคืนไม่ได้`);
    const journals = [...c.journal_ids];
    if (c.document_id) {
      const others = await tx.selectFrom('acct.cheque').select('id').where('document_id', '=', c.document_id).where('id', '!=', id).where('status', '!=', 'cancelled').execute();
      if (others.length) throw new LedgerError('ใบรับชำระนี้มีเช็คหลายฉบับ — ยกเลิกใบรับชำระแล้วออกใหม่'); // TODO(Wei): เช็คคืนบางฉบับของใบรับชำระที่มีหลายเช็ค
      await voidDocumentTx(tx, companyId, actor, c.document_id, { reason: `เช็คคืน ${c.cheque_no}: ${p.reason}`, date: p.date });
    }
    if (c.status === 'deposited') {
      const amt = Money.parse(c.amount);
      const j = await postJournalTx(tx, companyId, { date: p.date, lines: [{ side: 'Dr', account: CHEQUE_ON_HAND, amount: amt }, { side: 'Cr', account: CHEQUE_DEPOSITED, amount: amt }],
        role: actor.role, book: 'GJ', description: `เช็ค ${c.cheque_no} คืน — กลับรายการนำฝาก` });
      journals.push(j.id);
    }
    await tx.updateTable('acct.cheque').set({ status: 'bounced', bounced_on: p.date, bounce_reason: p.reason.trim(), journal_ids: journals }).where('id', '=', id).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actor.userId, action: 'cheque.bounced', entity: 'cheque', entity_id: id,
      before: JSON.stringify({ status: c.status }), after: JSON.stringify({ status: 'bounced', reason: p.reason }), prev_hash: null, hash: null }).execute();
    return { ok: true };
  });
}

/** เช็คจากระบบเดิม (ยกมา/นำเข้า) — ไม่ผูกใบรับชำระในระบบ · ใช้ใน dev seed ตาม fixtures cheques_received */
export async function importCheque(db: Db, companyId: string, c: { direction: 'received' | 'issued'; chequeNo: string; bank: string; chequeDate: string; amount: MoneyString;
  status: 'on_hand' | 'deposited' | 'cleared' | 'bounced'; contactId?: string | null; payerName?: string | null; refNo?: string | null;
  depositedOn?: string | null; clearedOn?: string | null; bouncedOn?: string | null; bounceReason?: string | null }) {
  await db.withCompany(companyId, (tx) => tx.insertInto('acct.cheque').values({ company_id: companyId, direction: c.direction, cheque_no: c.chequeNo, bank: c.bank, branch: null,
    cheque_date: c.chequeDate, amount: c.amount, status: c.status, document_id: null, contact_id: c.contactId ?? null, payer_name: c.payerName ?? null, ref_no: c.refNo ?? null,
    deposited_on: c.depositedOn ?? null, cleared_on: c.clearedOn ?? null, bounced_on: c.bouncedOn ?? null, bounce_reason: c.bounceReason ?? null }).execute());
}

// ---------- ตั้งค่าบริษัท (ScreenSettings) ----------

export interface CompanyDefaults {
  saleCreditDays: number; purchaseCreditDays: number; priceDefault: 'exclude_vat' | 'include_vat'; rounding: 'last_line' | 'per_line';
  printFont: 'Sarabun' | 'IBM Plex Sans Thai'; etax: boolean; allowFuturePosting: boolean; requireBillAttachment: boolean; enforce2fa: boolean;
}
const DEFAULTS: CompanyDefaults = { saleCreditDays: 30, purchaseCreditDays: 30, priceDefault: 'exclude_vat', rounding: 'last_line', printFont: 'Sarabun',
  etax: false, allowFuturePosting: true, requireBillAttachment: false, enforce2fa: false };

export async function companySettings(db: Db, companyId: string) {
  const company = await db.withPublic((tx) => tx.selectFrom('public.company').select(['id', 'name_th', 'name_en', 'tax_id', 'branch_code', 'address', 'phone', 'email', 'business_type',
    'vat_registered', 'service_tax_point', 'db_dsn', 'org_id']).where('id', '=', companyId).executeTakeFirstOrThrow());
  const plan = await db.withPublic((tx) => tx.selectFrom('public.subscription as s').innerJoin('public.plan as p', 'p.code', 's.plan_code')
    .select(['p.name', 's.renews_at']).where('s.org_id', '=', company.org_id).executeTakeFirst()).catch(() => undefined);
  const saved = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.company_setting').select('value').where('key', '=', 'company.defaults').executeTakeFirst());
  return { company, plan: plan ?? null, defaults: { ...DEFAULTS, ...((saved?.value as Partial<CompanyDefaults> | undefined) ?? {}) } };
}

export interface CompanySettingsInput {
  nameTh: string; nameEn?: string | null; taxId?: string | null; branchCode: string; address?: string | null; phone?: string | null; email?: string | null;
  businessType: 'service' | 'trading' | 'manufacturing' | 'mixed'; vatRegistered: boolean; serviceTaxPoint: 'on_payment' | 'on_invoice'; defaults: CompanyDefaults;
}

export async function saveCompanySettings(db: Db, companyId: string, actorId: string | null, s: CompanySettingsInput) {
  if (!s.nameTh.trim()) throw new LedgerError('ต้องระบุชื่อนิติบุคคล (ไทย)');
  if (s.taxId && !/x/u.test(s.taxId) && !validateTaxId(s.taxId)) throw new LedgerError('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
  if (!/^\d{5}$/u.test(s.branchCode)) throw new LedgerError('รหัสสาขาต้องเป็นตัวเลข 5 หลัก');
  // จุดภาษีบริการ "เมื่อออกใบกำกับ": Posting Engine v1 รองรับเฉพาะ ม.78/1 เมื่อรับชำระ (CLAUDE.md กติกาที่ล็อกแล้ว)
  if (s.serviceTaxPoint !== 'on_payment') throw new LedgerError('จุดภาษี "เมื่อออกใบกำกับ" ยังไม่รองรับ — TODO(Wei)');
  for (const n of [s.defaults.saleCreditDays, s.defaults.purchaseCreditDays]) if (!Number.isInteger(n) || n < 0 || n > 365) throw new LedgerError('เครดิตเทอมต้องเป็น 0–365 วัน');
  if (s.defaults.rounding !== 'last_line') throw new LedgerError('การปัดรายบรรทัดยังไม่รองรับ — TODO(Wei)'); // CLAUDE.md: ปัดเศษที่บรรทัดสุดท้าย
  const before = await companySettings(db, companyId);
  await db.withPublic((tx) => tx.updateTable('public.company').set({ name_th: s.nameTh.trim(), name_en: s.nameEn || null, tax_id: s.taxId || null, branch_code: s.branchCode,
    address: s.address || null, phone: s.phone || null, email: s.email || null, business_type: s.businessType, vat_registered: s.vatRegistered, service_tax_point: s.serviceTaxPoint }).where('id', '=', companyId).execute());
  const defaults: CompanyDefaults = { ...DEFAULTS, ...s.defaults };
  await db.withCompany(companyId, async (tx) => {
    await tx.insertInto('acct.company_setting').values({ company_id: companyId, key: 'company.defaults', value: JSON.stringify(defaults), updated_at: new Date() })
      .onConflict((oc) => oc.columns(['company_id', 'key']).doUpdateSet({ value: JSON.stringify(defaults), updated_at: new Date() })).execute();
    await tx.insertInto('acct.audit_log').values({ company_id: companyId, actor_id: actorId, action: 'company.settings', entity: 'company', entity_id: companyId,
      before: JSON.stringify(before), after: JSON.stringify(s), prev_hash: null, hash: null }).execute();
  });
  return companySettings(db, companyId);
}

// ---------- Sidebar (Sidebar.dc.html): ป้ายงานค้าง + ผู้ใช้ ----------

export interface SidebarBadgeRow { count: number; tone: 'act' | 'warn'; hint: string }
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * ป้ายของ Sidebar ตามแบบร่าง: น้ำเงิน (act) = ต้องทำ · เหลือง (warn) = ใกล้กำหนด
 * home = เอกสารรออนุมัติทั้งหมด · invoice = IV รออนุมัติ · purchase = บิลซื้อรอตรวจ · cheque = เช็คถึงกำหนดนำฝาก
 * bank = statement ยังไม่จับคู่ · tax = แบบที่ต้องยื่นของเดือนนี้ (ภ.ง.ด. ถ้ามี 50 ทวิ · ภ.พ.30 ถ้าจด VAT)
 * TODO(backend): apps "รอแม็ปคู่ค้า" — ยังไม่มีสถานะคู่ค้ารอแม็ปจาก TMS
 */
export async function sidebarBadges(db: Db, companyId: string, today: string): Promise<Record<string, SidebarBadgeRow>> {
  const vatRegistered = (await db.withPublic((tx) => tx.selectFrom('public.company').select('vat_registered').where('id', '=', companyId).executeTakeFirst()))?.vat_registered ?? true;
  return db.withCompany(companyId, async (tx) => {
    const pending = await tx.selectFrom('acct.document').select(['doc_type', sql<string>`count(*)`.as('n')]).where('status', '=', 'pending_approval').groupBy('doc_type').execute();
    const n = (t?: string) => pending.filter((p) => !t || p.doc_type === t).reduce((s, p) => s + Number(p.n), 0);
    const cheques = Number((await tx.selectFrom('acct.cheque').select(sql<string>`count(*)`.as('n')).where('direction', '=', 'received').where('status', '=', 'on_hand').where('cheque_date', '<=', today).executeTakeFirstOrThrow()).n);
    const unmatched = Number((await tx.selectFrom('acct.bank_statement_line').select(sql<string>`count(*)`.as('n')).where('match_status', '=', 'unmatched').executeTakeFirstOrThrow()).n);
    const month = today.slice(0, 7);
    const certs = Number((await tx.selectFrom('acct.wht_certificate').select(sql<string>`count(*)`.as('n')).where('voided', '=', false)
      .where('pay_date', '>=', `${month}-01`).where('pay_date', '<', addDays(`${month}-28`, 4).slice(0, 7) + '-01').executeTakeFirstOrThrow()).n);
    const ext = await tx.selectFrom('acct.company_setting').select('value').where('key', '=', 'tax.filing.online_extension').executeTakeFirst();
    const online = ext ? ext.value !== false : true; // รอผู้สอบบัญชี: ค่าตั้งต้นชั่วคราว true (CLAUDE.md)
    const m = Number(today.slice(5, 7));
    const next = TH_MONTH[m % 12]!;
    const filings = [...(certs ? [`ยื่น ภ.ง.ด. ภายใน ${online ? 15 : 7} ${next}`] : []), ...(vatRegistered ? [`ภ.พ.30 ภายใน ${online ? 23 : 15} ${next}`] : [])];
    const out: Record<string, SidebarBadgeRow> = {};
    if (n()) out['home'] = { count: n(), tone: 'act', hint: `รออนุมัติ ${n()} เอกสาร` };
    if (n('IV')) out['invoice'] = { count: n('IV'), tone: 'act', hint: 'รออนุมัติ' };
    if (n('AP')) out['purchase'] = { count: n('AP'), tone: 'act', hint: 'รอตรวจ' };
    if (cheques) out['cheque'] = { count: cheques, tone: 'warn', hint: `เช็คถึงกำหนดนำฝากวันนี้ ${today.slice(8, 10)}/${today.slice(5, 7)}` };
    if (unmatched) out['bank'] = { count: unmatched, tone: 'act', hint: 'รายการยังไม่จับคู่' };
    if (filings.length) out['tax'] = { count: filings.length, tone: 'warn', hint: `เดือน ${TH_MONTH[m - 1]} ${filings.join(' · ')}` };
    return out;
  });
}

/** ผู้ใช้ที่มุมล่างของ Sidebar: ชื่อ · บทบาทในบริษัท · แผน */
export async function sidebarUser(db: Db, companyId: string, userId: string | null) {
  return db.withPublic(async (tx) => {
    const u = userId ? await tx.selectFrom('public.app_user').select(['display_name', 'email']).where('id', '=', userId).executeTakeFirst() : undefined;
    const m = userId ? await tx.selectFrom('public.company_membership').select('company_role').where('company_id', '=', companyId).where('user_id', '=', userId).executeTakeFirst() : undefined;
    const plan = await tx.selectFrom('public.company as c').innerJoin('public.subscription as s', 's.org_id', 'c.org_id').innerJoin('public.plan as p', 'p.code', 's.plan_code')
      .select('p.name').where('c.id', '=', companyId).executeTakeFirst();
    return { name: u?.display_name ?? u?.email ?? null, role: m?.company_role ?? null, plan: plan?.name ?? null };
  });
}
