// Phase 2A INV สินค้าคงคลัง (docs/technical-plan-P2A.md "INV" · Spec v2 §5.10/§5.13 FR-IN-01/02/05/07 · FR-PU-09)
// เปิดโมดูล · คลัง · ข้อมูลสต็อกของสินค้า · เอกสาร GR/GI/TRF/ADJ · ปรับสินค้าปลายงวด (periodic) · รายงาน
// Backend เท่านั้น — ยังไม่มีแบบร่าง .dc.html ของหน้าจอสต็อก (ห้ามเดาหน้าจอ)
import { Money, post, type MoneyString, type PostingLineInput } from '@innovera/ledger';
import { Decimal } from 'decimal.js';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError, nextNumber, postJournalTx, reserveNumber } from './ledger-service.ts';
import {
  applyMovesTx, assertAvco, assertCanPostOn, baseQtyTx, cogsAccountOf, defaultWarehouseTx, INV_ACCOUNTS, INVENTORY_ACCOUNT_LIST, INVENTORY_SETTING_KEYS,
  inventoryOnTx, inventoryRuleTx, inventorySettingsTx, invAccountOf, linkMovesTx, money, productsTx, type InventorySettings, type NewMove,
} from './inventory-core.ts';
import { categoryOf } from './seed.ts';
import { docOrThrow, event, prefixOf, voidDocument, type Actor } from './sales.ts';

export { INV_ACCOUNTS, INVENTORY_ACCOUNT_LIST, INVENTORY_DEFAULTS, INVENTORY_SETTING_KEYS, type InventorySettings } from './inventory-core.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const dec = (s: string | null | undefined) => new D(s ?? 0);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
const QTY_RE = /^\d+(\.\d{1,4})?$/u;
const COST_RE = /^\d+(\.\d{1,4})?$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
export const STOCK_TYPES = ['GR', 'GI', 'TRF', 'ADJ'] as const;
export type StockDocType = (typeof STOCK_TYPES)[number];
const RULE: Partial<Record<StockDocType, string>> = { GR: 'Stock[GR]', GI: 'Stock[GI]', ADJ: 'Stock[ADJ]' };

async function requireModuleTx(tx: CompanyTx, companyId: string) {
  if (!(await inventoryOnTx(tx, companyId))) throw new LedgerError('ยังไม่ได้เปิดโมดูลสินค้าคงคลังของบริษัทนี้');
}

// ---------- เปิด/ปิดโมดูล ----------

/**
 * เปิดโมดูลสต็อก: modules.inventory = true · สร้างบัญชีของโมดูล (upsert ไม่ทับชื่อที่ผู้ใช้แก้) · คลังตั้งต้น (ถ้ายังไม่มีคลัง)
 * TODO(Wei): รหัส/ชื่อคลังตั้งต้น ("MAIN" คลังสินค้าหลัก) ไม่มีในแบบร่าง — แก้ได้ภายหลังผ่าน PUT inventory/warehouses/:id
 */
export async function enableInventory(db: Db, companyId: string, opts: { warehouseCode?: string; warehouseName?: string } = {}) {
  await db.withPublic((tx) => tx.updateTable('public.company').set({ modules: sql<string>`coalesce(modules, '{}'::jsonb) || '{"inventory": true}'::jsonb` }).where('id', '=', companyId).execute());
  return db.withCompany(companyId, async (tx) => {
    for (const a of INVENTORY_ACCOUNT_LIST) {
      await tx.insertInto('acct.account').values({ company_id: companyId, code: a.code, name: a.name, type: a.type, parent_code: null, is_control: false, control_kind: null, requires_contact: false,
        category: categoryOf(a.code, a.type), binding: 'โมดูลสินค้าคงคลัง' }).onConflict((oc) => oc.columns(['company_id', 'code']).doNothing()).execute();
    }
    const any = await tx.selectFrom('acct.warehouse').select('id').executeTakeFirst();
    if (!any) {
      await tx.insertInto('acct.warehouse').values({ company_id: companyId, code: opts.warehouseCode ?? 'MAIN', name: opts.warehouseName ?? 'คลังสินค้าหลัก', is_default: true }).execute();
    }
    return { enabled: true, accounts: INVENTORY_ACCOUNT_LIST.map((a) => a.code), settings: await inventorySettingsTx(tx) };
  });
}

/** ปิดโมดูลได้เมื่อยังไม่มีความเคลื่อนไหวสต็อก (ข้อมูลที่ลงแล้วต้องคงอยู่) */
export async function disableInventory(db: Db, companyId: string) {
  const used = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.stock_move').select('id').limit(1).execute());
  if (used.length) throw new LedgerError('มีความเคลื่อนไหวสต็อกแล้ว ปิดโมดูลไม่ได้');
  await db.withPublic((tx) => tx.updateTable('public.company').set({ modules: sql<string>`coalesce(modules, '{}'::jsonb) || '{"inventory": false}'::jsonb` }).where('id', '=', companyId).execute());
  return { enabled: false };
}

export async function inventoryStatus(db: Db, companyId: string) {
  return db.withCompany(companyId, async (tx) => ({ enabled: await inventoryOnTx(tx, companyId), settings: await inventorySettingsTx(tx) }));
}

// ---------- ค่าตั้ง [ผู้สอบบัญชี] ----------

/**
 * ตั้งค่าโมดูล — ทุกค่าเป็น "รอผู้สอบบัญชี" (TODO(Wei)) · ระบบไม่ตัดสินนโยบายเอง
 *  inventory.method: periodic (ค่าตั้งต้นชั่วคราว) | perpetual — เปลี่ยนได้ก่อนมีความเคลื่อนไหวสต็อกเท่านั้น (TODO(Wei): การเปลี่ยนวิธีกลางปี)
 *  inventory.costing: avco (ค่าตั้งต้น) · fifo = Phase 3 (ปฏิเสธ)
 *  inventory.writedown_nrv: false (ค่าตั้งต้น) · true = ยังไม่รองรับจนกว่าผู้สอบบัญชียืนยันวิธีตีราคา (ต่ำกว่าทุน/NRV)
 */
