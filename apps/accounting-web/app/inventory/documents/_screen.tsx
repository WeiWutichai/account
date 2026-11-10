'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// เอกสารสต็อก GR/GI/TRF/ADJ (Phase 2A INV) — รายการ + ฟอร์มสร้างเอกสาร (POST /v1/inventory/documents → ร่าง · POST …/:id/post → ผ่านรายการ)
// lot/serial: API รับตอนผ่านรายการเท่านั้น (ร่างไม่เก็บ · packages/db/src/inventory.ts saveStockDraft) — ปุ่ม "บันทึกร่าง" จึงไม่ส่ง lot/serial (กรอกใหม่ได้ที่หน้ารายละเอียดก่อนผ่านรายการ)
import { Button, css, href, money, parseThaiDate, S, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call, DOC_TYPE, Msg, normQty, StatusTag, TempBanner, type ProductUnit, type Warehouse } from '../_shared/ui';

export interface StockDocRow {
  id: string; doc_type: string; doc_no: string | null; status: string; issue_date: string; grand_total: string; reference: string | null;
  warehouse_code: string | null; to_warehouse_code: string | null; contact_name: string | null; journal_no: string | null; line_count: number;
}
interface Opt { code: string; name: string }
interface Props {
  today: string; type: string; openNew: boolean; docs: StockDocRow[]; warehouses: Warehouse[];
  products: (Opt & { unit: string | null })[]; units: ProductUnit[]; vendors: (Opt & { id: string })[];
  pos: { id: string; docNo: string; contactId: string | null; contactName: string; date: string }[]; accounts: Opt[];
}
type M = { kind: 'ok' | 'err'; text: string } | null;
type DocType = 'GR' | 'GI' | 'TRF' | 'ADJ';
interface Line { productCode: string; qty: string; unit: string; unitCost: string; accountCode: string; countedQty: string; lot: string; serial: string }
const EMPTY_LINE: Line = { productCode: '', qty: '', unit: '', unitCost: '', accountCode: '', countedQty: '', lot: '', serial: '' };

const TD = S.td;
const ROW = 'height: 40px';
const SEL = 'height: 40px; padding: 0 12px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const CELL = 'height: 32px; padding: 0 8px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; box-sizing: border-box; width: 100%';
const CELL_NUM = `${CELL}; text-align: right; font-variant-numeric: tabular-nums`;

