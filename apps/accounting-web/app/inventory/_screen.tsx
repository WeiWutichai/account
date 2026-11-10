'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// สินค้าคงคลัง (Phase 2A INV) — คงเหลือ/มูลค่า ณ วันที่ · คลัง · ตั้งค่าสต็อกของสินค้า · ถึงจุดสั่งซื้อ · รายงาน ม.87(3) (โครง)
// ไม่มีไฟล์ .dc.html — ช่อง/ข้อความตั้งจาก API (packages/db/src/inventory.ts) · ค่าตั้งวิธีบันทึก/ต้นทุน = รอผู้สอบบัญชี (แก้ที่ /settings/modules)
import { Button, ButtonLink, css, href, money, parseThaiDate, S, Tag, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call, INV_TABS, Msg, normQty, qty, TempBanner, unitCost, type InvStatus, type ProductRow, type ProductUnit, type Warehouse } from './_shared/ui';

export interface Valuation {
  asOf: string; total: string; byAccount: { account: string; value: string }[];
  rows: { productCode: string; name: string; unit: string | null; warehouseId: string; warehouseCode: string; account: string; qty: string; value: string; avgCost: string }[];
}
export interface Reorder { productCode: string; name: string; unit: string | null; onHand: string; reorderPoint: string | null; maxQty: string | null; suggestQty: string }
export interface Section87 {
  month: string; from: string; to: string; pendingOfficialFormat: boolean;
  products: { code: string; name: string; unit: string | null; openingQty: string; closingQty: string; rows: { date: string; docNo: string | null; docType: string | null; qtyIn: string; qtyOut: string; balanceQty: string }[] }[];
}
interface Props {
  tab: string; status: InvStatus; asOf: string; month: string; warehouse: string; warehouses: Warehouse[]; valuation: Valuation;
  products: ProductRow[]; units: ProductUnit[]; reorder: Reorder[]; section87: Section87 | null;
}
type M = { kind: 'ok' | 'err'; text: string } | null;

const NUM = S.num;
const TD = S.td;
const ROW = 'height: 40px';
const SELECT = 'height: 40px; padding: 0 12px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const SMALL_INPUT = 'height: 32px; padding: 0 8px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; box-sizing: border-box; width: 100%';
const CHECK = 'display: flex; align-items: center; gap: 8px; font-size: 14px; color: #161616';

export function InventoryScreen(p: Props) {
  const router = useRouter();
  const qs = (patch: Record<string, string>) => {
    const u = new URLSearchParams({ tab: p.tab, asOf: p.asOf, month: p.month, ...(p.warehouse ? { warehouse: p.warehouse } : {}), ...patch });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return `${href('inventory')}?${u.toString()}`;
  };
  const s = p.status.settings;
  return (
    <>
      <TopBar crumb="โมดูลเพิ่มเติม / สินค้าคงคลัง" right={
        <div style={css('display: flex; gap: 8px')}>
          <ButtonLink href={href('stockdocs')} size={32}>เอกสารสต็อก</ButtonLink>
          <ButtonLink href={`${href('stockdocs')}?new=1`} size={32} kind="primary">+ สร้างเอกสาร</ButtonLink>
        </div>} />
      <div style={css(S.content)}>
        <TempBanner />
        <div>
          <h1 style={css(S.h1)}>สินค้าคงคลัง</h1>
          <span style={css(S.sub)}>
            {`วิธีบันทึก ${s.method === 'perpetual' ? 'ต่อเนื่อง (perpetual)' : 'สิ้นงวด (periodic)'} · ต้นทุนถัวเฉลี่ยเคลื่อนที่ · `}
            <a href={href('modules')} style={css('color: #0f62fe')}>ค่าตั้งรอผู้สอบบัญชียืนยัน</a>
          </span>
        </div>
        <nav aria-label="หัวข้อสินค้าคงคลัง" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap')}>
          {INV_TABS.map(([k, label]) => (
            <a key={k} href={qs({ tab: k })} aria-current={p.tab === k ? 'page' : undefined}
              style={css(`padding: 10px 16px; font-size: 14px; text-decoration: none; color: ${p.tab === k ? '#161616' : '#525252'}; border-bottom: 2px solid ${p.tab === k ? '#0f62fe' : 'transparent'}; font-weight: ${p.tab === k ? 600 : 400}`)}>{label}</a>
          ))}
        </nav>
        {p.tab === 'balances' && <Balances {...p} go={(patch) => router.push(qs(patch))} />}
        {p.tab === 'warehouses' && <Warehouses warehouses={p.warehouses} />}
        {p.tab === 'products' && <Products products={p.products} units={p.units} />}
        {p.tab === 'reorder' && <ReorderTable rows={p.reorder} />}
        {p.tab === 'section87' && <Section87View {...p} go={(patch) => router.push(qs(patch))} />}
      </div>
    </>
  );
}