export async function setInventorySetting(db: Db, companyId: string, key: string, value: unknown) {
  if (key === INVENTORY_SETTING_KEYS.method) {
    if (value !== 'periodic' && value !== 'perpetual') throw new LedgerError('inventory.method ต้องเป็น periodic หรือ perpetual');
  } else if (key === INVENTORY_SETTING_KEYS.costing) {
    if (value === 'fifo') throw new LedgerError('วิธีต้นทุน FIFO ยังไม่รองรับ (Phase 3 · FR-IN-08)');
    if (value !== 'avco') throw new LedgerError('inventory.costing ต้องเป็น avco');
  } else if (key === INVENTORY_SETTING_KEYS.writedownNrv) {
    if (typeof value !== 'boolean') throw new LedgerError('inventory.writedown_nrv ต้องเป็น true/false');
    if (value) throw new LedgerError('การตีราคาสินค้าต่ำกว่าทุน/NRV ยังไม่เปิดใช้ — รอผู้สอบบัญชียืนยันวิธี');
  } else throw new LedgerError('ไม่รู้จักค่าตั้งนี้');
  return db.withCompany(companyId, async (tx) => {
    if (key === INVENTORY_SETTING_KEYS.method) {
      const cur = await inventorySettingsTx(tx);
      const used = await tx.selectFrom('acct.stock_move').select('id').limit(1).execute();
      if (cur.method !== value && used.length) throw new LedgerError('เปลี่ยนวิธีบันทึกสินค้า (periodic/perpetual) ได้ก่อนมีความเคลื่อนไหวสต็อกเท่านั้น');
    }
    await tx.insertInto('acct.company_setting').values({ company_id: companyId, key, value: JSON.stringify(value), updated_at: new Date() })
      .onConflict((oc) => oc.columns(['company_id', 'key']).doUpdateSet({ value: JSON.stringify(value), updated_at: new Date() })).execute();
    return inventorySettingsTx(tx);
  });
}

// ---------- คลัง ----------

export interface WarehouseInput { code: string; name: string; branchCode?: string; allowNegative?: boolean; isDefault?: boolean; active?: boolean }
export async function listWarehouses(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.warehouse').selectAll().orderBy('code').execute());
}
export async function saveWarehouse(db: Db, companyId: string, input: WarehouseInput, id?: string): Promise<string> {
  if (!input.code?.trim() || !input.name?.trim()) throw new LedgerError('ต้องระบุรหัสและชื่อคลัง');
  if (input.branchCode && !/^\d{5}$/u.test(input.branchCode)) throw new LedgerError('รหัสสาขาต้องเป็นตัวเลข 5 หลัก');
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx, companyId);
    if (input.isDefault) await tx.updateTable('acct.warehouse').set({ is_default: false }).where('is_default', '=', true).execute();
    const v = { code: input.code.trim(), name: input.name.trim(), branch_code: input.branchCode ?? '00000', allow_negative: input.allowNegative ?? false, active: input.active ?? true,
      ...(input.isDefault !== undefined ? { is_default: input.isDefault } : {}) };
    if (id) {
      const r = await tx.updateTable('acct.warehouse').set(v).where('id', '=', id).returning('id').executeTakeFirst();
      if (!r) throw new LedgerError('ไม่พบคลัง');
      return r.id;
    }
    return (await tx.insertInto('acct.warehouse').values({ company_id: companyId, ...v }).returning('id').executeTakeFirstOrThrow()).id;
  });
}

// ---------- ข้อมูลสต็อกของสินค้า ----------

export interface ProductStockInput {
  trackStock?: boolean; inventoryAccount?: string | null; cogsAccount?: string | null; reorderPoint?: string | null; maxQty?: string | null; barcode?: string | null;
  units?: { unit: string; factor: string; barcode?: string | null }[];
}
export async function setProductStock(db: Db, companyId: string, code: string, input: ProductStockInput) {
  for (const k of ['reorderPoint', 'maxQty'] as const) if (input[k] && !QTY_RE.test(input[k])) throw new LedgerError(`${k} ไม่ถูกต้อง`);
  for (const u of input.units ?? []) if (!u.unit.trim() || !QTY_RE.test(u.factor) || dec(u.factor).lte(0)) throw new LedgerError(`หน่วย "${u.unit}" ตัวคูณไม่ถูกต้อง`);
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx, companyId);
    const p = await tx.selectFrom('acct.product').select(['code', 'kind', 'track_stock', 'unit']).where('code', '=', code).executeTakeFirst();
    if (!p) throw new LedgerError('ไม่พบสินค้า');
    if (input.trackStock && p.kind !== 'goods') throw new LedgerError('ติดตามสต็อกได้เฉพาะสินค้าประเภทสินค้า (goods)');
    if (input.trackStock === false && p.track_stock) {
      const used = await tx.selectFrom('acct.stock_move').select('id').where('product_code', '=', code).limit(1).execute();
      if (used.length) throw new LedgerError('สินค้านี้มีความเคลื่อนไหวสต็อกแล้ว เลิกติดตามสต็อกไม่ได้');
    }
    for (const acct of [input.inventoryAccount, input.cogsAccount]) {
      if (!acct) continue;
      const a = await tx.selectFrom('acct.account').select(['code', 'is_control']).where('code', '=', acct).executeTakeFirst();
      if (!a || a.is_control) throw new LedgerError(`บัญชี ${acct} ใช้ไม่ได้`);
    }
    const patch = {
      ...(input.trackStock !== undefined ? { track_stock: input.trackStock } : {}),
      ...(input.inventoryAccount !== undefined ? { inventory_account: input.inventoryAccount } : {}),
      ...(input.cogsAccount !== undefined ? { cogs_account: input.cogsAccount } : {}),
      ...(input.reorderPoint !== undefined ? { reorder_point: input.reorderPoint } : {}),
      ...(input.maxQty !== undefined ? { max_qty: input.maxQty } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode?.trim() || null } : {}),
    };
    if (Object.keys(patch).length) await tx.updateTable('acct.product').set(patch).where('code', '=', code).execute();
    if (input.units) {
      if (input.units.some((u) => u.unit === p.unit)) throw new LedgerError('หน่วยเพิ่มเติมต้องไม่ซ้ำหน่วยนับหลัก');
      await tx.deleteFrom('acct.product_unit').where('product_code', '=', code).execute();
      for (const u of input.units) {
        await tx.insertInto('acct.product_unit').values({ company_id: companyId, product_code: code, unit: u.unit.trim(), factor: u.factor, barcode: u.barcode?.trim() || null }).execute();
      }
    }
    return tx.selectFrom('acct.product').select(['code', 'track_stock', 'inventory_account', 'cogs_account', 'reorder_point', 'max_qty', 'barcode', 'unit']).where('code', '=', code).executeTakeFirstOrThrow();
  });
}

