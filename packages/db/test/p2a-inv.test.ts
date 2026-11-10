// Phase 2A INV สินค้าคงคลัง บน DB จริง — ตัวเลขจาก fixtures/p2a-trading.json (ร่าง รอ Wei ยืนยัน)
// golden ถัวเฉลี่ยเคลื่อนที่ · perpetual vs periodic (Dr=Cr) · ห้ามติดลบ · ยกเลิก = กลับรายการ · คำนวณย้อนหลัง · กระทบยอด · RLS · โมดูลปิด = Phase 1
import { fromTuples, Money, toTuples, type JournalLineTuple } from '@innovera/ledger';
import { sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompany, createOrganization } from '../src/company.ts';
import type { Db } from '../src/index.ts';
import {
  enableInventory, findByBarcode, inventoryStatus, postStockDocument, reorderReport, runInventoryPeriodEnd, saveStockDraft, saveWarehouse, section87Report, setInventorySetting,
  setProductStock, stockCard, stockValuation, voidStockDocument,
} from '../src/inventory.ts';
import { approvePurchase, savePurchaseDraft } from '../src/purchase.ts';
import { reconChecks } from '../src/reports.ts';
import { approveDocument, saveSalesDraft, voidDocument, type Actor } from '../src/sales.ts';
import { seedCompany } from '../src/seed.ts';
import { appDb, freshSchema } from './helpers.ts';

interface FxLine { product: string; qty?: string; unit?: string; unit_price?: string; account?: string; counted?: string; value?: string; cogs?: string; grir?: string }
interface FxDoc { key: string; type: string; date: string; contact?: string; ref?: string; warehouse?: string; to_warehouse?: string; rule?: string; tax_mode?: 'immediate' | 'on_payment';
  receive_account?: string; lines: FxLine[]; total?: string; cogs?: string; subtotal?: string; vat?: string; grand_total?: string;
  journal?: JournalLineTuple[]; journal_perpetual?: JournalLineTuple[]; journal_periodic?: JournalLineTuple[] }
interface Fx {
  warehouses: { code: string; name: string; is_default: boolean; allow_negative: boolean }[];
  contacts: { code: string; name: string; type: 'customer' | 'vendor' }[];
  products: { code: string; name: string; unit: string; price: string; revenue_account: string; units?: { unit: string; factor: string; barcode?: string }[]; barcode?: string; reorder_point: string; max_qty: string }[];
  documents: FxDoc[];
  expected_2569_11_30: { valuation: { product: string; warehouse: string; qty: string; value: string }[]; valuation_total: string; perpetual_gl: Record<string, string>;
    periodic_gl_before_close: Record<string, string>; periodic_period_end: { cogs: string; journal: JournalLineTuple[] }; reorder: { product: string; on_hand: string; suggest: string }[];
    'stock_card_G-001_MAIN': { closing_qty: string; closing_value: string; rows: number } };
  backdated_sale: { doc: FxDoc; recost_journal: JournalLineTuple[]; valuation_after: Record<string, string> };
  void_after_backdate: { reversal_value: string; void_adjust_journal: JournalLineTuple[]; valuation_after: Record<string, string> };
}
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/p2a-trading.json', import.meta.url), 'utf8')) as Fx;
const ce = (be: string) => `${Number(be.slice(0, 4)) - 543}${be.slice(4)}`;
const sorted = (t: readonly JournalLineTuple[]) => [...toTuples(fromTuples(t))].map((x) => x.join(' ')).sort();
const mgr: Actor = { userId: null, role: 'accounting_manager' };
const NOV_END = '2026-11-30';

let db: Db;
let P = ''; // perpetual
let Q = ''; // periodic (ค่าตั้งต้น)
let R = ''; // โมดูลปิด (บริการ)
const ids: Record<string, Record<string, string>> = {};
const journals: Record<string, Record<string, string | null>> = {};

