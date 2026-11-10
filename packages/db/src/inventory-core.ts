// แกนสต็อก (Phase 2A INV · docs/technical-plan-P2A.md "INV") — ความเคลื่อนไหว + ต้นทุนถัวเฉลี่ยเคลื่อนที่ (สินค้า × คลัง · FR-IN-01)
// ใช้ได้ทั้งจากเอกสารสต็อก (inventory.ts) และจุดเชื่อมในขาย/ซื้อ (sales.ts / purchase.ts) — ไฟล์นี้ไม่ import sales/purchase (กัน import วน)
// กติกา:
//   · โมดูลปิด (public.company.modules.inventory ≠ true) → ทุกจุดเชื่อมคืน null = พฤติกรรม Phase 1 เดิม
//   · stock_balance ปรับใน transaction เดียวกับ stock_move · ล็อกต่อสินค้า (advisory xact lock) + แถว stock_balance FOR UPDATE
//   · ห้ามติดลบ (เว้นคลัง allow_negative) · รายการย้อนวันที่ → คำนวณต้นทุนใหม่ไปข้างหน้า (replay) เฉพาะเมื่อรายการที่ต้นทุนเปลี่ยนอยู่ในงวดที่เปิด
//   · perpetual: ต้นทุนของรายการที่ลง GL แล้วเปลี่ยน → JV ปรับ (acct.inventory_journal kind recost) · periodic: ไม่ลงต่อรายการ (ปรับปลายงวด)
import { canPost, INVENTORY_RULES, Money, post, type CompanyRole, type JournalLine, type PeriodStatus, type PostingLineInput, type RuleDefinition } from '@innovera/ledger';
import { Decimal } from 'decimal.js';
import { sql } from 'kysely';
import type { CompanyTx } from './index.ts';
import { LedgerError, postJournalTx } from './ledger-service.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = Decimal;
const dec = (s: string | number | null | undefined) => new D(s ?? 0);
const r2 = (d: Dec) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r4 = (d: Dec) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
/** Decimal (ปัด 2 ตำแหน่งแล้ว) → Money */
export const money = (d: Dec): Money => Money.of(r2(d).toFixed(2));
const QTY_RE = /^\d+(\.\d{1,4})?$/u;

/** บัญชีของโมดูล (สร้างตอนเปิดโมดูล · upsert ไม่ทับชื่อที่ผู้ใช้แก้) */
export const INV_ACCOUNTS = { inventory: '1200100', grir: '2130100', cogs: '5020100', countVariance: '5020900' } as const;
export const INVENTORY_ACCOUNT_LIST = [
  { code: INV_ACCOUNTS.inventory, name: 'สินค้าคงเหลือ', type: 'asset' },
  { code: INV_ACCOUNTS.grir, name: 'สินค้ารับแล้วรอใบแจ้งหนี้', type: 'liability' },
  { code: INV_ACCOUNTS.cogs, name: 'ต้นทุนขาย', type: 'expense' },
  { code: INV_ACCOUNTS.countVariance, name: 'ผลต่างจากการตรวจนับ', type: 'expense' },
] as const;

// ---------- ค่าตั้ง [ผู้สอบบัญชี] (acct.company_setting) ----------
// TODO(Wei): ทั้ง 3 ค่าเป็นเรื่อง "รอผู้สอบบัญชี" (technical-plan-P2A ตาราง config) — ค่าตั้งต้นชั่วคราวตามตาราง ห้ามถือเป็นนโยบายบัญชีที่ยืนยันแล้ว
export const INVENTORY_SETTING_KEYS = { method: 'inventory.method', costing: 'inventory.costing', writedownNrv: 'inventory.writedown_nrv' } as const;
export const INVENTORY_DEFAULTS = { method: 'periodic', costing: 'avco', writedownNrv: false } as const;
export interface InventorySettings { method: 'periodic' | 'perpetual'; costing: 'avco' | 'fifo'; writedownNrv: boolean; pendingAuditor: true }

export async function inventorySettingsTx(tx: CompanyTx): Promise<InventorySettings> {
  const rows = await tx.selectFrom('acct.company_setting').select(['key', 'value']).where('key', 'in', Object.values(INVENTORY_SETTING_KEYS)).execute();
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const m = get(INVENTORY_SETTING_KEYS.method);
  const c = get(INVENTORY_SETTING_KEYS.costing);
  const w = get(INVENTORY_SETTING_KEYS.writedownNrv);
  return {
    method: m === 'perpetual' || m === 'periodic' ? m : INVENTORY_DEFAULTS.method,
    costing: c === 'fifo' || c === 'avco' ? c : INVENTORY_DEFAULTS.costing,
    writedownNrv: typeof w === 'boolean' ? w : INVENTORY_DEFAULTS.writedownNrv,
    pendingAuditor: true,
  };
}
/** FIFO (FR-IN-08) เป็น P3 — ยังไม่มี cost layer */
export function assertAvco(s: InventorySettings): void {
  if (s.costing !== 'avco') throw new LedgerError('วิธีต้นทุน FIFO ยังไม่รองรับ (Phase 3 · FR-IN-08) — ตั้ง inventory.costing = avco');
}