/** สแกนบาร์โค้ด (FR-IN-07): สินค้า + หน่วย (บาร์โค้ดของหน่วยเพิ่มเติม = หน่วยนั้น) */
export async function findByBarcode(db: Db, companyId: string, barcode: string) {
  return db.withCompany(companyId, async (tx) => {
    const p = await tx.selectFrom('acct.product').select(['code', 'name', 'unit']).where('barcode', '=', barcode).executeTakeFirst();
    if (p) return { productCode: p.code, name: p.name, unit: p.unit, factor: '1.0000' };
    const u = await tx.selectFrom('acct.product_unit as u').innerJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'u.product_code').onRef('p.company_id', '=', 'u.company_id'))
      .select(['p.code', 'p.name', 'u.unit', 'u.factor']).where('u.barcode', '=', barcode).executeTakeFirst();
    return u ? { productCode: u.code, name: u.name, unit: u.unit, factor: u.factor } : null;
  });
}

// ---------- เอกสารสต็อก GR / GI / TRF / ADJ ----------

export interface StockLineInput {
  productCode: string;
  qty?: string;                    // GR/GI/TRF: จำนวน (หน่วยของบรรทัด) · ADJ delta: ผลต่าง ± (ใช้ "-3")
  countedQty?: string;             // ADJ ตรวจนับ: ยอดนับได้ (หน่วยนับหลัก) — ผลต่าง = นับได้ − คงเหลือในระบบ ณ วันที่เอกสาร
  unit?: string | null;
  unitCost?: string | null;        // ต้นทุนต่อหน่วยของบรรทัด (GR ไม่อ้าง PO · ADJ เพิ่ม) · ว่าง = ราคาใน PO / ต้นทุนถัวเฉลี่ย
  accountCode?: string | null;     // GI: บัญชีค่าใช้จ่าย · ADJ: บัญชีผลต่าง (ว่าง = 5020900)
  description?: string;
  lot?: string | null;
  serial?: string | null;
}
export interface StockDocInput {
  docType: StockDocType;
  issueDate: string;
  warehouseId?: string | null;     // ว่าง = คลังตั้งต้น · TRF = คลังต้นทาง
  toWarehouseId?: string | null;   // TRF
  contactId?: string | null;       // GR: ผู้ขาย
  refDocumentId?: string | null;   // GR: ใบสั่งซื้อ (PO) · รับได้หลายครั้ง
  notes?: string | null;
  reference?: string | null;
  lines: StockLineInput[];
}

export async function saveStockDraft(db: Db, companyId: string, actor: Actor, input: StockDocInput, id?: string): Promise<string> {
  if (!STOCK_TYPES.includes(input.docType)) throw new LedgerError('ประเภทเอกสารสต็อกไม่ถูกต้อง');
  if (!DATE_RE.test(input.issueDate)) throw new LedgerError('วันที่ไม่ถูกต้อง');
  if (!input.lines.length) throw new LedgerError('ต้องมีอย่างน้อย 1 รายการ');
  for (const l of input.lines) {
    if (input.docType === 'ADJ') {
      if ((l.countedQty === undefined) === (l.qty === undefined)) throw new LedgerError(`${l.productCode}: ใบปรับยอดระบุยอดนับได้ หรือ ผลต่าง อย่างใดอย่างหนึ่ง`);
      if (l.countedQty !== undefined && !QTY_RE.test(l.countedQty)) throw new LedgerError(`${l.productCode}: ยอดนับได้ไม่ถูกต้อง`);
      if (l.qty !== undefined && (!/^-?\d+(\.\d{1,4})?$/u.test(l.qty) || dec(l.qty).isZero())) throw new LedgerError(`${l.productCode}: ผลต่างไม่ถูกต้อง`);
    } else if (!l.qty || !QTY_RE.test(l.qty) || dec(l.qty).lte(0)) throw new LedgerError(`${l.productCode}: จำนวนต้องมากกว่า 0`);
    if (l.unitCost && !COST_RE.test(l.unitCost)) throw new LedgerError(`${l.productCode}: ต้นทุนต่อหน่วยไม่ถูกต้อง`);
  }
  if (input.docType === 'TRF' && (!input.toWarehouseId || input.toWarehouseId === input.warehouseId)) throw new LedgerError('ใบโอนคลังต้องระบุคลังปลายทางที่ต่างจากคลังต้นทาง');
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx, companyId);
    const prods = await productsTx(tx, input.lines.map((l) => l.productCode));
    for (const l of input.lines) {
      const p = prods.get(l.productCode);
      if (!p) throw new LedgerError(`ไม่พบสินค้า ${l.productCode}`);
      if (!p.track_stock) throw new LedgerError(`สินค้า ${l.productCode} ไม่ได้ติดตามสต็อก`);
    }
    if (input.refDocumentId) {
      const po = await tx.selectFrom('acct.document').select(['doc_type', 'status']).where('id', '=', input.refDocumentId).executeTakeFirst();
      if (input.docType !== 'GR' || po?.doc_type !== 'PO' || po.status !== 'approved') throw new LedgerError('ใบรับสินค้าอ้างได้เฉพาะใบสั่งซื้อที่อนุมัติแล้ว');
    }
    const values = {
      doc_type: input.docType, issue_date: input.issueDate, due_date: null, contact_id: input.contactId ?? null, price_incl_vat: false,
      subtotal: '0.00', discount: '0.00', vat: '0.00', wht: '0.00', grand_total: '0.00', bill_discount: '0.00', ref_document_id: input.refDocumentId ?? null,
      warehouse_id: input.warehouseId ?? null, to_warehouse_id: input.toWarehouseId ?? null, notes: input.notes ?? null, reference: input.reference ?? null,
      rule_code: RULE[input.docType] ?? null, updated_at: new Date(),
    };
    let docId = id;
    if (docId) {
      const d = await docOrThrow(tx, docId);
      if (d.doc_type !== input.docType) throw new LedgerError('เปลี่ยนประเภทเอกสารไม่ได้');
      if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError('แก้ได้เฉพาะเอกสารร่าง');
      await tx.updateTable('acct.document').set({ ...values, status: 'draft' }).where('id', '=', docId).execute();
      await tx.deleteFrom('acct.document_line').where('document_id', '=', docId).execute();
      await event(tx, companyId, docId, actor.userId, 'edited');
    } else {
      docId = (await tx.insertInto('acct.document').values({ company_id: companyId, ...values, created_by: actor.userId, external_source: null, external_ref: null, doc_no: null, branch_code: '00000', fee: '0.00' } as never)
        .returning('id').executeTakeFirstOrThrow()).id;
      await event(tx, companyId, docId, actor.userId, 'created', input.refDocumentId ? { from: input.refDocumentId } : {});
    }
    for (const [i, l] of input.lines.entries()) {
      await tx.insertInto('acct.document_line').values({
        company_id: companyId, document_id: docId, line_no: i + 1, line_type: 'item', product_code: l.productCode, description: l.description ?? prods.get(l.productCode)!.name,
        qty: l.qty ?? null, unit_price: l.unitCost ?? null, discount: '0.00', amount: '0.00', vat_rate: null, account_code: l.accountCode ?? null, wht_type: null,
        unit: l.unit ?? null, counted_qty: l.countedQty ?? null, est_cost: null,
      }).execute();
    }
    // lot/serial เก็บในความเคลื่อนไหวตอนผ่านรายการ (FR-IN-07) — ร่างเก็บไว้ใน notes ของบรรทัดไม่ได้ จึงรับตอน post (TODO: ตารางติดตาม serial รายชิ้น)
    return docId;
  });
}