export function StockDocsScreen(p: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(p.openNew);
  return (
    <>
      <TopBar crumb="โมดูลเพิ่มเติม / เอกสารสต็อก" right={<a href={href('inventory')} style={css('color: #0f62fe; font-size: 14px')}>สินค้าคงคลัง</a>} />
      <div style={css(S.content)}>
        <TempBanner />
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap')}>
          <div><h1 style={css(S.h1)}>รับ / เบิก / โอน / ตรวจนับ</h1><span style={css(S.sub)}>ใบรับสินค้า (GR) · ใบเบิกสินค้า (GI) · ใบโอนคลัง (TRF) · ใบปรับยอด / ตรวจนับ (ADJ)</span></div>
          <Button size={36} kind="primary" onClick={() => setOpen(!open)} aria-expanded={open}>+ สร้างเอกสาร</Button>
        </div>
        {open && <NewDoc {...p} onClose={() => setOpen(false)} />}
        <div style={css('display: flex; gap: 16px; align-items: flex-end')}>
          <label style={css(S.label)}>ประเภท
            <select value={p.type} onChange={(e) => router.push(`${href('stockdocs')}${e.target.value ? `?type=${e.target.value}` : ''}`)} style={css(SEL)}>
              <option value="">ทุกประเภท</option>
              {Object.entries(DOC_TYPE).map(([k, v]) => <option key={k} value={k}>{`${k} · ${v}`}</option>)}
            </select>
          </label>
        </div>
        <section style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 1000px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>เลขที่</th><th style={css(S.th)}>ประเภท</th><th style={css(S.th)}>คลัง</th><th style={css(S.th)}>ผู้ขาย / อ้างอิง</th>
              <th style={css(`${S.th}; text-align: right`)}>รายการ</th><th style={css(`${S.th}; text-align: right`)}>มูลค่าตามทุน</th><th style={css(S.th)}>เลขที่ JV</th><th style={css(S.th)}>สถานะ</th>
            </tr></thead>
            <tbody>
              {p.docs.map((d) => (
                <tr key={d.id} style={css(S.tr)}>
                  <td style={css(`${ROW}; ${TD}; font-variant-numeric: tabular-nums`)}>{thaiDate(d.issue_date)}</td>
                  <td style={css(`${TD}; white-space: nowrap`)}><a href={`/inventory/documents/${d.id}`} style={css('color: #0f62fe')}>{d.doc_no ?? '(ร่าง)'}</a></td>
                  <td style={css(TD)}>{DOC_TYPE[d.doc_type] ?? d.doc_type}</td>
                  <td style={css(TD)}>{d.to_warehouse_code ? `${d.warehouse_code ?? ''} → ${d.to_warehouse_code}` : (d.warehouse_code ?? 'คลังตั้งต้น')}</td>
                  <td style={css(TD)}>{[d.contact_name, d.reference].filter(Boolean).join(' · ')}</td>
                  <td style={css(S.num)}>{d.line_count}</td><td style={css(S.num)}>{d.status === 'draft' ? '' : money(d.grand_total, { paren: true })}</td>
                  <td style={css(TD)}>{d.journal_no ?? ''}</td><td style={css(TD)}><StatusTag status={d.status} /></td>
                </tr>
              ))}
              {!p.docs.length && <tr style={css(S.tr)}><td colSpan={9} style={css(`${ROW}; ${TD}; color: #525252`)}>ยังไม่มีเอกสารสต็อก</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function NewDoc({ today, warehouses, products, units, vendors, pos, accounts, onClose }: Props & { onClose: () => void }) {
  const router = useRouter();
  const defWh = warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? '';
  const [type, setType] = useState<DocType>('GR');
  const [date, setDate] = useState(thaiDate(today));
  const [wh, setWh] = useState(defWh);
  const [toWh, setToWh] = useState(warehouses.find((w) => w.id !== defWh)?.id ?? '');
  const [vendor, setVendor] = useState('');
  const [po, setPo] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [adjMode, setAdjMode] = useState<'count' | 'delta'>('count');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const unitsOf = (code: string) => {
    const pr = products.find((x) => x.code === code);
    return [...(pr?.unit ? [pr.unit] : []), ...units.filter((u) => u.product_code === code).map((u) => u.unit)];
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const counting = type === 'ADJ' && adjMode === 'count';
  const showCost = type === 'GR' || (type === 'ADJ' && adjMode === 'delta');
  const showAccount = type === 'GI' || type === 'ADJ';

  function build(): { body: unknown; lots: Record<number, { lot?: string; serial?: string }> } | string {
    const d = parseThaiDate(date);
    if (!d) return 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)';
    const used = lines.filter((l) => l.productCode);
    if (!used.length) return 'ต้องมีอย่างน้อย 1 รายการ';
    const out = [];
    const lots: Record<number, { lot?: string; serial?: string }> = {};
    for (const [i, l] of used.entries()) {
      const base: Record<string, string | null> = { productCode: l.productCode };
      if (counting) {
        const c = normQty(l.countedQty);
        if (!c) return `${l.productCode}: ยอดนับได้ไม่ถูกต้อง`;
        base.countedQty = c;
      } else {
        const q = normQty(l.qty, type === 'ADJ');
        if (!q) return `${l.productCode}: จำนวนไม่ถูกต้อง (ทศนิยมไม่เกิน 4 ตำแหน่ง${type === 'ADJ' ? ' · ผลต่างติดลบใส่ -' : ''})`;
        base.qty = q;
        base.unit = l.unit || null;
      }
      if (showCost && l.unitCost.trim()) {
        const c = normQty(l.unitCost);
        if (!c) return `${l.productCode}: ต้นทุนต่อหน่วยไม่ถูกต้อง`;
        base.unitCost = c;
      }
      if (showAccount && l.accountCode) base.accountCode = l.accountCode;
      out.push(base);
      if (l.lot.trim() || l.serial.trim()) lots[i + 1] = { ...(l.lot.trim() ? { lot: l.lot.trim() } : {}), ...(l.serial.trim() ? { serial: l.serial.trim() } : {}) };
    }
    return {
      body: {
        docType: type, issueDate: d, warehouseId: wh || null, toWarehouseId: type === 'TRF' ? toWh || null : null,
        contactId: type === 'GR' ? vendor || null : null, refDocumentId: type === 'GR' ? po || null : null,
        reference: reference.trim() || null, notes: notes.trim() || null, lines: out,
      },
      lots,
    };
  }

  async function save(andPost: boolean) {
    setMsg(null);
    const b = build();
    if (typeof b === 'string') { setMsg({ kind: 'err', text: b }); return; }
    setBusy(true);
    const r = await call<{ id: string }>('inventory/documents', 'POST', b.body);
    if (!r.ok) { setBusy(false); setMsg({ kind: 'err', text: r.error }); return; }
    if (andPost) {
      const pr = await call<{ docNo: string; journalNo: string | null }>(`inventory/documents/${r.data.id}/post`, 'POST', Object.keys(b.lots).length ? { lots: b.lots } : {});
      if (!pr.ok) { setBusy(false); router.push(`/inventory/documents/${r.data.id}?err=${encodeURIComponent(`บันทึกร่างแล้ว แต่ผ่านรายการไม่ได้: ${pr.error}`)}`); return; }
    }
    router.push(`/inventory/documents/${r.data.id}`);
  }

  const pickPo = (id: string) => {
    setPo(id);
    const o = pos.find((x) => x.id === id);
    if (o?.contactId) setVendor(o.contactId);
  };

  return (
    <section aria-label="สร้างเอกสารสต็อก" style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 16px')}>
      <div style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
        <label style={css(S.label)}>ประเภทเอกสาร
          <select value={type} onChange={(e) => setType(e.target.value as DocType)} style={css(SEL)}>
            {Object.entries(DOC_TYPE).map(([k, v]) => <option key={k} value={k}>{`${k} · ${v}`}</option>)}
          </select>
        </label>
        <label style={css(S.label)}>วันที่<input value={date} onChange={(e) => setDate(e.target.value)} style={css(`${S.input}; font-variant-numeric: tabular-nums`)} /></label>
        <label style={css(S.label)}>{type === 'TRF' ? 'จากคลัง' : 'คลัง'}
          <select value={wh} onChange={(e) => setWh(e.target.value)} style={css(SEL)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{`${w.code} · ${w.name}`}</option>)}</select>
        </label>
        {type === 'TRF'
          ? <label style={css(S.label)}>ไปคลัง<select value={toWh} onChange={(e) => setToWh(e.target.value)} style={css(SEL)}><option value="">— เลือก —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{`${w.code} · ${w.name}`}</option>)}</select></label>
          : type === 'ADJ'
            ? <label style={css(S.label)}>วิธีปรับ<select value={adjMode} onChange={(e) => setAdjMode(e.target.value as 'count' | 'delta')} style={css(SEL)}><option value="count">ตรวจนับ (ใส่ยอดนับได้)</option><option value="delta">ปรับผลต่าง (±)</option></select></label>
            : <span />}
        {type === 'GR' && (
          <>
            <label style={css(`grid-column: span 2; ${S.label}`)}>อ้างใบสั่งซื้อ (PO ที่อนุมัติแล้ว)
              <select value={po} onChange={(e) => pickPo(e.target.value)} style={css(SEL)}>
                <option value="">— ไม่อ้าง (ต้องใส่ต้นทุนต่อหน่วย) —</option>
                {pos.map((o) => <option key={o.id} value={o.id}>{`${o.docNo} · ${o.contactName} · ${thaiDate(o.date)}`}</option>)}
              </select>
            </label>
            <label style={css(`grid-column: span 2; ${S.label}`)}>ผู้ขาย
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={css(SEL)}>
                <option value="">— ไม่ระบุ —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{`${v.code} · ${v.name}`}</option>)}
              </select>
            </label>
          </>
        )}
        <label style={css(`grid-column: span 2; ${S.label}`)}>อ้างอิง<input value={reference} onChange={(e) => setReference(e.target.value)} style={css(S.input)} /></label>
        <label style={css(`grid-column: span 2; ${S.label}`)}>หมายเหตุ<input value={notes} onChange={(e) => setNotes(e.target.value)} style={css(S.input)} /></label>
      </div>
      <div style={css(S.tableBox)}>
        <table style={css(`${S.table}; min-width: 1100px`)}>
          <thead><tr style={css(S.theadRow)}>
            <th style={css(`${S.thFirst}; width: 32px`)}>#</th><th style={css(S.th)}>สินค้า</th>
            {counting ? <th style={css(`${S.th}; text-align: right; width: 130px`)}>ยอดนับได้ (หน่วยหลัก)</th> : <>
              <th style={css(`${S.th}; text-align: right; width: 120px`)}>{type === 'ADJ' ? 'ผลต่าง (±)' : 'จำนวน'}</th><th style={css(`${S.th}; width: 110px`)}>หน่วย</th></>}
            {showCost && <th style={css(`${S.th}; text-align: right; width: 130px`)}>ต้นทุนต่อหน่วย</th>}
            {showAccount && <th style={css(`${S.th}; width: 220px`)}>{type === 'GI' ? 'บัญชีค่าใช้จ่าย' : 'บัญชีผลต่าง'}</th>}
            <th style={css(`${S.th}; width: 110px`)}>Lot</th><th style={css(`${S.th}; width: 110px`)}>Serial</th><th style={css(`${S.th}; width: 48px`)} />
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={css(S.tr)}>
                <td style={css(`${ROW}; ${TD}; color: #525252`)}>{i + 1}</td>
                <td style={css(TD)}>
                  <select aria-label={`สินค้า บรรทัด ${i + 1}`} value={l.productCode} onChange={(e) => setLine(i, { productCode: e.target.value, unit: '' })} style={css(CELL)}>
                    <option value="">— เลือกสินค้า —</option>
                    {products.map((x) => <option key={x.code} value={x.code}>{`${x.code} · ${x.name}`}</option>)}
                  </select>
                </td>
                {counting
                  ? <td style={css(TD)}><input aria-label={`ยอดนับได้ บรรทัด ${i + 1}`} value={l.countedQty} inputMode="decimal" onChange={(e) => setLine(i, { countedQty: e.target.value })} style={css(CELL_NUM)} /></td>
                  : <>
                    <td style={css(TD)}><input aria-label={`จำนวน บรรทัด ${i + 1}`} value={l.qty} inputMode="decimal" onChange={(e) => setLine(i, { qty: e.target.value })} style={css(CELL_NUM)} /></td>
                    <td style={css(TD)}>
                      <select aria-label={`หน่วย บรรทัด ${i + 1}`} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} style={css(CELL)}>
                        {unitsOf(l.productCode).map((u, k) => <option key={u} value={k === 0 ? '' : u}>{u}</option>)}
                        {!unitsOf(l.productCode).length && <option value="">—</option>}
                      </select>
                    </td>
                  </>}
                {showCost && <td style={css(TD)}><input aria-label={`ต้นทุนต่อหน่วย บรรทัด ${i + 1}`} value={l.unitCost} inputMode="decimal" placeholder={type === 'GR' && po ? 'ตาม PO' : type === 'ADJ' ? 'ถัวเฉลี่ย' : ''} onChange={(e) => setLine(i, { unitCost: e.target.value })} style={css(CELL_NUM)} /></td>}
                {showAccount && (
                  <td style={css(TD)}>
                    <select aria-label={`บัญชี บรรทัด ${i + 1}`} value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} style={css(CELL)}>
                      <option value="">{type === 'GI' ? 'ตั้งต้น (ต้นทุนขายของสินค้า)' : 'ตั้งต้น 5020900'}</option>
                      {accounts.map((a) => <option key={a.code} value={a.code}>{`${a.code} ${a.name}`}</option>)}
                    </select>
                  </td>
                )}
                <td style={css(TD)}><input aria-label={`Lot บรรทัด ${i + 1}`} value={l.lot} onChange={(e) => setLine(i, { lot: e.target.value })} style={css(CELL)} /></td>
                <td style={css(TD)}><input aria-label={`Serial บรรทัด ${i + 1}`} value={l.serial} onChange={(e) => setLine(i, { serial: e.target.value })} style={css(CELL)} /></td>
                <td style={css(TD)}><Button size={32} kind="ghost" disabled={lines.length === 1} aria-label={`ลบบรรทัด ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}>×</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><Button size={32} kind="ghost" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>+ เพิ่มบรรทัด</Button></div>
      <p style={css(S.note)}>{counting ? 'ตรวจนับ: ผลต่าง = ยอดนับได้ − คงเหลือในระบบ ณ วันที่เอกสาร (คำนวณตอนผ่านรายการ)' : 'Lot / Serial ส่งตอนผ่านรายการ — ปุ่ม “บันทึกร่าง” ไม่เก็บ Lot / Serial'}</p>
      <Msg msg={msg} />
      <div style={css('display: flex; gap: 8px; justify-content: flex-end')}>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy} onClick={() => void save(false)}>บันทึกร่าง</Button>
        <Button kind="primary" disabled={busy} onClick={() => void save(true)}>บันทึกและผ่านรายการ</Button>
      </div>
    </section>
  );
}