/** โมดูลสต็อกเปิดอยู่หรือไม่ (public.company.modules.inventory) */
export async function inventoryOnTx(tx: CompanyTx, companyId: string): Promise<boolean> {
  const r = await sql<{ enabled: boolean | null }>`select (modules->>'inventory')::boolean as enabled from public.company where id = ${companyId}`.execute(tx);
  return r.rows[0]?.enabled === true;
}

/** สูตรของโมดูล: version ที่บริษัทบันทึกไว้ (ถ้ามี) หรือสูตรตั้งต้นใน INVENTORY_RULES */
export async function inventoryRuleTx(tx: CompanyTx, code: string): Promise<{ def: RuleDefinition; versionId: string | null }> {
  const v = await tx.selectFrom('acct.posting_rule as r').innerJoin('acct.posting_rule_version as v', (j) => j.onRef('v.rule_id', '=', 'r.id').onRef('v.company_id', '=', 'r.company_id'))
    .select(['v.id', 'v.definition']).where('r.code', '=', code).orderBy('v.version', 'desc').executeTakeFirst();
  if (v) return { def: v.definition as RuleDefinition, versionId: v.id };
  const d = INVENTORY_RULES.find((r) => r.code === code);
  if (!d) throw new LedgerError(`ไม่พบสูตร ${code}`);
  return { def: d, versionId: null };
}

/** งวดของวันที่ต้องลงรายการได้ (ใช้กับเอกสารสต็อกที่ไม่มี journal เช่น โอนคลัง / periodic) */
export async function assertCanPostOn(tx: CompanyTx, date: string, role: CompanyRole): Promise<{ fiscal_year: number; period_no: number; status: string }> {
  const p = await tx.selectFrom('acct.period').select(['fiscal_year', 'period_no', 'status']).where('starts_on', '<=', date).where('ends_on', '>=', date)
    .where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirst();
  if (!p) throw new LedgerError(`ไม่มีงวดบัญชีสำหรับวันที่ ${date}`);
  const ok = canPost(p.status as PeriodStatus, role);
  if (!ok.ok) throw new LedgerError(ok.reason);
  return p;
}

// ---------- สินค้า / หน่วยนับ / คลัง ----------

export interface StockProduct { code: string; name: string; unit: string | null; kind: string; track_stock: boolean; inventory_account: string | null; cogs_account: string | null }
export async function productsTx(tx: CompanyTx, codes: readonly string[]): Promise<Map<string, StockProduct>> {
  if (!codes.length) return new Map();
  const rows = await tx.selectFrom('acct.product').select(['code', 'name', 'unit', 'kind', 'track_stock', 'inventory_account', 'cogs_account']).where('code', 'in', [...new Set(codes)]).execute();
  return new Map(rows.map((r) => [r.code, r]));
}
export const invAccountOf = (p: StockProduct) => p.inventory_account ?? INV_ACCOUNTS.inventory;
export const cogsAccountOf = (p: StockProduct) => p.cogs_account ?? INV_ACCOUNTS.cogs;

/** จำนวนในหน่วยของบรรทัด → หน่วยนับหลัก (product.unit) · หน่วยว่าง/เท่าหน่วยหลัก = 1 */
export async function baseQtyTx(tx: CompanyTx, p: StockProduct, qty: string, unit: string | null | undefined): Promise<Dec> {
  if (!QTY_RE.test(qty.replace(/^-/u, ''))) throw new LedgerError(`จำนวนของ ${p.code} ไม่ถูกต้อง "${qty}"`);
  if (!unit || unit === p.unit) return dec(qty);
  const u = await tx.selectFrom('acct.product_unit').select('factor').where('product_code', '=', p.code).where('unit', '=', unit).executeTakeFirst();
  if (!u) throw new LedgerError(`สินค้า ${p.code} ไม่มีหน่วย "${unit}" — ตั้งหน่วยนับเพิ่มก่อน`);
  return dec(qty).times(u.factor);
}

export async function defaultWarehouseTx(tx: CompanyTx): Promise<string> {
  const w = await tx.selectFrom('acct.warehouse').select('id').where('is_default', '=', true).executeTakeFirst();
  if (!w) throw new LedgerError('ยังไม่ได้ตั้งคลังสินค้าตั้งต้น — เปิดโมดูลสต็อกก่อน');
  return w.id;
}

// ---------- ความเคลื่อนไหว + replay ต้นทุนถัวเฉลี่ย ----------