/** คงเหลือของสินค้า × คลัง ณ สิ้นวันที่ (รวมทุกรายการถึงวันนั้น) */
async function qtyAsOfTx(tx: CompanyTx, productCode: string, warehouseId: string, date: string) {
  const r = await tx.selectFrom('acct.stock_move').select([sql<string>`coalesce(sum(qty), 0)`.as('q'), sql<string>`coalesce(sum(value), 0)`.as('v')])
    .where('product_code', '=', productCode).where('warehouse_id', '=', warehouseId).where('move_date', '<=', date).executeTakeFirstOrThrow();
  return { q: dec(r.q), v: dec(r.v) };
}

/** ใบสั่งซื้อ: ต่อสินค้า — สั่ง (หน่วยหลัก) มูลค่า · รับแล้ว (GR ที่ผ่านรายการ ไม่ถูกยกเลิก) */
async function poPositionTx(tx: CompanyTx, poId: string, excludeDoc: string) {
  const poLines = await tx.selectFrom('acct.document_line').select(['product_code', 'qty', 'unit', 'amount']).where('document_id', '=', poId).where('line_type', '=', 'item').execute();
  const prods = await productsTx(tx, poLines.map((l) => l.product_code).filter((c): c is string => Boolean(c)));
  const pos = new Map<string, { orderedQ: Decimal; orderedV: Decimal; receivedQ: Decimal; receivedV: Decimal }>();
  for (const l of poLines) {
    const p = l.product_code ? prods.get(l.product_code) : undefined;
    if (!p) continue;
    const cur = pos.get(p.code) ?? { orderedQ: dec('0'), orderedV: dec('0'), receivedQ: dec('0'), receivedV: dec('0') };
    cur.orderedQ = cur.orderedQ.plus(await baseQtyTx(tx, p, l.qty ?? '0', l.unit));
    cur.orderedV = cur.orderedV.plus(dec(l.amount));
    pos.set(p.code, cur);
  }
  const rec = await tx.selectFrom('acct.stock_move as m').innerJoin('acct.document as g', (j) => j.onRef('g.id', '=', 'm.document_id').onRef('g.company_id', '=', 'm.company_id'))
    .select(['m.product_code', sql<string>`sum(m.qty)`.as('q'), sql<string>`sum(m.value)`.as('v')])
    .where('g.ref_document_id', '=', poId).where('g.doc_type', '=', 'GR').where('g.status', '=', 'posted').where('g.id', '<>', excludeDoc).where('m.kind', '=', 'receipt').where('m.reversal_of', 'is', null)
    .groupBy('m.product_code').execute();
  for (const r of rec) {
    const cur = pos.get(r.product_code);
    if (cur) { cur.receivedQ = dec(r.q); cur.receivedV = dec(r.v); }
  }
  return pos;
}