const wh = async (c: string, code: string) => (await db.withCompany(c, (tx) => tx.selectFrom('acct.warehouse').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const contact = async (c: string, code: string) => (await db.withCompany(c, (tx) => tx.selectFrom('acct.contact').select('id').where('code', '=', code).executeTakeFirstOrThrow())).id;
const journalTuples = async (c: string, journalNo: string) => db.withCompany(c, async (tx) => {
  const j = await tx.selectFrom('acct.journal').select('id').where('journal_no', '=', journalNo).executeTakeFirstOrThrow();
  const lines = await tx.selectFrom('acct.journal_line').select(['account_code', 'debit', 'credit']).where('journal_id', '=', j.id).orderBy('line_no').execute();
  return lines.map((l) => (Number(l.debit) > 0 ? ['Dr', l.account_code, l.debit] : ['Cr', l.account_code, l.credit]) as JournalLineTuple);
});
const glBalances = async (c: string, accounts: string[]) => db.withCompany(c, async (tx) => {
  const out: Record<string, string> = {};
  for (const a of accounts) {
    const r = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select(sql<string>`coalesce(sum(l.debit - l.credit), 0)`.as('b')).where('j.status', '<>', 'draft').where('l.account_code', '=', a).executeTakeFirstOrThrow();
    out[a] = Money.parse(r.b).toString();
  }
  return out;
});
/** ทุก journal ของบริษัทดุล (DB ตรวจตอน commit อยู่แล้ว — ตรวจซ้ำจากข้อมูลจริง) · คืนจำนวน journal ที่ไม่ดุล */
const allBalanced = async (c: string) => db.withCompany(c, async (tx) => {
  const bad = await tx.selectFrom('acct.journal_line').select('journal_id').groupBy('journal_id').having(sql<boolean>`sum(debit) <> sum(credit)`).execute();
  const n = await tx.selectFrom('acct.journal').select('id').execute();
  expect(n.length).toBeGreaterThan(0);
  return String(bad.length);
});

async function setupCompany(c: string) {
  await seedCompany(db, c, 2569, { sample: false, template: 'trading' });
  await enableInventory(db, c);
  for (const w of fx.warehouses.filter((x) => !x.is_default)) await saveWarehouse(db, c, { code: w.code, name: w.name, allowNegative: w.allow_negative });
  await db.withCompany(c, async (tx) => {
    for (const k of fx.contacts) {
      await tx.insertInto('acct.contact').values({ company_id: c, code: k.code, name: k.name, kind: k.type, tax_id: null, branch_code: null, external_source: null, external_ref: null,
        address: null, contact_person: null, phone: null, email: null, credit_days: null, credit_limit: null }).execute();
    }
    for (const p of fx.products) {
      await tx.insertInto('acct.product').values({ company_id: c, code: p.code, name: p.name, unit: p.unit, kind: 'goods', price: p.price, price_2: null, vat: true, revenue_account: p.revenue_account, expense_account: null }).execute();
    }
  });
  for (const p of fx.products) {
    await setProductStock(db, c, p.code, { trackStock: true, reorderPoint: p.reorder_point, maxQty: p.max_qty, barcode: p.barcode ?? null, units: (p.units ?? []).map((u) => ({ unit: u.unit, factor: u.factor, barcode: u.barcode ?? null })) });
  }
}

async function runDoc(c: string, d: FxDoc): Promise<{ id: string; journalNo: string | null }> {
  const map = ids[c]!;
  const warehouseId = d.warehouse ? await wh(c, d.warehouse) : null;
  if (d.type === 'PO' || d.type === 'AP') {
    const id = await savePurchaseDraft(db, c, mgr, { docType: d.type, contactId: await contact(c, d.contact!), issueDate: ce(d.date), refDocumentId: d.ref ? map[d.ref]! : null, warehouseId,
      lines: d.lines.map((l) => ({ productCode: l.product, description: l.product, qty: l.qty!, unitPrice: l.unit_price!, unit: l.unit ?? null, vat: true, accountCode: l.account ?? null })) });
    const r = await approvePurchase(db, c, mgr, id);
    return { id, journalNo: 'journalNo' in r ? (r.journalNo ?? null) : null };
  }
  if (d.type === 'IV') {
    const id = await saveSalesDraft(db, c, mgr, { docType: 'IV', contactId: await contact(c, d.contact!), issueDate: ce(d.date), ruleCode: d.rule!, taxMode: d.tax_mode!, receiveAccount: d.receive_account ?? null, warehouseId,
      lines: d.lines.map((l) => ({ productCode: l.product, description: l.product, qty: l.qty!, unitPrice: l.unit_price!, vat: true })) });
    const r = await approveDocument(db, c, mgr, id);
    return { id, journalNo: r.journalNo ?? null };
  }
  const id = await saveStockDraft(db, c, mgr, { docType: d.type as 'GR' | 'GI' | 'TRF' | 'ADJ', issueDate: ce(d.date), warehouseId, toWarehouseId: d.to_warehouse ? await wh(c, d.to_warehouse) : null,
    contactId: d.contact ? await contact(c, d.contact) : null, refDocumentId: d.ref ? map[d.ref]! : null,
    lines: d.lines.map((l) => ({ productCode: l.product, ...(l.counted !== undefined ? { countedQty: l.counted } : { qty: l.qty! }), unit: l.unit ?? null, accountCode: l.account ?? null })) });
  const r = await postStockDocument(db, c, mgr, id);
  return { id, journalNo: r.journalNo };
}

async function runScenario(c: string) {
  ids[c] = {};
  journals[c] = {};
  for (const d of fx.documents) {
    const r = await runDoc(c, d);
    ids[c]![d.key] = r.id;
    journals[c]![d.key] = r.journalNo;
  }
}

beforeAll(async () => {
  await freshSchema();
  db = appDb();
  const org = await createOrganization(db, 'Innovera Group');
  P = await createCompany(db, { orgId: org, nameTh: 'บริษัท ซื้อมาขายไป perpetual (ทดสอบ)' });
  Q = await createCompany(db, { orgId: org, nameTh: 'บริษัท ซื้อมาขายไป periodic (ทดสอบ)' });
  R = await createCompany(db, { orgId: org, nameTh: 'บริษัท บริการ โมดูลปิด (ทดสอบ)' });
  await setupCompany(P);
  await setInventorySetting(db, P, 'inventory.method', 'perpetual');
  await setupCompany(Q);
  await runScenario(P);
  await runScenario(Q);
  await seedCompany(db, R);
}, 240_000);
afterAll(() => db.close());

describe('ค่าตั้ง [ผู้สอบบัญชี] · เปิดโมดูล', () => {
  it('ค่าตั้งต้นชั่วคราว: periodic · avco · ไม่ตีราคา NRV · ป้ายรอยืนยัน', async () => {
    expect((await inventoryStatus(db, Q)).settings).toEqual({ method: 'periodic', costing: 'avco', writedownNrv: false, pendingAuditor: true });
    expect((await inventoryStatus(db, P)).settings.method).toBe('perpetual');
    expect((await inventoryStatus(db, R)).enabled).toBe(false);
  });
  it('FIFO = Phase 3 ปฏิเสธ · NRV ยังไม่เปิด · เปลี่ยนวิธีหลังมีความเคลื่อนไหวไม่ได้', async () => {
    await expect(setInventorySetting(db, Q, 'inventory.costing', 'fifo')).rejects.toThrow(/FIFO/u);
    await expect(setInventorySetting(db, Q, 'inventory.writedown_nrv', true)).rejects.toThrow(/ผู้สอบบัญชี/u);
    await expect(setInventorySetting(db, Q, 'inventory.method', 'perpetual')).rejects.toThrow(/ก่อนมีความเคลื่อนไหว/u);
  });
  it('บัญชีของโมดูลถูกสร้าง และไม่ทับชื่อที่ผู้ใช้แก้', async () => {
    await db.withCompany(Q, (tx) => tx.updateTable('acct.account').set({ name: 'สินค้าสำเร็จรูป (แก้เอง)' }).where('code', '=', '1200100').execute());
    await enableInventory(db, Q);
    const rows = await db.withCompany(Q, (tx) => tx.selectFrom('acct.account').select(['code', 'name']).where('code', 'in', ['1200100', '2130100', '5020100', '5020900']).orderBy('code').execute());
    expect(rows).toEqual([{ code: '1200100', name: 'สินค้าสำเร็จรูป (แก้เอง)' }, { code: '2130100', name: 'สินค้ารับแล้วรอใบแจ้งหนี้' }, { code: '5020100', name: 'ต้นทุนขาย' }, { code: '5020900', name: 'ผลต่างจากการตรวจนับ' }]);
  });
  it('บาร์โค้ดของหน่วยเพิ่มเติม → สินค้า + หน่วย + ตัวคูณ', async () => {
    expect(await findByBarcode(db, P, '8850000000028')).toEqual({ productCode: 'G-001', name: 'เมาส์ไร้สาย', unit: 'กล่อง', factor: '10.0000' });
  });
});

describe('golden ถัวเฉลี่ยเคลื่อนที่ (fixtures p2a-trading)', () => {
  it('มูลค่าที่รับ/ตัดต่อบรรทัดตาม fixtures (GR หลายครั้งต่อ PO · หน่วยกล่อง · โอนคลัง · เบิก · ตรวจนับ)', async () => {
    for (const c of [P, Q]) {
      for (const d of fx.documents.filter((x) => ['GR', 'GI', 'TRF', 'ADJ'].includes(x.type))) {
        const moves = await db.withCompany(c, (tx) => tx.selectFrom('acct.stock_move').select(['product_code', 'value', 'kind']).where('document_id', '=', ids[c]![d.key]!).where('kind', '<>', 'transfer_in').orderBy('seq').execute());
        expect(moves.map((m) => [m.product_code, m.value.replace('-', '')]), d.key).toEqual(d.lines.map((l) => [l.product, l.value!.replace('-', '')]));
      }
      for (const d of fx.documents.filter((x) => x.type === 'IV')) {
        const moves = await db.withCompany(c, (tx) => tx.selectFrom('acct.stock_move').select(['product_code', 'value']).where('document_id', '=', ids[c]![d.key]!).orderBy('seq').execute());
        expect(moves.map((m) => [m.product_code, m.value]), d.key).toEqual(d.lines.map((l) => [l.product, `-${l.cogs!}`]));
      }
    }
  });
  it('มูลค่าคงเหลือ ณ 30 พ.ย. ตรงกันทั้ง perpetual และ periodic', async () => {
    const e = fx.expected_2569_11_30;
    for (const c of [P, Q]) {
      const v = await stockValuation(db, c, NOV_END);
      expect(v.rows.map((r) => ({ product: r.productCode, warehouse: r.warehouseCode, qty: r.qty, value: r.value }))).toEqual(e.valuation);
      expect(v.total).toBe(e.valuation_total);
      const bal = await db.withCompany(c, (tx) => tx.selectFrom('acct.stock_balance as b').innerJoin('acct.warehouse as w', (j) => j.onRef('w.id', '=', 'b.warehouse_id').onRef('w.company_id', '=', 'b.company_id'))
        .select(['b.product_code', 'w.code', 'b.qty', 'b.value']).orderBy('b.product_code').orderBy('w.code').execute());
      expect(bal.map((b) => ({ product: b.product_code, warehouse: b.code, qty: b.qty, value: b.value }))).toEqual(e.valuation);
    }
  });
  it('บิลซื้ออ้าง GR ล้าง GR/IR ตามมูลค่าที่รับ · ผลต่างราคาเข้าสินค้า', async () => {
    const ap = fx.documents.find((d) => d.key === 'AP-C')!;
    const lines = await db.withCompany(P, (tx) => tx.selectFrom('acct.document_line').select(['product_code', 'grir_amount']).where('document_id', '=', ids[P]!['AP-C']!).orderBy('line_no').execute());
    expect(lines.map((l) => [l.product_code, l.grir_amount])).toEqual(ap.lines.map((l) => [l.product, l.grir!]));
  });
  it('สต็อกการ์ด G-001 คลัง MAIN: ยกมา 0 · 6 รายการ · คงเหลือตาม fixtures', async () => {
    const e = fx.expected_2569_11_30['stock_card_G-001_MAIN'];
    const card = await stockCard(db, Q, { productCode: 'G-001', warehouseId: await wh(Q, 'MAIN'), from: '2026-11-01', to: NOV_END });
    expect(card.opening).toEqual({ qty: '0.0000', value: '0.00' });
    expect(card.rows).toHaveLength(e.rows);
    expect(card.closing).toEqual({ qty: e.closing_qty, value: e.closing_value });
  });
  it('ถึงจุดสั่งซื้อ: G-002 · G-003 แนะนำสั่งถึงจุดสูงสุด', async () => {
    const r = await reorderReport(db, Q);
    expect(r.map((x) => ({ product: x.productCode, on_hand: x.onHand, suggest: x.suggestQty }))).toEqual(fx.expected_2569_11_30.reorder.map(({ product, on_hand, suggest }) => ({ product, on_hand, suggest })));
  });
  it('รายงาน ม.87(3) (โครง): จำนวนรับ/จ่าย/คงเหลือ ต่อสินค้า · ป้ายรอแบบทางการ', async () => {
    const r = await section87Report(db, Q, '2026-11');
    expect(r.pendingOfficialFormat).toBe(true);
    expect(r.products.map((p) => [p.code, p.closingQty])).toEqual([['G-001', '241.0000'], ['G-002', '35.0000'], ['G-003', '52.0000']]);
  });
});

describe('perpetual vs periodic — JV ดุลทุกใบ', () => {
  it('perpetual: JV ของเอกสารตาม fixtures (รวมต้นทุนขายในใบขาย)', async () => {
    for (const d of fx.documents) {
      const expected = d.journal_perpetual ?? d.journal;
      if (!expected) continue;
      if (!expected.length) { expect(journals[P]![d.key], d.key).toBeNull(); continue; }
      expect(sorted(await journalTuples(P, journals[P]![d.key]!)), d.key).toEqual(sorted(expected));
    }
    expect(await glBalances(P, Object.keys(fx.expected_2569_11_30.perpetual_gl))).toEqual(fx.expected_2569_11_30.perpetual_gl);
    expect(await allBalanced(P)).toBe('0');
  });
  it('periodic: ไม่ลงต้นทุนต่อรายการ (ใบขายไม่มีต้นทุน · เบิก/ตรวจนับ/โอนไม่มี JV) · GR/บิลซื้อเหมือนกัน', async () => {
    for (const d of fx.documents) {
      if (['GI', 'ADJ', 'TRF'].includes(d.type)) { expect(journals[Q]![d.key], d.key).toBeNull(); continue; }
      const expected = d.journal_periodic ?? d.journal;
      if (expected) expect(sorted(await journalTuples(Q, journals[Q]![d.key]!)), d.key).toEqual(sorted(expected));
    }
    expect(await glBalances(Q, Object.keys(fx.expected_2569_11_30.periodic_gl_before_close))).toEqual(fx.expected_2569_11_30.periodic_gl_before_close);
  });
  it('periodic: กระทบยอดสต็อกเป็นข้อมูลประกอบก่อนปิดงวด → ปรับสินค้าปลายงวด 1 ครั้ง → GL = มูลค่าคงเหลือ', async () => {
    const before = (await reconChecks(db, Q, '2026-11')).checks.find((c) => c.key === 'inventory_control')!;
    expect(before).toMatchObject({ ok: true, byDocs: fx.expected_2569_11_30.valuation_total, byGl: fx.expected_2569_11_30.periodic_gl_before_close['1200100'] });
    const r = await runInventoryPeriodEnd(db, Q, mgr, { fiscalYear: 2569, periodNo: 11 });
    expect(r.cogs).toBe(fx.expected_2569_11_30.periodic_period_end.cogs);
    expect(sorted(await journalTuples(Q, r.journalNo!))).toEqual(sorted(fx.expected_2569_11_30.periodic_period_end.journal));
    await expect(runInventoryPeriodEnd(db, Q, mgr, { fiscalYear: 2569, periodNo: 11 })).rejects.toThrow(/งวดนี้แล้ว/u);
    const after = await reconChecks(db, Q, '2026-11');
    expect(after.checks.find((c) => c.key === 'inventory_control')).toMatchObject({ byDocs: fx.expected_2569_11_30.valuation_total, byGl: fx.expected_2569_11_30.valuation_total, diff: '0.00' });
    expect(after.checks.find((c) => c.key === 'doc_orphans')).toMatchObject({ ok: true, count: '0 / 0' });
    expect(after.checks.find((c) => c.key === 'doc_ap_exp')).toMatchObject({ ok: true });
    expect(await allBalanced(Q)).toBe('0');
    await expect(runInventoryPeriodEnd(db, P, mgr, { fiscalYear: 2569, periodNo: 11 })).rejects.toThrow(/periodic/u);
  });
  it('perpetual: จุดตรวจ inventory_control ต่อท้าย 16 จุดเดิม · มูลค่าคงเหลือ = GL 1200100', async () => {
    const r = await reconChecks(db, P, '2026-11');
    expect(r.checks).toHaveLength(17);
    expect(r.checks.at(-1)).toMatchObject({ key: 'inventory_control', section: 3, ok: true, byDocs: fx.expected_2569_11_30.valuation_total, byGl: fx.expected_2569_11_30.valuation_total });
    // ar_control: แก้แล้ว — อายุลูกหนี้ไม่นับใบขายสด Cash[IV] เป็นยอดค้าง (2026-11-10)
    for (const k of ['doc_iv', 'doc_ap_exp', 'doc_orphans', 'vat_output', 'vat_input', 'ar_control', 'ap_control']) expect(r.checks.find((c) => c.key === k), k).toMatchObject({ ok: true });
  });
});

describe('ห้ามติดลบ', () => {
  it('ขาย G-002 จากคลัง SHOP (คงเหลือ 0) → ปฏิเสธ ทั้งเอกสารไม่ผ่านรายการ', async () => {
    const id = await saveSalesDraft(db, P, mgr, { docType: 'IV', contactId: await contact(P, 'C-001'), issueDate: '2026-11-29', ruleCode: 'Credit[IV]', taxMode: 'immediate', warehouseId: await wh(P, 'SHOP'),
      lines: [{ productCode: 'G-002', description: 'G-002', qty: '1', unitPrice: '600.00', vat: true }] });
    await expect(approveDocument(db, P, mgr, id)).rejects.toThrow(/คงเหลือไม่พอ/u);
    const d = await db.withCompany(P, (tx) => tx.selectFrom('acct.document').select(['status', 'journal_id']).where('id', '=', id).executeTakeFirstOrThrow());
    expect(d).toEqual({ status: 'draft', journal_id: null });
    expect(await db.withCompany(P, (tx) => tx.selectFrom('acct.stock_move').select('id').where('document_id', '=', id).execute())).toEqual([]);
  });
  it('เบิกเกินคงเหลือ → ปฏิเสธ · โอนไปคลังเดียวกันไม่ได้', async () => {
    const gi = await saveStockDraft(db, P, mgr, { docType: 'GI', issueDate: '2026-11-29', lines: [{ productCode: 'G-003', qty: '53' }] });
    await expect(postStockDocument(db, P, mgr, gi)).rejects.toThrow(/คงเหลือไม่พอ/u);
    const main = await wh(P, 'MAIN');
    await expect(saveStockDraft(db, P, mgr, { docType: 'TRF', issueDate: '2026-11-29', warehouseId: main, toWarehouseId: main, lines: [{ productCode: 'G-003', qty: '1' }] })).rejects.toThrow(/ปลายทาง/u);
  });
  it('รับเกินใบสั่งซื้อ (รับครบแล้ว) → ปฏิเสธ · บิลซื้อเกินจำนวนที่รับตาม GR → ปฏิเสธ', async () => {
    const gr = await saveStockDraft(db, P, mgr, { docType: 'GR', issueDate: '2026-11-29', refDocumentId: ids[P]!['PO-1']!, lines: [{ productCode: 'G-002', qty: '1' }] });
    await expect(postStockDocument(db, P, mgr, gr)).rejects.toThrow(/เกินจำนวนในใบสั่งซื้อ/u);
    const ap = await savePurchaseDraft(db, P, mgr, { docType: 'AP', contactId: await contact(P, 'V-001'), issueDate: '2026-11-29', refDocumentId: ids[P]!['GR-2']!,
      lines: [{ productCode: 'G-002', description: 'G-002', qty: '21', unitPrice: '400.00', vat: true, accountCode: '5010100' }] });
    await expect(approvePurchase(db, P, mgr, ap)).rejects.toThrow(/เกินที่รับ/u);
  });
});

describe('ขายย้อนวันที่ → คำนวณต้นทุนใหม่ไปข้างหน้า (perpetual)', () => {
  it('IV-4 ลง 9 พ.ย.: ต้นทุน 3,000.00 · โอน/ขายสด/ตรวจนับหลังจากนั้นเปลี่ยน · JV ปรับต้นทุน · มูลค่าคงเหลือ = GL', async () => {
    const b = fx.backdated_sale;
    const r = await runDoc(P, b.doc);
    ids[P]!['IV-4'] = r.id;
    const m = await db.withCompany(P, (tx) => tx.selectFrom('acct.stock_move').select('value').where('document_id', '=', r.id).executeTakeFirstOrThrow());
    expect(m.value).toBe(`-${b.doc.lines[0]!.cogs!}`);
    const recost = await db.withCompany(P, (tx) => tx.selectFrom('acct.inventory_journal as i').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'i.journal_id').onRef('j.company_id', '=', 'i.company_id'))
      .select(['j.journal_no', 'j.journal_date']).where('i.kind', '=', 'recost').where('i.document_id', '=', r.id).execute());
    expect(recost).toHaveLength(1);
    expect(recost[0]!.journal_date).toBe('2026-11-28');
    expect(sorted(await journalTuples(P, recost[0]!.journal_no))).toEqual(sorted(b.recost_journal));
    const v = await stockValuation(db, P, NOV_END);
    const pick = (p: string, w: string) => v.rows.find((x) => x.productCode === p && x.warehouseCode === w)!.value;
    expect({ 'G-001 MAIN': pick('G-001', 'MAIN'), 'G-001 SHOP': pick('G-001', 'SHOP'), total: v.total }).toEqual(b.valuation_after);
    const rc = await reconChecks(db, P, '2026-11');
    expect(rc.checks.find((c) => c.key === 'inventory_control')).toMatchObject({ ok: true, byGl: b.valuation_after.total });
    expect(rc.checks.find((c) => c.key === 'doc_orphans')).toMatchObject({ ok: true });
    expect(await allBalanced(P)).toBe('0');
  });
  it('ต้นทุนของรายการในงวดที่ปิดแล้วจะเปลี่ยน → ปฏิเสธ', async () => {
    await db.withCompany(P, (tx) => tx.updateTable('acct.period').set({ status: 'soft_closed' }).where('fiscal_year', '=', 2569).where('period_no', '=', 11).execute());
    await db.withCompany(P, (tx) => tx.updateTable('acct.period').set({ status: 'open' }).where('fiscal_year', '=', 2569).where('period_no', '=', 10).execute());
    const gr = await saveStockDraft(db, P, mgr, { docType: 'GR', issueDate: '2026-10-31', lines: [{ productCode: 'G-001', qty: '10', unitCost: '100.00' }] });
    await expect(postStockDocument(db, P, mgr, gr)).rejects.toThrow(/ปิดแล้ว/u);
    await db.withCompany(P, (tx) => tx.updateTable('acct.period').set({ status: 'open' }).where('fiscal_year', '=', 2569).where('period_no', '=', 11).execute());
  });
});