export type MoveKind = 'receipt' | 'purchase' | 'sale' | 'issue' | 'transfer_out' | 'transfer_in' | 'adjust' | 'price_variance';
export interface NewMove {
  date: string;
  product: StockProduct;
  warehouseId: string;
  kind: MoveKind;
  qty: Dec;                       // + เข้า / − ออก / 0 = ปรับมูลค่า
  costMode: 'fixed' | 'avg' | 'pair' | 'reverse';
  value?: Dec;                    // fixed เท่านั้น (มีเครื่องหมาย)
  pairIndex?: number;             // pair: index ของรายการโอนออกในชุดเดียวกัน
  reversalOf?: string;            // reverse: รายการต้นฉบับ
  documentId: string | null;
  documentLineId?: string | null;
  glAccount: string | null;       // บัญชีคู่ใน GL (perpetual) · null = ไม่ปรับ GL เมื่อต้นทุนเปลี่ยน
  lot?: string | null;
  serial?: string | null;
}
export interface StockCtx { companyId: string; role: CompanyRole; perpetual: boolean; label: string; documentId: string | null }

interface Change { id: string; date: string; product: StockProduct; glAccount: string; delta: Dec }

/**
 * บันทึกความเคลื่อนไหวชุดหนึ่ง แล้ว replay ต้นทุนของสินค้าที่เกี่ยวข้องตั้งแต่วันที่เร็วสุดของชุด
 * คืนมูลค่า (มีเครื่องหมาย) ของรายการใหม่ตามลำดับที่ส่งเข้า
 */