/** ผ่านรายการเอกสารสต็อก: เลขที่ · ความเคลื่อนไหว · JV (GR ทุกวิธี · GI/ADJ เฉพาะ perpetual · TRF ไม่มี JV) */
export async function postStockDocument(db: Db, companyId: string, actor: Actor, id: string, opts: { docNo?: string; lots?: Record<number, { lot?: string; serial?: string }> } = {}) {
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx, companyId);
    const d = await docOrThrow(tx, id);
    const type = d.doc_type as StockDocType;
    if (!STOCK_TYPES.includes(type)) throw new LedgerError('ไม่ใช่เอกสารสต็อก');
    if (d.status !== 'draft' && d.status !== 'pending_approval') throw new LedgerError(`เอกสารสถานะ ${d.status} ผ่านรายการไม่ได้`);
    const s = await inventorySettingsTx(tx);
    assertAvco(s);
    const perpetual = s.method === 'perpetual';
    await assertCanPostOn(tx, d.issue_date, actor.role);
    const docNo = opts.docNo ?? d.doc_no ?? (await nextNumber(tx, companyId, await prefixOf(tx, type), d.issue_date));
    if (opts.docNo) await reserveNumber(tx, companyId, opts.docNo);
    const lines = await tx.selectFrom('acct.document_line').selectAll().where('document_id', '=', id).where('line_type', '=', 'item').orderBy('line_no').execute();
    const prods = await productsTx(tx, lines.map((l) => l.product_code!));
    const wh = d.warehouse_id ?? (await defaultWarehouseTx(tx));
    const moves: NewMove[] = [];
    const moveLine: number[] = []; // index ของบรรทัดต่อรายการ
    const po = type === 'GR' && d.ref_document_id ? await poPositionTx(tx, d.ref_document_id, id) : null;
    const poUsed = new Map<string, Decimal>();
    for (const [i, l] of lines.entries()) {
      const p = prods.get(l.product_code!)!;
      if (!p.track_stock) throw new LedgerError(`สินค้า ${p.code} ไม่ได้ติดตามสต็อก`);
      const base = { date: d.issue_date, product: p, documentId: id, documentLineId: l.id, lot: opts.lots?.[l.line_no]?.lot ?? null, serial: opts.lots?.[l.line_no]?.serial ?? null };
      if (type === 'GR') {
        const q = await baseQtyTx(tx, p, l.qty!, l.unit);
        let value: Decimal;
        if (po) {
          const pos = po.get(p.code);
          if (!pos) throw new LedgerError(`${p.code} ไม่อยู่ในใบสั่งซื้อที่อ้าง`);
          const used = poUsed.get(p.code) ?? dec('0');
          const after = pos.receivedQ.plus(used).plus(q);
          if (after.gt(pos.orderedQ)) throw new LedgerError(`${p.code}: รับรวม ${after.toFixed()} เกินจำนวนในใบสั่งซื้อ (${pos.orderedQ.toFixed()})`);
          if (l.unit_price) value = r2(dec(l.qty).times(l.unit_price));
          // รับครบตาม PO = มูลค่า PO − ที่รับไปแล้ว (เศษสตางค์ไปครั้งสุดท้าย) · บางส่วน = จำนวน × ต้นทุนต่อหน่วยหลักของ PO
          else if (after.equals(pos.orderedQ)) value = pos.orderedV.minus(pos.receivedV).minus(moves.filter((m) => m.product.code === p.code).reduce((a, m) => a.plus(m.value ?? 0), dec('0')));
          else value = r2(pos.orderedV.div(pos.orderedQ).times(q));
          poUsed.set(p.code, used.plus(q));
        } else {
          if (!l.unit_price) throw new LedgerError(`${p.code}: ใบรับสินค้าที่ไม่อ้างใบสั่งซื้อต้องระบุต้นทุนต่อหน่วย`);
          value = r2(dec(l.qty).times(l.unit_price));
        }
        moves.push({ ...base, warehouseId: wh, kind: 'receipt', qty: q, costMode: 'fixed', value, glAccount: null });
        moveLine.push(i);
      } else if (type === 'GI') {
        const q = await baseQtyTx(tx, p, l.qty!, l.unit);
        moves.push({ ...base, warehouseId: wh, kind: 'issue', qty: q.neg(), costMode: 'avg', glAccount: perpetual ? (l.account_code ?? cogsAccountOf(p)) : null });
        moveLine.push(i);
      } else if (type === 'TRF') {
        const q = await baseQtyTx(tx, p, l.qty!, l.unit);
        moves.push({ ...base, warehouseId: wh, kind: 'transfer_out', qty: q.neg(), costMode: 'avg', glAccount: null });
        moveLine.push(i);
        moves.push({ ...base, warehouseId: d.to_warehouse_id!, kind: 'transfer_in', qty: q, costMode: 'pair', pairIndex: moves.length - 1, glAccount: null });
        moveLine.push(-1);
      } else {
        let delta: Decimal;
        if (l.counted_qty !== null) {
          const sys = await qtyAsOfTx(tx, p.code, wh, d.issue_date);
          delta = dec(l.counted_qty).minus(sys.q);
        } else delta = await baseQtyTx(tx, p, l.qty!, l.unit);
        // บรรทัดใบปรับยอดเก็บผลต่างเป็นหน่วยนับหลัก
        await tx.updateTable('acct.document_line').set({ qty: r4(delta).toFixed(4), unit: null }).where('id', '=', l.id).execute();
        if (delta.isZero()) continue;
        const gl = perpetual ? (l.account_code ?? INV_ACCOUNTS.countVariance) : null;
        if (delta.gt(0) && l.unit_price) moves.push({ ...base, warehouseId: wh, kind: 'adjust', qty: delta, costMode: 'fixed', value: r2(delta.times(l.unit_price)), glAccount: gl });
        else moves.push({ ...base, warehouseId: wh, kind: 'adjust', qty: delta, costMode: 'avg', glAccount: gl });
        moveLine.push(i);
      }
    }
    if (!moves.length) throw new LedgerError('ไม่มีผลต่างให้ปรับ');
    const res = await applyMovesTx(tx, { companyId, role: actor.role, perpetual, label: docNo, documentId: id }, moves);
    // JV ของเอกสาร
    let journal: { id: string; journalNo: string } | null = null;
    const rule = RULE[type];
    if (rule && (type === 'GR' || perpetual)) {
      const { def, versionId } = await inventoryRuleTx(tx, rule);
      const pl: PostingLineInput[] = [];
      let total = dec('0');
      for (const [k, m] of moves.entries()) {
        const v = res.values[k]!;
        const a = money(v.abs()).toString();
        if (type === 'GR') { pl.push({ amounts: { value: a }, productAccount: invAccountOf(m.product) }); total = total.plus(v); }
        else if (type === 'GI') pl.push({ amounts: { value: a }, account: m.glAccount!, productAccount: invAccountOf(m.product) });
        else pl.push({ amounts: v.gte(0) ? { gain: a } : { loss: a }, account: m.glAccount!, productAccount: invAccountOf(m.product) });
      }
      const jl = post(def, { docType: type, amounts: { total: money(total).toString() }, lines: pl });
      if (jl.length) journal = await postJournalTx(tx, companyId, { date: d.issue_date, lines: jl, role: actor.role, book: def.book, prefix: 'JV', description: docNo, sourceDocumentId: id, ...(versionId ? { ruleVersionId: versionId } : {}) });
    }
    await linkMovesTx(tx, res.ids, journal?.id ?? null, (k) => Boolean(journal) && (type === 'GR' || moves[k]!.glAccount !== null));
    // ยอดบรรทัด/เอกสาร = มูลค่าตามต้นทุน (TRF/GI = มูลค่าที่ออก · ADJ = สุทธิ ±)
    let docTotal = dec('0');
    for (const [k, li] of moveLine.entries()) {
      if (li < 0) continue;
      const v = res.values[k]!;
      const amt = type === 'ADJ' ? v : v.abs();
      docTotal = docTotal.plus(amt);
      const lineQty = type === 'ADJ' ? moves[k]!.qty.abs() : dec(lines[li]!.qty);
      await tx.updateTable('acct.document_line').set({ amount: r2(amt).toFixed(2), unit_price: r4(v.abs().div(lineQty)).toFixed(4) }).where('id', '=', lines[li]!.id).execute();
    }
    await tx.updateTable('acct.document').set({ status: 'posted', doc_no: docNo, journal_id: journal?.id ?? null, subtotal: r2(docTotal).toFixed(2), grand_total: r2(docTotal).toFixed(2),
      approved_by: actor.userId, approved_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    await event(tx, companyId, id, actor.userId, 'posted', { docNo, journalNo: journal?.journalNo ?? null });
    return { docNo, journalNo: journal?.journalNo ?? null, total: r2(docTotal).toFixed(2) };
  });
}