describe('ยกเลิก = void + reversal (รวมความเคลื่อนไหวสต็อก)', () => {
  it('ยกเลิกขายสด IV-2 หลังต้นทุนถูกปรับ: JV กลับรายการเลขเดิม + R · สต็อกกลับตามต้นทุนปัจจุบัน · JV ปรับส่วนต่าง · GL = มูลค่าคงเหลือ', async () => {
    const e = fx.void_after_backdate;
    const r = await voidDocument(db, P, mgr, ids[P]!['IV-2']!, { reason: 'ทดสอบยกเลิก' });
    expect(r.reversal).toBe(`${journals[P]!['IV-2']!}R`);
    const rev = await db.withCompany(P, (tx) => tx.selectFrom('acct.stock_move').select(['value', 'qty', 'reversal_of']).where('document_id', '=', ids[P]!['IV-2']!).where('reversal_of', 'is not', null).executeTakeFirstOrThrow());
    expect([rev.qty, rev.value]).toEqual(['10.0000', e.reversal_value]);
    const adj = await db.withCompany(P, (tx) => tx.selectFrom('acct.inventory_journal as i').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'i.journal_id').onRef('j.company_id', '=', 'i.company_id'))
      .select('j.journal_no').where('i.kind', '=', 'void_adjust').where('i.document_id', '=', ids[P]!['IV-2']!).executeTakeFirstOrThrow());
    expect(sorted(await journalTuples(P, adj.journal_no))).toEqual(sorted(e.void_adjust_journal));
    const v = await stockValuation(db, P, NOV_END);
    expect({ 'G-001 SHOP': v.rows.find((x) => x.productCode === 'G-001' && x.warehouseCode === 'SHOP')!.value, total: v.total }).toEqual(e.valuation_after);
    expect((await reconChecks(db, P, '2026-11')).checks.find((c) => c.key === 'inventory_control')).toMatchObject({ ok: true, byGl: e.valuation_after.total });
    await expect(voidDocument(db, P, mgr, ids[P]!['IV-2']!, { reason: 'ซ้ำ' })).rejects.toThrow(/ยกเลิกแล้ว/u);
  });
  it('ยกเลิก GR ที่มีบิลซื้ออ้างอยู่ไม่ได้ · ยกเลิกใบเบิก (perpetual) กลับ JV + สต็อก', async () => {
    await expect(voidStockDocument(db, P, mgr, ids[P]!['GR-1']!, { reason: 'ทดสอบ' })).rejects.toThrow(/บิลซื้ออ้าง/u);
    await voidStockDocument(db, P, mgr, ids[P]!['GI-1']!, { reason: 'เบิกผิด' });
    const g3 = (await stockValuation(db, P, NOV_END)).rows.find((x) => x.productCode === 'G-003')!;
    expect([g3.qty, g3.value]).toEqual(['57.0000', '1995.00']); // 52 + 5 · 1,820 + 175
    expect((await reconChecks(db, P, '2026-11')).checks.find((c) => c.key === 'inventory_control')).toMatchObject({ ok: true });
    expect(await allBalanced(P)).toBe('0');
  });
  it('periodic: ยกเลิกใบโอนคลัง (ไม่มี JV) → สต็อกกลับคลังต้นทาง', async () => {
    await db.withCompany(Q, (tx) => tx.updateTable('acct.period').set({ status: 'open' }).where('fiscal_year', '=', 2569).where('period_no', '=', 12).execute());
    const trf = await saveStockDraft(db, Q, mgr, { docType: 'TRF', issueDate: '2026-12-01', warehouseId: await wh(Q, 'SHOP'), toWarehouseId: await wh(Q, 'MAIN'), lines: [{ productCode: 'G-001', qty: '20' }] });
    const r = await postStockDocument(db, Q, mgr, trf);
    expect(r).toMatchObject({ journalNo: null, total: '3096.00' });
    await voidStockDocument(db, Q, mgr, trf, { reason: 'โอนผิดคลัง' });
    const v = await stockValuation(db, Q, '2026-12-31');
    expect(v.rows.filter((x) => x.productCode === 'G-001').map((x) => [x.warehouseCode, x.qty, x.value])).toEqual([['MAIN', '221.0000', '34210.80'], ['SHOP', '20.0000', '3096.00']]);
  });
});