export async function applyMovesTx(tx: CompanyTx, ctx: StockCtx, moves: readonly NewMove[]): Promise<{ ids: string[]; values: Dec[] }> {
  const ids: string[] = [];
  // ล็อกต่อสินค้า (เรียงรหัสกัน deadlock) ก่อนเขียน
  const products = [...new Map(moves.map((m) => [m.product.code, m.product])).values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const p of products) await sql`select pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:stock:${p.code}`}))`.execute(tx);
  for (const m of moves) {
    if (m.costMode === 'pair' && (m.pairIndex === undefined || !ids[m.pairIndex])) throw new LedgerError('รายการโอนเข้าต้องจับคู่กับรายการโอนออก');
    if (m.costMode === 'reverse' && !m.reversalOf) throw new LedgerError('รายการกลับต้องอ้างรายการต้นฉบับ');
    const value = m.costMode === 'fixed' ? r2(m.value ?? dec(0)) : dec(0);
    const r = await tx.insertInto('acct.stock_move').values({
      company_id: ctx.companyId, move_date: m.date, product_code: m.product.code, warehouse_id: m.warehouseId, kind: m.kind, qty: r4(m.qty).toFixed(4),
      unit_cost: m.qty.isZero() ? '0' : r4(value.div(m.qty).abs()).toFixed(4), value: value.toFixed(2), cost_mode: m.costMode,
      document_id: m.documentId, document_line_id: m.documentLineId ?? null, journal_id: null, gl_account: m.glAccount, journal_value: null,
      pair_move_id: m.costMode === 'pair' ? ids[m.pairIndex!]! : null, reversal_of: m.reversalOf ?? null, lot: m.lot ?? null, serial: m.serial ?? null,
    }).returning('id').executeTakeFirstOrThrow();
    ids.push(r.id);
  }
  const fresh = new Set(ids);
  const changes: Change[] = [];
  for (const p of products) {
    const from = moves.filter((m) => m.product.code === p.code).map((m) => m.date).sort()[0]!;
    changes.push(...(await replayTx(tx, ctx, p, from, fresh)));
  }
  await postRecostTx(tx, ctx, changes);
  const rows = await tx.selectFrom('acct.stock_move').select(['id', 'value']).where('id', 'in', ids).execute();
  const byId = new Map(rows.map((r) => [r.id, dec(r.value)]));
  return { ids, values: ids.map((id) => byId.get(id)!) };
}

interface WhState { q: Dec; v: Dec; lastAvg: Dec }

/** คำนวณมูลค่าใหม่ของทุกรายการของสินค้าตั้งแต่วันที่ from (ทุกคลัง เรียง วันที่ → seq) · ปรับ stock_balance · คืนรายการเดิมที่มูลค่าเปลี่ยน */
async function replayTx(tx: CompanyTx, ctx: StockCtx, p: StockProduct, from: string, fresh: ReadonlySet<string>): Promise<Change[]> {
  await sql`insert into acct.stock_balance (company_id, product_code, warehouse_id)
    select distinct company_id, product_code, warehouse_id from acct.stock_move where product_code = ${p.code} and move_date >= ${from}
    on conflict do nothing`.execute(tx);
  await tx.selectFrom('acct.stock_balance').select(['warehouse_id']).where('product_code', '=', p.code).forUpdate().execute();
  const whs = await tx.selectFrom('acct.warehouse').select(['id', 'code', 'allow_negative']).execute();
  const wh = new Map(whs.map((w) => [w.id, w]));
  const before = await tx.selectFrom('acct.stock_move').select(['warehouse_id', sql<string>`sum(qty)`.as('q'), sql<string>`sum(value)`.as('v')])
    .where('product_code', '=', p.code).where('move_date', '<', from).groupBy('warehouse_id').execute();
  const last = await sql<{ warehouse_id: string; unit_cost: string }>`select distinct on (warehouse_id) warehouse_id, unit_cost from acct.stock_move
    where product_code = ${p.code} and move_date < ${from} and qty <> 0 order by warehouse_id, move_date desc, seq desc`.execute(tx);
  const state = new Map<string, WhState>();
  const st = (w: string): WhState => {
    let s = state.get(w);
    if (!s) { s = { q: dec(0), v: dec(0), lastAvg: dec(0) }; state.set(w, s); }
    return s;
  };
  for (const b of before) {
    const s = st(b.warehouse_id);
    s.q = dec(b.q); s.v = dec(b.v);
    s.lastAvg = s.q.gt(0) ? s.v.div(s.q) : dec(last.rows.find((x) => x.warehouse_id === b.warehouse_id)?.unit_cost ?? 0);
  }
  const moves = await tx.selectFrom('acct.stock_move').selectAll().where('product_code', '=', p.code).where('move_date', '>=', from).orderBy('move_date').orderBy('seq').execute();
  const newValue = new Map<string, Dec>();
  const valueOf = async (id: string): Promise<Dec> => {
    const hit = newValue.get(id);
    if (hit) return hit;
    const r = await tx.selectFrom('acct.stock_move').select('value').where('id', '=', id).executeTakeFirstOrThrow();
    return dec(r.value);
  };
  const changes: Change[] = [];
  for (const m of moves) {
    const s = st(m.warehouse_id);
    const q = dec(m.qty);
    let v: Dec;
    if (m.cost_mode === 'fixed') v = dec(m.value);
    else if (m.cost_mode === 'pair') v = (await valueOf(m.pair_move_id!)).neg();
    else if (m.cost_mode === 'reverse') v = (await valueOf(m.reversal_of!)).neg();
    else if (q.lt(0)) {
      const out = q.neg();
      // ออกหมดพอดี = มูลค่าคงเหลือทั้งหมด (ไม่เหลือเศษสตางค์) · อื่น ๆ = ตามสัดส่วน ปัด 2 ตำแหน่ง
      if (s.q.gt(0)) v = out.equals(s.q) ? s.v.neg() : r2(s.v.times(out).div(s.q)).neg();
      else v = r2(s.lastAvg.times(out)).neg(); // TODO(Wei): ต้นทุนเมื่อจ่ายออกขณะคงเหลือ ≤ 0 (คลัง allow_negative) ใช้ต้นทุนเฉลี่ยล่าสุด
    } else if (q.gt(0)) v = r2((s.q.gt(0) ? s.v.div(s.q) : s.lastAvg).times(q));
    else v = dec(0);
    newValue.set(m.id, v);
    s.q = s.q.plus(q);
    s.v = s.v.plus(v);
    if (s.q.gt(0)) s.lastAvg = s.v.div(s.q);
    const w = wh.get(m.warehouse_id);
    if (s.q.lt(0) && !w?.allow_negative) {
      throw new LedgerError(`สินค้า ${p.code} ${p.name} คลัง ${w?.code ?? ''} คงเหลือไม่พอ ณ วันที่ ${m.move_date} (ขาด ${s.q.neg().toFixed()}) — คลังนี้ไม่อนุญาตให้ติดลบ`);
    }
    const old = dec(m.value);
    if (fresh.has(m.id) || !old.equals(v)) {
      await tx.updateTable('acct.stock_move').set({ value: v.toFixed(2), unit_cost: q.isZero() ? '0' : r4(v.div(q).abs()).toFixed(4) }).where('id', '=', m.id).execute();
      if (!fresh.has(m.id)) {
        changes.push(...(m.gl_account ? [{ id: m.id, date: m.move_date, product: p, glAccount: m.gl_account, delta: v.minus(old) }] : []));
        // ต้นทุนของรายการในงวดที่ปิดแล้วห้ามเปลี่ยน (คำนวณย้อนหลังได้ภายในงวดที่เปิดเท่านั้น)
        const per = await tx.selectFrom('acct.period').select(['status', 'period_no', 'fiscal_year']).where('starts_on', '<=', m.move_date).where('ends_on', '>=', m.move_date)
          .where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirst();
        if (per && per.status !== 'open') throw new LedgerError(`${ctx.label}: ต้นทุนของ ${p.code} วันที่ ${m.move_date} (งวด ${per.period_no}/${per.fiscal_year} ปิดแล้ว) จะเปลี่ยน — เปิดงวดคืนก่อนลงรายการย้อนหลัง`);
      }
    }
  }
  for (const [w, s] of state) {
    await tx.updateTable('acct.stock_balance').set({ qty: r4(s.q).toFixed(4), value: r2(s.v).toFixed(2), avg_cost: r4(s.q.gt(0) ? s.v.div(s.q) : s.lastAvg).toFixed(4), updated_at: new Date() })
      .where('product_code', '=', p.code).where('warehouse_id', '=', w).execute();
  }
  return changes;
}

/** ผลต่างฝั่งบัญชีสินค้า (+ = เพิ่มสินค้า) → บรรทัด JV ระหว่างบัญชีสินค้ากับบัญชีคู่ */
function deltaLines(groups: Map<string, Dec>): JournalLine[] {
  const lines: JournalLine[] = [];
  for (const [key, d] of groups) {
    if (d.isZero()) continue;
    const [inv, counter] = key.split('|') as [string, string];
    const amount = money(d.abs());
    if (d.gt(0)) lines.push({ side: 'Dr', account: inv, amount }, { side: 'Cr', account: counter, amount });
    else lines.push({ side: 'Dr', account: counter, amount }, { side: 'Cr', account: inv, amount });
  }
  return mergeLines(lines);
}
/** รวมบรรทัดฝั่งเดียวกัน-บัญชีเดียวกัน-คู่ค้าเดียวกัน (คงลำดับ) */
export function mergeLines(lines: readonly JournalLine[]): JournalLine[] {
  const out: JournalLine[] = [];
  for (const l of lines) {
    const i = out.findIndex((o) => o.side === l.side && o.account === l.account && o.contactId === l.contactId);
    if (i >= 0) out[i] = { ...out[i]!, amount: out[i]!.amount.plus(l.amount) };
    else out.push(l);
  }
  return out.filter((l) => !l.amount.isZero());
}

/** perpetual: JV ปรับต้นทุนของรายการเดิมที่เปลี่ยนจากการลงย้อนหลัง · 1 JV ต่องวด ลงวันที่ของรายการล่าสุดที่เปลี่ยนในงวด */
async function postRecostTx(tx: CompanyTx, ctx: StockCtx, changes: readonly Change[]) {
  if (!ctx.perpetual || !changes.length) return;
  const periods = new Map<string, { date: string; groups: Map<string, Dec>; moves: string[] }>();
  for (const c of changes) {
    const p = await tx.selectFrom('acct.period').select(['fiscal_year', 'period_no']).where('starts_on', '<=', c.date).where('ends_on', '>=', c.date)
      .where('period_no', '>=', 1).where('period_no', '<=', 12).executeTakeFirstOrThrow();
    const k = `${p.fiscal_year}-${p.period_no}`;
    const g = periods.get(k) ?? { date: c.date, groups: new Map<string, Dec>(), moves: [] };
    if (c.date > g.date) g.date = c.date;
    const key = `${invAccountOf(c.product)}|${c.glAccount}`;
    g.groups.set(key, (g.groups.get(key) ?? dec(0)).plus(c.delta));
    g.moves.push(c.id);
    periods.set(k, g);
  }
  for (const g of periods.values()) {
    const lines = deltaLines(g.groups);
    if (!lines.length) continue;
    const j = await postJournalTx(tx, ctx.companyId, { date: g.date, lines, role: ctx.role, book: 'GJ', description: `ปรับต้นทุนถัวเฉลี่ยจากรายการย้อนหลัง (${ctx.label})` });
    const per = await tx.selectFrom('acct.journal').select(['fiscal_year', 'period_no']).where('id', '=', j.id).executeTakeFirstOrThrow();
    await tx.insertInto('acct.inventory_journal').values({ company_id: ctx.companyId, journal_id: j.id, kind: 'recost', document_id: ctx.documentId, fiscal_year: per.fiscal_year, period_no: per.period_no,
      detail: JSON.stringify({ moves: g.moves }) }).execute();
  }
}

/** ผูกรายการกับ journal ของเอกสาร · journal_value = มูลค่าที่อยู่ใน journal นั้น (ใช้ตอนยกเลิก) */
export async function linkMovesTx(tx: CompanyTx, ids: readonly string[], journalId: string | null, inJournal: (index: number) => boolean) {
  for (const [i, id] of ids.entries()) {
    const row = await tx.selectFrom('acct.stock_move').select('value').where('id', '=', id).executeTakeFirstOrThrow();
    await tx.updateTable('acct.stock_move').set({ journal_id: journalId, journal_value: journalId && inJournal(i) ? row.value : null }).where('id', '=', id).execute();
  }
}

// ---------- จุดเชื่อม: ขาย (IV / ขายสด) ----------

export interface DocLike { id: string; doc_type: string; issue_date: string; warehouse_id: string | null; ref_document_id: string | null; doc_no: string | null }

/**
 * ใบกำกับ/ขายสดที่มีบรรทัดสินค้า track_stock → ตัดสต็อก (ต้นทุนถัวเฉลี่ย ณ วันที่ขาย)
 * perpetual: คืนบรรทัด Dr ต้นทุนขาย / Cr สินค้าคงเหลือ (สูตร Stock[COGS]) ให้รวมใน journal ของใบขาย · periodic: ไม่มีบรรทัด
 * โมดูลปิด / ไม่มีบรรทัดสินค้า → null (Phase 1 เดิม)
 */
export async function saleStockTx(tx: CompanyTx, companyId: string, role: CompanyRole, d: DocLike, docNo: string): Promise<{ lines: JournalLine[]; link: (journalId: string) => Promise<void> } | null> {
  if (d.doc_type !== 'IV' || !(await inventoryOnTx(tx, companyId))) return null;
  const rows = await tx.selectFrom('acct.document_line as l').innerJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'l.product_code').onRef('p.company_id', '=', 'l.company_id'))
    .select(['l.id', 'l.product_code', 'l.qty', 'l.unit']).where('l.document_id', '=', d.id).where('l.line_type', '=', 'item').where('p.track_stock', '=', true).orderBy('l.line_no').execute();
  if (!rows.length) return null;
  const s = await inventorySettingsTx(tx);
  assertAvco(s);
  const perpetual = s.method === 'perpetual';
  const prods = await productsTx(tx, rows.map((r) => r.product_code!));
  const wh = d.warehouse_id ?? (await defaultWarehouseTx(tx));
  const moves: NewMove[] = [];
  for (const r of rows) {
    const p = prods.get(r.product_code!)!;
    const q = await baseQtyTx(tx, p, r.qty ?? '0', r.unit);
    moves.push({ date: d.issue_date, product: p, warehouseId: wh, kind: 'sale', qty: q.neg(), costMode: 'avg', documentId: d.id, documentLineId: r.id, glAccount: perpetual ? cogsAccountOf(p) : null });
  }
  const res = await applyMovesTx(tx, { companyId, role, perpetual, label: docNo, documentId: d.id }, moves);
  let lines: JournalLine[] = [];
  if (perpetual) {
    const { def } = await inventoryRuleTx(tx, 'Stock[COGS]');
    const pl: PostingLineInput[] = moves.map((m, i) => ({ amounts: { value: money(res.values[i]!.abs()).toString() }, account: m.glAccount!, productAccount: invAccountOf(m.product) }));
    lines = pl.some((x) => !Money.of(x.amounts.value!).isZero()) ? post(def, { docType: 'COGS', amounts: {}, lines: pl }) : [];
  }
  return { lines, link: (journalId) => linkMovesTx(tx, res.ids, journalId, () => perpetual) };
}

// ---------- จุดเชื่อม: ซื้อ (AP) ----------

export interface PurchaseLineRow { id: string; amount: string; account_code: string | null; product_code: string | null; qty: string | null; unit: string | null }

/**
 * บิลซื้อ (AP) ที่มีบรรทัดสินค้า track_stock:
 *  · ไม่อ้าง GR → รับเข้าสต็อก มูลค่า = ยอดบรรทัด · Dr บัญชีสินค้าคงเหลือแทนบัญชีค่าใช้จ่ายของบรรทัด
 *  · อ้าง GR (ref_document_id = GR) → ไม่รับเข้าซ้ำ · Dr 2130100 ตามมูลค่าที่รับ (ตามสัดส่วนจำนวน · ครั้งสุดท้ายรับเศษ) · ผลต่างราคา → บัญชีสินค้า + รายการปรับมูลค่า
 * คืนบรรทัดสำหรับ Posting Engine (แทน lines เดิม) + บรรทัดเพิ่ม (ผลต่างราคาติดลบ) · โมดูลปิด/ไม่มีสินค้า → null
 * TODO(Wei): ผลต่างราคาเข้าต้นทุนสินค้าทั้งจำนวน แม้สินค้าบางส่วนขายไปแล้ว (ทางเลือก: แบ่งเข้าต้นทุนขาย) · ส่วนลดท้ายบิลยังไม่กระจายเข้าต้นทุน
 */
export async function purchaseStockTx(tx: CompanyTx, companyId: string, role: CompanyRole, d: DocLike, docNo: string, lines: readonly PurchaseLineRow[]):
  Promise<{ postingLines: PostingLineInput[]; extra: JournalLine[]; link: (journalId: string) => Promise<void> } | null> {
  if (d.doc_type !== 'AP' || !(await inventoryOnTx(tx, companyId))) return null;
  const prods = await productsTx(tx, lines.map((l) => l.product_code).filter((c): c is string => Boolean(c)));
  const stockLines = lines.filter((l) => l.product_code && prods.get(l.product_code)?.track_stock);
  if (!stockLines.length) return null;
  const s = await inventorySettingsTx(tx);
  assertAvco(s);
  const gr = d.ref_document_id
    ? await tx.selectFrom('acct.document').select(['id', 'doc_no', 'status']).where('id', '=', d.ref_document_id).where('doc_type', '=', 'GR').executeTakeFirst()
    : undefined;
  if (gr && gr.status !== 'posted') throw new LedgerError(`ใบรับสินค้า ${gr.doc_no ?? ''} ยังไม่ผ่านรายการหรือถูกยกเลิก`);
  const grMoves = gr ? await tx.selectFrom('acct.stock_move').select(['product_code', 'warehouse_id', 'qty', 'value']).where('document_id', '=', gr.id).where('kind', '=', 'receipt').where('reversal_of', 'is', null).execute() : [];
  // ที่ล้างไปแล้วโดยบิลซื้อใบอื่นที่อ้าง GR เดียวกัน (ผ่านรายการ ไม่ถูกยกเลิก)
  const prevBills = gr ? await tx.selectFrom('acct.document as b').innerJoin('acct.document_line as l', (j) => j.onRef('l.document_id', '=', 'b.id').onRef('l.company_id', '=', 'b.company_id'))
    .select(['l.product_code', 'l.qty', 'l.unit', 'l.grir_amount']).where('b.ref_document_id', '=', gr.id).where('b.doc_type', '=', 'AP').where('b.status', '=', 'posted').where('b.id', '<>', d.id)
    .where('l.grir_amount', 'is not', null).execute() : [];
  const billed = new Map<string, { q: Dec; v: Dec }>();
  for (const b of prevBills) {
    const p = prods.get(b.product_code!) ?? (await productsTx(tx, [b.product_code!])).get(b.product_code!)!;
    const cur = billed.get(p.code) ?? { q: dec(0), v: dec(0) };
    billed.set(p.code, { q: cur.q.plus(await baseQtyTx(tx, p, b.qty ?? '0', b.unit)), v: cur.v.plus(dec(b.grir_amount)) });
  }
  const postingLines: PostingLineInput[] = [];
  const extra: JournalLine[] = [];
  const moves: NewMove[] = [];
  const inJournal: boolean[] = [];
  const whDefault = d.warehouse_id ?? (await defaultWarehouseTx(tx));
  for (const l of lines) {
    const p = l.product_code ? prods.get(l.product_code) : undefined;
    if (!p?.track_stock) { postingLines.push({ amounts: { amount: l.amount }, ...(l.account_code ? { account: l.account_code } : {}) }); continue; }
    const q = await baseQtyTx(tx, p, l.qty ?? '0', l.unit);
    const amount = dec(l.amount);
    const gm = grMoves.filter((m) => m.product_code === p.code);
    if (gr && gm.length) {
      const grQ = gm.reduce((a, m) => a.plus(dec(m.qty)), dec(0));
      const grV = gm.reduce((a, m) => a.plus(dec(m.value)), dec(0));
      const prev = billed.get(p.code) ?? { q: dec(0), v: dec(0) };
      const after = prev.q.plus(q);
      if (after.gt(grQ)) throw new LedgerError(`บิลซื้อ ${p.code} จำนวน ${after.toFixed()} เกินที่รับตาม ${gr.doc_no ?? 'GR'} (${grQ.toFixed()})`);
      const portion = after.equals(grQ) ? grV.minus(prev.v) : r2(grV.times(q).div(grQ));
      billed.set(p.code, { q: after, v: prev.v.plus(portion) });
      await tx.updateTable('acct.document_line').set({ grir_amount: portion.toFixed(2) }).where('id', '=', l.id).execute();
      const variance = amount.minus(portion);
      if (variance.gte(0)) {
        postingLines.push({ amounts: { amount: portion.toFixed(2) }, account: INV_ACCOUNTS.grir });
        if (variance.gt(0)) postingLines.push({ amounts: { amount: variance.toFixed(2) }, account: invAccountOf(p) });
      } else {
        postingLines.push({ amounts: { amount: amount.toFixed(2) }, account: INV_ACCOUNTS.grir });
        extra.push({ side: 'Dr', account: INV_ACCOUNTS.grir, amount: money(variance.abs()) }, { side: 'Cr', account: invAccountOf(p), amount: money(variance.abs()) });
      }
      if (!variance.isZero()) {
        moves.push({ date: d.issue_date, product: p, warehouseId: gm[0]!.warehouse_id, kind: 'price_variance', qty: dec(0), costMode: 'fixed', value: variance, documentId: d.id, documentLineId: l.id, glAccount: null });
        inJournal.push(true);
      }
    } else {
      postingLines.push({ amounts: { amount: l.amount }, account: invAccountOf(p) });
      moves.push({ date: d.issue_date, product: p, warehouseId: whDefault, kind: 'purchase', qty: q, costMode: 'fixed', value: amount, documentId: d.id, documentLineId: l.id, glAccount: null });
      inJournal.push(true);
    }
  }
  const res = moves.length ? await applyMovesTx(tx, { companyId, role, perpetual: s.method === 'perpetual', label: docNo, documentId: d.id }, moves) : { ids: [], values: [] };
  return { postingLines, extra, link: (journalId) => linkMovesTx(tx, res.ids, journalId, (i) => inJournal[i] ?? false) };
}

// ---------- จุดเชื่อม: ยกเลิกเอกสาร (voidDocumentTx) ----------

/**
 * ยกเลิกเอกสารที่มีความเคลื่อนไหวสต็อก → รายการกลับ (qty ตรงข้าม มูลค่า = −มูลค่าปัจจุบันของต้นฉบับ) ลงวันที่เดียวกับ JV กลับรายการ
 * journal ของเอกสารถูกกลับรายการด้วยมูลค่าตอนลง (journal_value) → ถ้าต้นทุนถูกปรับภายหลัง ลง JV ปรับส่วนต่าง (kind void_adjust)
 * ไม่มีความเคลื่อนไหว (โมดูลปิด) → ไม่ทำอะไร
 */
export async function reverseStockMovesTx(tx: CompanyTx, companyId: string, role: CompanyRole, docId: string, date: string, label: string): Promise<void> {
  const orig = await tx.selectFrom('acct.stock_move').selectAll().where('document_id', '=', docId).where('reversal_of', 'is', null).orderBy('seq').execute();
  if (!orig.length) return;
  const doc = await tx.selectFrom('acct.document').select(['doc_type']).where('id', '=', docId).executeTakeFirstOrThrow();
  if (doc.doc_type === 'GR') {
    const ap = await tx.selectFrom('acct.document').select('doc_no').where('ref_document_id', '=', docId).where('doc_type', '=', 'AP').where('status', '=', 'posted').execute();
    if (ap.length) throw new LedgerError(`มีบิลซื้ออ้างใบรับสินค้านี้ (${ap.map((a) => a.doc_no).join(', ')}) — ยกเลิกบิลซื้อก่อน`);
  }
  const done = await tx.selectFrom('acct.stock_move').select('id').where('reversal_of', 'in', orig.map((m) => m.id)).execute();
  if (done.length) throw new LedgerError('ความเคลื่อนไหวสต็อกของเอกสารนี้ถูกกลับรายการแล้ว');
  const s = await inventorySettingsTx(tx);
  const prods = await productsTx(tx, orig.map((m) => m.product_code));
  if (!orig.some((m) => m.journal_id)) await assertCanPostOn(tx, date, role);
  const ctx: StockCtx = { companyId, role, perpetual: s.method === 'perpetual', label: `ยกเลิก ${label}`, documentId: docId };
  const res = await applyMovesTx(tx, ctx, orig.map((m) => ({ date, product: prods.get(m.product_code)!, warehouseId: m.warehouse_id, kind: m.kind, qty: dec(m.qty).neg(), costMode: 'reverse' as const,
    reversalOf: m.id, documentId: docId, documentLineId: m.document_line_id, glAccount: m.gl_account, lot: m.lot, serial: m.serial })));
  await linkMovesTx(tx, res.ids, null, () => false);
  // ส่วนต่างระหว่างที่ JV กลับรายการ (journal_value) กับมูลค่าที่ต้องกลับจริง (−มูลค่าปัจจุบัน)
  const groups = new Map<string, Dec>();
  for (const [i, m] of orig.entries()) {
    if (m.journal_value === null || !m.gl_account) continue;
    const d = dec(m.journal_value).plus(res.values[i]!); // = journal_value − มูลค่าปัจจุบันของต้นฉบับ
    const key = `${invAccountOf(prods.get(m.product_code)!)}|${m.gl_account}`;
    groups.set(key, (groups.get(key) ?? dec(0)).plus(d));
  }
  const lines = deltaLines(groups);
  if (lines.length) {
    const j = await postJournalTx(tx, companyId, { date, lines, role, book: 'GJ', description: `ปรับต้นทุนตอนยกเลิก ${label}` });
    const per = await tx.selectFrom('acct.journal').select(['fiscal_year', 'period_no']).where('id', '=', j.id).executeTakeFirstOrThrow();
    await tx.insertInto('acct.inventory_journal').values({ company_id: companyId, journal_id: j.id, kind: 'void_adjust', document_id: docId, fiscal_year: per.fiscal_year, period_no: per.period_no, detail: '{}' }).execute();
  }
}