/** ยกเลิกเอกสารสต็อก = void + reversal (JV กลับรายการเลขเดิม + R · ความเคลื่อนไหวกลับ) — ใช้ voidDocumentTx เดียวกับเอกสารอื่น */
export async function voidStockDocument(db: Db, companyId: string, actor: Actor, id: string, p: { reason: string; date?: string }) {
  const d = await db.withCompany(companyId, (tx) => docOrThrow(tx, id));
  if (!STOCK_TYPES.includes(d.doc_type as StockDocType)) throw new LedgerError('ไม่ใช่เอกสารสต็อก');
  return voidDocument(db, companyId, actor, id, p);
}

/** รายการเอกสารสต็อก (GR/GI/TRF/ADJ) ล่าสุดก่อน · คลังต้นทาง/ปลายทาง · ผู้ขาย · เลข JV (หน้าชั่วคราว /inventory/documents) */
export async function listStockDocuments(db: Db, companyId: string, f: { docType?: StockDocType; status?: string; limit?: number } = {}) {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.document as d')
      .leftJoin('acct.warehouse as w', (j) => j.onRef('w.id', '=', 'd.warehouse_id').onRef('w.company_id', '=', 'd.company_id'))
      .leftJoin('acct.warehouse as t', (j) => j.onRef('t.id', '=', 'd.to_warehouse_id').onRef('t.company_id', '=', 'd.company_id'))
      .leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .leftJoin('acct.journal as jn', (j) => j.onRef('jn.id', '=', 'd.journal_id').onRef('jn.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_type', 'd.doc_no', 'd.status', 'd.issue_date', 'd.grand_total', 'd.reference', 'd.created_at', 'w.code as warehouse_code', 't.code as to_warehouse_code',
        'c.name as contact_name', 'jn.journal_no',
        sql<string>`(select count(*) from acct.document_line l where l.document_id = d.id and l.company_id = d.company_id and l.line_type = 'item')`.as('line_count')])
      .where('d.doc_type', 'in', f.docType ? [f.docType] : [...STOCK_TYPES])
      .orderBy('d.issue_date', 'desc').orderBy('d.created_at', 'desc').limit(f.limit ?? 500);
    if (f.status) q = q.where('d.status', '=', f.status as never);
    const rows = await q.execute();
    return rows.map((r) => ({ ...r, line_count: Number(r.line_count) }));
  });
}

/** หน่วยนับเพิ่มเติมของสินค้า (ตัวคูณเทียบหน่วยหลัก) */
export async function listProductUnits(db: Db, companyId: string) {
  return db.withCompany(companyId, (tx) => tx.selectFrom('acct.product_unit').select(['product_code', 'unit', 'factor', 'barcode']).orderBy('product_code').orderBy('unit').execute());
}

export async function getStockDocument(db: Db, companyId: string, id: string) {
  return db.withCompany(companyId, async (tx) => {
    const doc = await docOrThrow(tx, id);
    const lines = await tx.selectFrom('acct.document_line').selectAll().where('document_id', '=', id).orderBy('line_no').execute();
    const moves = await tx.selectFrom('acct.stock_move').selectAll().where('document_id', '=', id).orderBy('seq').execute();
    return { doc, lines, moves };
  });
}

// ---------- ปรับสินค้าปลายงวด (periodic) ----------

/**
 * periodic: ไม่ลงต้นทุนต่อรายการ — ปิดงวดสร้าง JV ปรับบัญชีสินค้าคงเหลือให้เท่ามูลค่าคงเหลือ ณ สิ้นงวด (ต่างไป → ต้นทุนขาย 5020100) · รันได้ครั้งเดียวต่องวด (เหมือนค่าเสื่อม)
 * TODO(Wei): periodic รวมผลต่างตรวจนับ/เบิกใช้ไว้ในต้นทุนขาย — ผู้สอบบัญชียืนยันว่าต้องแยกบัญชีหรือไม่
 */