describe('RLS: ตารางใหม่ไม่รั่วข้ามบริษัท', () => {
  it('บริษัท Q มองไม่เห็นคลัง/ความเคลื่อนไหว/ยอดคงเหลือ/หน่วย/JV สต็อกของ P · ไม่มี context = ไม่เห็นอะไร', async () => {
    const pMoves = await db.withCompany(P, (tx) => tx.selectFrom('acct.stock_move').select('id').execute());
    expect(pMoves.length).toBeGreaterThan(0);
    await db.withCompany(Q, async (tx) => {
      expect(await tx.selectFrom('acct.stock_move').select('id').where('id', 'in', pMoves.map((m) => m.id)).execute()).toEqual([]);
      for (const t of ['acct.warehouse', 'acct.stock_balance', 'acct.product_unit', 'acct.stock_move', 'acct.inventory_journal'] as const) {
        const rows = await tx.selectFrom(t).select('company_id').execute();
        expect(rows.every((r) => r.company_id === Q), t).toBe(true);
      }
    });
    await expect(db.withCompany(Q, (tx) => tx.insertInto('acct.warehouse').values({ company_id: P, code: 'X', name: 'แทรกข้ามบริษัท' }).execute())).rejects.toThrow(/row-level security/u);
    const raw = await import('pg');
    const c = new raw.default.Client({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera_test' });
    await c.connect();
    try {
      for (const t of ['warehouse', 'product_unit', 'stock_move', 'stock_balance', 'inventory_journal']) expect((await c.query(`select count(*)::int n from acct.${t}`)).rows[0].n, t).toBe(0);
    } finally { await c.end(); }
  });
});

describe('โมดูลปิด = Phase 1 เดิม', () => {
  it('บริษัทบริการไม่เปิดโมดูล: ใบกำกับลงบัญชีเหมือนเดิม ไม่มีความเคลื่อนไหวสต็อก · จุดตรวจกระทบยอดคง 16 จุด', async () => {
    const id = await saveSalesDraft(db, R, mgr, { docType: 'IV', contactId: await contact(R, 'C0031'), issueDate: '2026-11-10', lines: [{ productCode: 'S-0001', description: 'บริการ', qty: '1', unitPrice: '1000.00', vat: true }] });
    const r = await approveDocument(db, R, mgr, id);
    expect(sorted(await journalTuples(R, r.journalNo!))).toEqual(sorted([['Dr', '1130100', '1070.00'], ['Cr', '4100200', '1000.00'], ['Cr', '2150400', '70.00']]));
    expect(await db.withCompany(R, (tx) => tx.selectFrom('acct.stock_move').select('id').execute())).toEqual([]);
    expect(await db.withCompany(R, (tx) => tx.selectFrom('acct.warehouse').select('id').execute())).toEqual([]);
    expect((await reconChecks(db, R, '2026-11')).checks).toHaveLength(16);
    await expect(saveStockDraft(db, R, mgr, { docType: 'GI', issueDate: '2026-11-10', lines: [{ productCode: 'S-0001', qty: '1' }] })).rejects.toThrow(/ยังไม่ได้เปิดโมดูล/u);
    await voidDocument(db, R, mgr, id, { reason: 'ทดสอบ' });
  });
});