function WarehouseSelect({ value, warehouses, onChange }: { value: string; warehouses: Warehouse[]; onChange: (v: string) => void }) {
  return (
    <label style={css(S.label)}>คลัง
      <select value={value} onChange={(e) => onChange(e.target.value)} style={css(SELECT)}>
        <option value="">ทุกคลัง</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{`${w.code} · ${w.name}`}</option>)}
      </select>
    </label>
  );
}

function Balances({ asOf, warehouse, warehouses, valuation, go }: Props & { go: (patch: Record<string, string>) => void }) {
  const [date, setDate] = useState(thaiDate(asOf));
  const [wh, setWh] = useState(warehouse);
  const [err, setErr] = useState<M>(null);
  const show = () => {
    const d = parseThaiDate(date);
    if (!d) { setErr({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    setErr(null);
    go({ asOf: d, warehouse: wh });
  };
  return (
    <>
      <div style={css('display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap')}>
        <label style={css(S.label)}>ณ วันที่<input value={date} onChange={(e) => setDate(e.target.value)} style={css(`${S.input}; width: 160px; font-variant-numeric: tabular-nums`)} /></label>
        <WarehouseSelect value={wh} warehouses={warehouses} onChange={setWh} />
        <Button kind="primary" onClick={show}>แสดง</Button>
      </div>
      <Msg msg={err} />
      <section style={css(S.tableBox)}>
        <table style={css(`${S.table}; min-width: 960px`)}>
          <thead><tr style={css(S.theadRow)}>
            <th style={css(S.thFirst)}>รหัสสินค้า</th><th style={css(S.th)}>ชื่อสินค้า</th><th style={css(S.th)}>คลัง</th><th style={css(S.th)}>หน่วย</th>
            <th style={css(`${S.th}; text-align: right`)}>คงเหลือ</th><th style={css(`${S.th}; text-align: right`)}>ต้นทุนเฉลี่ย/หน่วย</th><th style={css(`${S.th}; text-align: right`)}>มูลค่า</th><th style={css(S.th)}>บัญชี</th>
          </tr></thead>
          <tbody>
            {valuation.rows.map((r) => (
              <tr key={`${r.productCode}-${r.warehouseId}`} style={css(S.tr)}>
                <td style={css(`${ROW}; ${TD}`)}><a href={`/inventory/stock-card/${encodeURIComponent(r.productCode)}?warehouse=${r.warehouseId}&to=${asOf}`} style={css('color: #0f62fe')}>{r.productCode}</a></td>
                <td style={css(TD)}>{r.name}</td><td style={css(TD)}>{r.warehouseCode}</td><td style={css(TD)}>{r.unit ?? ''}</td>
                <td style={css(NUM)}>{qty(r.qty)}</td><td style={css(NUM)}>{unitCost(r.avgCost)}</td><td style={css(NUM)}>{money(r.value)}</td><td style={css(TD)}>{r.account}</td>
              </tr>
            ))}
            {!valuation.rows.length && <tr style={css(S.tr)}><td colSpan={8} style={css(`${ROW}; ${TD}; color: #525252`)}>ยังไม่มีสินค้าคงเหลือ ณ วันที่นี้</td></tr>}
          </tbody>
          <tfoot><tr style={css(S.tfoot)}><td colSpan={6} style={css(`${ROW}; ${TD}`)}>{`รวมมูลค่าสินค้าคงเหลือ ณ ${thaiDate(valuation.asOf)}`}</td><td style={css(NUM)}>{money(valuation.total)}</td><td /></tr></tfoot>
        </table>
      </section>
      {valuation.byAccount.length > 0 && (
        <p style={css(S.note)}>{`แยกตามบัญชี: ${valuation.byAccount.map((a) => `${a.account} ${money(a.value)}`).join(' · ')}`}</p>
      )}
    </>
  );
}

const EMPTY_WH = { id: '', code: '', name: '', branchCode: '00000', allowNegative: false, isDefault: false, active: true };

function Warehouses({ warehouses }: { warehouses: Warehouse[] }) {
  const router = useRouter();
  const [f, setF] = useState<typeof EMPTY_WH | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const edit = (w: Warehouse) => { setMsg(null); setF({ id: w.id, code: w.code, name: w.name, branchCode: w.branch_code, allowNegative: w.allow_negative, isDefault: w.is_default, active: w.active }); };
  async function save() {
    if (!f) return;
    setBusy(true); setMsg(null);
    const body = { code: f.code, name: f.name, branchCode: f.branchCode, allowNegative: f.allowNegative, isDefault: f.isDefault, active: f.active };
    const r = await call<{ id: string }>(f.id ? `inventory/warehouses/${f.id}` : 'inventory/warehouses', f.id ? 'PUT' : 'POST', body);
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `บันทึกคลัง ${f.code} แล้ว` });
    setF(null);
    router.refresh();
  }
  return (
    <>
      <div style={css('display: flex; justify-content: flex-end')}><Button size={36} kind="primary" onClick={() => { setMsg(null); setF({ ...EMPTY_WH }); }}>+ เพิ่มคลัง</Button></div>
      {f && (
        <section aria-label={f.id ? 'แก้ไขคลัง' : 'เพิ่มคลัง'} style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <label style={css(S.label)}>รหัสคลัง<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={css(S.input)} /></label>
          <label style={css(`grid-column: span 2; ${S.label}`)}>ชื่อคลัง<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={css(S.input)} /></label>
          <label style={css(S.label)}>รหัสสาขา (5 หลัก)<input value={f.branchCode} inputMode="numeric" maxLength={5} onChange={(e) => setF({ ...f, branchCode: e.target.value })} style={css(`${S.input}; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(CHECK)}><input type="checkbox" checked={f.allowNegative} onChange={(e) => setF({ ...f, allowNegative: e.target.checked })} />ยอมให้ติดลบ</label>
          <label style={css(CHECK)}><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />คลังตั้งต้น</label>
          <label style={css(CHECK)}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />ใช้งาน</label>
          <div style={css('display: flex; gap: 8px; justify-content: flex-end')}>
            <Button onClick={() => setF(null)}>ยกเลิก</Button>
            <Button kind="primary" disabled={busy || !f.code.trim() || !f.name.trim()} onClick={() => void save()}>บันทึก</Button>
          </div>
        </section>
      )}
      <Msg msg={msg} />
      <section style={css(S.tableBox)}>
        <table style={css(S.table)}>
          <thead><tr style={css(S.theadRow)}>
            <th style={css(S.thFirst)}>รหัสคลัง</th><th style={css(S.th)}>ชื่อคลัง</th><th style={css(S.th)}>รหัสสาขา</th><th style={css(S.th)}>ยอมให้ติดลบ</th><th style={css(S.th)}>คลังตั้งต้น</th><th style={css(S.th)}>สถานะ</th><th style={css(S.th)} />
          </tr></thead>
          <tbody>
            {warehouses.map((w) => (
              <tr key={w.id} style={css(S.tr)}>
                <td style={css(`${ROW}; ${TD}`)}>{w.code}</td><td style={css(TD)}>{w.name}</td><td style={css(`${TD}; font-variant-numeric: tabular-nums`)}>{w.branch_code}</td>
                <td style={css(TD)}>{w.allow_negative ? 'ได้' : 'ไม่ได้'}</td><td style={css(TD)}>{w.is_default ? <Tag kind="info">ตั้งต้น</Tag> : ''}</td>
                <td style={css(TD)}>{w.active ? <Tag kind="success">ใช้งาน</Tag> : <Tag kind="neutral">ปิดใช้</Tag>}</td>
                <td style={css(`${TD}; text-align: right`)}><Button size={32} kind="ghost" onClick={() => edit(w)}>แก้ไข</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

interface ProdDraft { track: boolean; reorder: string; max: string; barcode: string; units: string }
const unitsText = (us: ProductUnit[]) => us.map((u) => `${u.unit}=${qty(u.factor)}`).join(', ');
const draftOf = (p: ProductRow, us: ProductUnit[]): ProdDraft => ({ track: p.track_stock, reorder: qty(p.reorder_point), max: qty(p.max_qty), barcode: p.barcode ?? '', units: unitsText(us) });

function Products({ products, units }: { products: ProductRow[]; units: ProductUnit[] }) {
  const router = useRouter();
  const unitsOf = (code: string) => units.filter((u) => u.product_code === code);
  const [drafts, setDrafts] = useState<Record<string, ProdDraft>>(() => Object.fromEntries(products.map((p) => [p.code, draftOf(p, unitsOf(p.code))])));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<M>(null);
  const [onlyGoods, setOnlyGoods] = useState(true);
  const shown = products.filter((p) => !onlyGoods || p.kind === 'goods');
  async function save(p: ProductRow) {
    const d = drafts[p.code] ?? draftOf(p, unitsOf(p.code));
    setMsg(null);
    const reorder = d.reorder.trim() ? normQty(d.reorder) : null;
    const max = d.max.trim() ? normQty(d.max) : null;
    if ((d.reorder.trim() && !reorder) || (d.max.trim() && !max)) { setMsg({ kind: 'err', text: `${p.code}: จุดสั่งซื้อ/จำนวนสูงสุดต้องเป็นตัวเลข (ทศนิยมไม่เกิน 4 ตำแหน่ง)` }); return; }
    const parsed: { unit: string; factor: string }[] = [];
    for (const part of d.units.split(',').map((x) => x.trim()).filter(Boolean)) {
      const m = /^(.+?)\s*=\s*([\d,.]+)$/u.exec(part);
      const factor = m ? normQty(m[2]!) : null;
      if (!m || !factor) { setMsg({ kind: 'err', text: `${p.code}: หน่วยนับเพิ่มเติมเขียนเป็น หน่วย=ตัวคูณ คั่นด้วยจุลภาค เช่น กล่อง=10, แพ็ค=6` }); return; }
      parsed.push({ unit: m[1]!.trim(), factor });
    }
    setBusy(p.code);
    const r = await call(`inventory/products/${encodeURIComponent(p.code)}`, 'PUT', { trackStock: d.track, reorderPoint: reorder, maxQty: max, barcode: d.barcode.trim() || null, units: parsed });
    setBusy('');
    if (!r.ok) { setMsg({ kind: 'err', text: `${p.code}: ${r.error}` }); return; }
    setMsg({ kind: 'ok', text: `บันทึกค่าสต็อกของ ${p.code} แล้ว` });
    router.refresh();
  }
  const set = (code: string, patch: Partial<ProdDraft>) => {
    const p = products.find((x) => x.code === code)!;
    setDrafts({ ...drafts, [code]: { ...(drafts[code] ?? draftOf(p, unitsOf(code))), ...patch } });
  };
  return (
    <>
      <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap')}>
        <p style={css(S.note)}>ติดตามสต็อกได้เฉพาะรายการประเภทสินค้า (goods) · หน่วยนับเพิ่มเติมเขียนเป็น หน่วย=ตัวคูณเทียบหน่วยหลัก เช่น กล่อง=10 · เพิ่มสินค้าใหม่ที่หน้าสินค้าและบริการ</p>
        <label style={css(CHECK)}><input type="checkbox" checked={onlyGoods} onChange={(e) => setOnlyGoods(e.target.checked)} />แสดงเฉพาะประเภทสินค้า</label>
      </div>
      <Msg msg={msg} />
      <section style={css(S.tableBox)}>
        <table style={css(`${S.table}; min-width: 1100px`)}>
          <thead><tr style={css(S.theadRow)}>
            <th style={css(S.thFirst)}>รหัส</th><th style={css(S.th)}>ชื่อ</th><th style={css(S.th)}>หน่วยหลัก</th><th style={css(S.th)}>ติดตามสต็อก</th>
            <th style={css(`${S.th}; text-align: right`)}>จุดสั่งซื้อ</th><th style={css(`${S.th}; text-align: right`)}>จำนวนสูงสุด</th><th style={css(S.th)}>บาร์โค้ด</th><th style={css(S.th)}>หน่วยนับเพิ่มเติม</th><th style={css(S.th)} />
          </tr></thead>
          <tbody>
            {shown.map((p) => {
              const d = drafts[p.code] ?? draftOf(p, unitsOf(p.code));
              const orig = draftOf(p, unitsOf(p.code));
              const dirty = JSON.stringify(d) !== JSON.stringify(orig);
              return (
                <tr key={p.code} style={css(S.tr)}>
                  <td style={css(`${ROW}; ${TD}; white-space: nowrap`)}>{p.track_stock ? <a href={`/inventory/stock-card/${encodeURIComponent(p.code)}`} style={css('color: #0f62fe')}>{p.code}</a> : p.code}</td>
                  <td style={css(TD)}>{p.name}</td><td style={css(TD)}>{p.unit ?? ''}</td>
                  <td style={css(TD)}><label style={css(CHECK)}><input type="checkbox" checked={d.track} disabled={p.kind !== 'goods'} onChange={(e) => set(p.code, { track: e.target.checked })} aria-label={`ติดตามสต็อก ${p.code}`} />{p.kind === 'goods' ? '' : 'ไม่ใช่สินค้า'}</label></td>
                  <td style={css(`${TD}; width: 110px`)}><input aria-label={`จุดสั่งซื้อ ${p.code}`} value={d.reorder} inputMode="decimal" onChange={(e) => set(p.code, { reorder: e.target.value })} style={css(`${SMALL_INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} /></td>
                  <td style={css(`${TD}; width: 110px`)}><input aria-label={`จำนวนสูงสุด ${p.code}`} value={d.max} inputMode="decimal" onChange={(e) => set(p.code, { max: e.target.value })} style={css(`${SMALL_INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} /></td>
                  <td style={css(`${TD}; width: 160px`)}><input aria-label={`บาร์โค้ด ${p.code}`} value={d.barcode} onChange={(e) => set(p.code, { barcode: e.target.value })} style={css(`${SMALL_INPUT}; font-variant-numeric: tabular-nums`)} /></td>
                  <td style={css(`${TD}; width: 200px`)}><input aria-label={`หน่วยนับเพิ่มเติม ${p.code}`} value={d.units} placeholder="กล่อง=10" onChange={(e) => set(p.code, { units: e.target.value })} style={css(SMALL_INPUT)} /></td>
                  <td style={css(`${TD}; text-align: right`)}><Button size={32} kind={dirty ? 'primary' : 'secondary'} disabled={!dirty || busy === p.code} onClick={() => void save(p)}>บันทึก</Button></td>
                </tr>
              );
            })}
            {!shown.length && <tr style={css(S.tr)}><td colSpan={9} style={css(`${ROW}; ${TD}; color: #525252`)}>ยังไม่มีรายการประเภทสินค้า — เพิ่มที่หน้าสินค้าและบริการ</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ReorderTable({ rows }: { rows: Reorder[] }) {
  return (
    <section style={css(S.tableBox)}>
      <table style={css(S.table)}>
        <thead><tr style={css(S.theadRow)}>
          <th style={css(S.thFirst)}>รหัสสินค้า</th><th style={css(S.th)}>ชื่อสินค้า</th><th style={css(S.th)}>หน่วย</th>
          <th style={css(`${S.th}; text-align: right`)}>คงเหลือทุกคลัง</th><th style={css(`${S.th}; text-align: right`)}>จุดสั่งซื้อ</th><th style={css(`${S.th}; text-align: right`)}>จำนวนสูงสุด</th><th style={css(`${S.th}; text-align: right`)}>แนะนำสั่ง</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productCode} style={css(S.tr)}>
              <td style={css(`${ROW}; ${TD}`)}><a href={`/inventory/stock-card/${encodeURIComponent(r.productCode)}`} style={css('color: #0f62fe')}>{r.productCode}</a></td>
              <td style={css(TD)}>{r.name}</td><td style={css(TD)}>{r.unit ?? ''}</td>
              <td style={css(NUM)}>{qty(r.onHand)}</td><td style={css(NUM)}>{qty(r.reorderPoint)}</td><td style={css(NUM)}>{qty(r.maxQty)}</td><td style={css(`${NUM}; font-weight: 600`)}>{qty(r.suggestQty)}</td>
            </tr>
          ))}
          {!rows.length && <tr style={css(S.tr)}><td colSpan={7} style={css(`${ROW}; ${TD}; color: #525252`)}>ไม่มีสินค้าถึงจุดสั่งซื้อ</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function Section87View({ month, warehouse, warehouses, section87, go }: Props & { go: (patch: Record<string, string>) => void }) {
  const [m, setM] = useState(month);
  const [wh, setWh] = useState(warehouse);
  const [y, mo] = month.split('-');
  return (
    <>
      <div style={css('display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap')}>
        <label style={css(S.label)}>เดือน<input type="month" value={m} onChange={(e) => setM(e.target.value)} style={css(`${S.input}; width: 180px`)} /></label>
        <WarehouseSelect value={wh} warehouses={warehouses} onChange={setWh} />
        <Button kind="primary" disabled={!m} onClick={() => go({ month: m, warehouse: wh })}>แสดง</Button>
      </div>
      {section87?.pendingOfficialFormat && (
        <div role="note" style={css('padding: 12px 16px; background: #fff1f1; border-left: 3px solid #da1e28; color: #a2191f; font-size: 14px')}>
          รายงานสินค้าและวัตถุดิบ ม.87(3) — โครงเท่านั้น · รูปแบบทางการ (แบบที่อธิบดีกำหนด) รอยืนยัน ยังใช้ยื่นจริงไม่ได้
        </div>
      )}
      <h2 style={css('margin: 0; font-size: 16px; font-weight: 600')}>{`รายงานสินค้าและวัตถุดิบ เดือน ${mo}/${Number(y) + 543}`}</h2>
      {section87 && section87.products.map((p) => (
        <section key={p.code} style={css(S.tableBox)}>
          <div style={css('padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; display: flex; justify-content: space-between')}>
            <strong style={css('font-weight: 600')}>{`${p.code} ${p.name}`}</strong><span style={css('color: #525252')}>{`หน่วย ${p.unit ?? ''}`}</span>
          </div>
          <table style={css(S.table)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>เลขที่เอกสาร</th><th style={css(`${S.th}; text-align: right`)}>รับ</th><th style={css(`${S.th}; text-align: right`)}>จ่าย</th><th style={css(`${S.th}; text-align: right`)}>คงเหลือ</th>
            </tr></thead>
            <tbody>
              <tr style={css(S.tr)}><td style={css(`${ROW}; ${TD}; color: #525252`)} colSpan={4}>ยกมา</td><td style={css(NUM)}>{qty(p.openingQty)}</td></tr>
              {p.rows.map((r, i) => (
                <tr key={i} style={css(S.tr)}>
                  <td style={css(`${ROW}; ${TD}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.date)}</td><td style={css(TD)}>{r.docNo ?? ''}</td>
                  <td style={css(NUM)}>{r.qtyIn === '0.0000' ? '' : qty(r.qtyIn)}</td><td style={css(NUM)}>{r.qtyOut === '0.0000' ? '' : qty(r.qtyOut)}</td><td style={css(NUM)}>{qty(r.balanceQty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}><td colSpan={4} style={css(`${ROW}; ${TD}`)}>คงเหลือยกไป</td><td style={css(NUM)}>{qty(p.closingQty)}</td></tr></tfoot>
          </table>
        </section>
      ))}
      {section87 && !section87.products.length && <p style={css(S.note)}>ไม่มีความเคลื่อนไหวของสินค้าที่ติดตามสต็อกในเดือนนี้</p>}
    </>
  );
}