export async function runInventoryPeriodEnd(db: Db, companyId: string, actor: Actor, p: { fiscalYear: number; periodNo: number }) {
  return db.withCompany(companyId, async (tx) => {
    await requireModuleTx(tx, companyId);
    const s = await inventorySettingsTx(tx);
    if (s.method !== 'periodic') throw new LedgerError('ปรับสินค้าปลายงวดใช้กับวิธี periodic เท่านั้น (perpetual ลงต้นทุนทุกรายการแล้ว)');
    const per = await tx.selectFrom('acct.period').selectAll().where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
    if (!per || per.period_no < 1 || per.period_no > 12) throw new LedgerError('ไม่พบงวด');
    const done = await tx.selectFrom('acct.inventory_journal').select('journal_id').where('kind', '=', 'period_end').where('fiscal_year', '=', p.fiscalYear).where('period_no', '=', p.periodNo).executeTakeFirst();
    if (done) throw new LedgerError('ปรับสินค้าปลายงวดนี้แล้ว');
    const r = await valuationRowsTx(tx, per.ends_on, null);
    const accounts = new Set<string>([INV_ACCOUNTS.inventory, ...r.byAccount.keys()]);
    const gl = await glBalanceTx(tx, [...accounts], per.ends_on);
    const lines = [];
    const detail = [];
    for (const a of accounts) {
      const val = r.byAccount.get(a) ?? dec('0');
      const diff = (gl.get(a) ?? dec('0')).minus(val); // บวก = GL สูงกว่ามูลค่าคงเหลือ → ตัดเป็นต้นทุนขาย
      detail.push({ account: a, gl: r2(gl.get(a) ?? dec('0')).toFixed(2), valuation: r2(val).toFixed(2), adjustment: r2(diff).toFixed(2) });
      if (diff.isZero()) continue;
      const amount = money(diff.abs());
      if (diff.gt(0)) lines.push({ side: 'Dr' as const, account: INV_ACCOUNTS.cogs, amount }, { side: 'Cr' as const, account: a, amount });
      else lines.push({ side: 'Dr' as const, account: a, amount }, { side: 'Cr' as const, account: INV_ACCOUNTS.cogs, amount });
    }
    if (!lines.length) return { journalNo: null, cogs: '0.00', detail };
    const j = await postJournalTx(tx, companyId, { date: per.ends_on, lines, role: actor.role, book: 'GJ', description: `ปรับสินค้าคงเหลือปลายงวด ${p.periodNo}/${p.fiscalYear} (periodic)` });
    await tx.insertInto('acct.inventory_journal').values({ company_id: companyId, journal_id: j.id, kind: 'period_end', document_id: null, fiscal_year: p.fiscalYear, period_no: p.periodNo, detail: JSON.stringify(detail) }).execute();
    const cogs = lines.filter((l) => l.account === INV_ACCOUNTS.cogs).reduce((a, l) => (l.side === 'Dr' ? a.plus(l.amount) : a.minus(l.amount)), Money.zero());
    return { journalNo: j.journalNo, cogs: cogs.toString(), detail };
  });
}

async function glBalanceTx(tx: CompanyTx, accounts: string[], asOf: string) {
  if (!accounts.length) return new Map<string, Decimal>();
  const rows = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
    .select(['l.account_code', sql<string>`sum(l.debit - l.credit)`.as('b')]).where('j.status', '<>', 'draft').where('j.journal_date', '<=', asOf).where('l.account_code', 'in', accounts)
    .groupBy('l.account_code').execute();
  return new Map(rows.map((r) => [r.account_code, dec(r.b)]));
}

// ---------- รายงาน ----------

async function valuationRowsTx(tx: CompanyTx, asOf: string, warehouseId: string | null) {
  let q = tx.selectFrom('acct.stock_move as m').innerJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'm.product_code').onRef('p.company_id', '=', 'm.company_id'))
    .innerJoin('acct.warehouse as w', (j) => j.onRef('w.id', '=', 'm.warehouse_id').onRef('w.company_id', '=', 'm.company_id'))
    .select(['m.product_code', 'p.name', 'p.unit', 'p.inventory_account', 'm.warehouse_id', 'w.code as warehouse_code', sql<string>`sum(m.qty)`.as('q'), sql<string>`sum(m.value)`.as('v')])
    .where('m.move_date', '<=', asOf);
  if (warehouseId) q = q.where('m.warehouse_id', '=', warehouseId);
  const rows = await q.groupBy(['m.product_code', 'p.name', 'p.unit', 'p.inventory_account', 'm.warehouse_id', 'w.code']).orderBy('m.product_code').orderBy('w.code').execute();
  const byAccount = new Map<string, Decimal>();
  for (const r of rows) {
    const a = r.inventory_account ?? INV_ACCOUNTS.inventory;
    byAccount.set(a, (byAccount.get(a) ?? dec('0')).plus(dec(r.v)));
  }
  return { rows, byAccount };
}

/** มูลค่าสินค้าคงเหลือ ณ วันที่ (สินค้า × คลัง · ต้นทุนถัวเฉลี่ย) */
export async function stockValuation(db: Db, companyId: string, asOf: string, opts: { warehouseId?: string | null } = {}) {
  if (!DATE_RE.test(asOf)) throw new LedgerError('วันที่ไม่ถูกต้อง');
  return db.withCompany(companyId, async (tx) => {
    const r = await valuationRowsTx(tx, asOf, opts.warehouseId ?? null);
    const rows = r.rows.filter((x) => !dec(x.q).isZero() || !dec(x.v).isZero()).map((x) => ({
      productCode: x.product_code, name: x.name, unit: x.unit, warehouseId: x.warehouse_id, warehouseCode: x.warehouse_code, account: x.inventory_account ?? INV_ACCOUNTS.inventory,
      qty: r4(dec(x.q)).toFixed(4), value: r2(dec(x.v)).toFixed(2), avgCost: dec(x.q).gt(0) ? r4(dec(x.v).div(x.q)).toFixed(4) : '0.0000',
    }));
    const total = rows.reduce((a, x) => a.plus(x.value), dec('0'));
    return { asOf, rows, total: r2(total).toFixed(2), byAccount: [...r.byAccount].map(([account, v]) => ({ account, value: r2(v).toFixed(2) })) };
  });
}

/** สต็อกการ์ด: ยกมา · รายการ (รับ/จ่าย/ต้นทุน/คงเหลือสะสม) · คงเหลือ */
export async function stockCard(db: Db, companyId: string, p: { productCode: string; warehouseId?: string | null; from: string; to: string }) {
  if (!DATE_RE.test(p.from) || !DATE_RE.test(p.to)) throw new LedgerError('ช่วงวันที่ไม่ถูกต้อง');
  return db.withCompany(companyId, async (tx) => {
    const prod = (await productsTx(tx, [p.productCode])).get(p.productCode);
    if (!prod) throw new LedgerError('ไม่พบสินค้า');
    let ob = tx.selectFrom('acct.stock_move').select([sql<string>`coalesce(sum(qty), 0)`.as('q'), sql<string>`coalesce(sum(value), 0)`.as('v')]).where('product_code', '=', p.productCode).where('move_date', '<', p.from);
    if (p.warehouseId) ob = ob.where('warehouse_id', '=', p.warehouseId);
    const o = await ob.executeTakeFirstOrThrow();
    let q = tx.selectFrom('acct.stock_move as m').leftJoin('acct.document as d', (j) => j.onRef('d.id', '=', 'm.document_id').onRef('d.company_id', '=', 'm.company_id'))
      .innerJoin('acct.warehouse as w', (j) => j.onRef('w.id', '=', 'm.warehouse_id').onRef('w.company_id', '=', 'm.company_id'))
      .select(['m.id', 'm.move_date', 'm.kind', 'm.qty', 'm.unit_cost', 'm.value', 'm.reversal_of', 'm.lot', 'm.serial', 'd.doc_no', 'd.doc_type', 'w.code as warehouse_code'])
      .where('m.product_code', '=', p.productCode).where('m.move_date', '>=', p.from).where('m.move_date', '<=', p.to);
    if (p.warehouseId) q = q.where('m.warehouse_id', '=', p.warehouseId);
    const moves = await q.orderBy('m.move_date').orderBy('m.seq').execute();
    let bq = dec(o.q), bv = dec(o.v);
    const rows = moves.map((m) => {
      const mq = dec(m.qty);
      bq = bq.plus(mq); bv = bv.plus(m.value);
      return { date: m.move_date, docNo: m.doc_no, docType: m.doc_type, kind: m.kind, reversal: m.reversal_of !== null, warehouseCode: m.warehouse_code,
        qtyIn: mq.gt(0) ? r4(mq).toFixed(4) : '0.0000', qtyOut: mq.lt(0) ? r4(mq.neg()).toFixed(4) : '0.0000', unitCost: m.unit_cost, value: m.value,
        balanceQty: r4(bq).toFixed(4), balanceValue: r2(bv).toFixed(2), lot: m.lot, serial: m.serial };
    });
    return { product: { code: prod.code, name: prod.name, unit: prod.unit }, opening: { qty: r4(dec(o.q)).toFixed(4), value: r2(dec(o.v)).toFixed(2) }, rows,
      closing: { qty: r4(bq).toFixed(4), value: r2(bv).toFixed(2) } };
  });
}

/** สินค้าถึงจุดสั่งซื้อ (FR-IN-05): คงเหลือรวมทุกคลัง ≤ จุดสั่งซื้อ · แนะนำสั่ง = จุดสูงสุด − คงเหลือ (ไม่มีจุดสูงสุด = จุดสั่งซื้อ − คงเหลือ) */
export async function reorderReport(db: Db, companyId: string) {
  return db.withCompany(companyId, async (tx) => {
    const rows = await tx.selectFrom('acct.product as p').leftJoin('acct.stock_balance as b', (j) => j.onRef('b.product_code', '=', 'p.code').onRef('b.company_id', '=', 'p.company_id'))
      .select(['p.code', 'p.name', 'p.unit', 'p.reorder_point', 'p.max_qty', sql<string>`coalesce(sum(b.qty), 0)`.as('q')])
      .where('p.track_stock', '=', true).where('p.reorder_point', 'is not', null).groupBy(['p.code', 'p.name', 'p.unit', 'p.reorder_point', 'p.max_qty']).orderBy('p.code').execute();
    return rows.filter((r) => dec(r.q).lte(r.reorder_point!)).map((r) => {
      const target = dec(r.max_qty ?? r.reorder_point!);
      const suggest = target.minus(r.q);
      return { productCode: r.code, name: r.name, unit: r.unit, onHand: r4(dec(r.q)).toFixed(4), reorderPoint: r.reorder_point, maxQty: r.max_qty, suggestQty: r4(suggest.gt(0) ? suggest : dec('0')).toFixed(4) };
    });
  });
}

/**
 * รายงานสินค้าและวัตถุดิบ ตาม ม.87(3) — โครงเท่านั้น: ต่อสินค้า ยกมา · รับ/จ่าย (จำนวน) ตามวันที่และเลขที่เอกสาร · คงเหลือ
 * TODO(Wei): รูปแบบทางการ (แบบที่อธิบดีกำหนด) รอไฟล์แบบจากกรมสรรพากร — คอลัมน์/การจัดกลุ่มยังไม่ใช่ฉบับยื่นจริง
 */
export async function section87Report(db: Db, companyId: string, ym: string, opts: { warehouseId?: string | null } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(ym)) throw new LedgerError('ระบุเดือนเป็น YYYY-MM');
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const from = `${ym}-01`;
  const to = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const codes = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.product').select('code').where('track_stock', '=', true).orderBy('code').execute());
  const products = [];
  for (const c of codes) {
    const card = await stockCard(db, companyId, { productCode: c.code, warehouseId: opts.warehouseId ?? null, from, to });
    if (dec(card.opening.qty).isZero() && !card.rows.length) continue;
    products.push({ ...card.product, openingQty: card.opening.qty,
      rows: card.rows.map((r) => ({ date: r.date, docNo: r.docNo, docType: r.docType, qtyIn: r.qtyIn, qtyOut: r.qtyOut, balanceQty: r.balanceQty })), closingQty: card.closing.qty });
  }
  return { month: ym, from, to, pendingOfficialFormat: true, products };
}

/** ยอดคงเหลือปัจจุบัน (stock_balance) */
export async function stockBalances(db: Db, companyId: string, opts: { productCode?: string; warehouseId?: string } = {}) {
  return db.withCompany(companyId, async (tx) => {
    let q = tx.selectFrom('acct.stock_balance').selectAll();
    if (opts.productCode) q = q.where('product_code', '=', opts.productCode);
    if (opts.warehouseId) q = q.where('warehouse_id', '=', opts.warehouseId);
    return q.orderBy('product_code').execute();
  });
}

/** มูลค่าคงเหลือรวม ↔ ยอด GL บัญชีสินค้า ณ วันที่ (ใช้ใน reconChecks · inventory_control) */
export async function inventoryControlTx(tx: CompanyTx, companyId: string, asOf: string): Promise<{ enabled: boolean; method: InventorySettings['method']; valuation: MoneyString; gl: MoneyString; accounts: string[] } | null> {
  if (!(await inventoryOnTx(tx, companyId))) return null;
  const s = await inventorySettingsTx(tx);
  const r = await valuationRowsTx(tx, asOf, null);
  const accounts = [...new Set<string>([INV_ACCOUNTS.inventory, ...r.byAccount.keys()])];
  const gl = await glBalanceTx(tx, accounts, asOf);
  const val = [...r.byAccount.values()].reduce((a, v) => a.plus(v), dec('0'));
  const g = [...gl.values()].reduce((a, v) => a.plus(v), dec('0'));
  return { enabled: true, method: s.method, valuation: r2(val).toFixed(2), gl: r2(g).toFixed(2), accounts };
}
