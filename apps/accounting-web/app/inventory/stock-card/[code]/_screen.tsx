'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// สต็อกการ์ด (Phase 2A INV) — ช่วงวันที่ · คลัง · ยกมา → รายการ (รับ/จ่าย/ต้นทุนต่อหน่วย/มูลค่า) → คงเหลือสะสม (จำนวน · ต้นทุนเฉลี่ย · มูลค่า)
import { Button, css, href, money, parseThaiDate, S, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MOVE_KIND, Msg, qty, TempBanner, unitCost, type Warehouse } from '../../_shared/ui';

export interface StockCard {
  product: { code: string; name: string; unit: string | null }; opening: { qty: string; value: string }; closing: { qty: string; value: string };
  rows: { date: string; docNo: string | null; docType: string | null; kind: string; reversal: boolean; warehouseCode: string; qtyIn: string; qtyOut: string; unitCost: string; value: string;
    balanceQty: string; balanceValue: string; lot: string | null; serial: string | null }[];
}
interface Props { card: StockCard; from: string; to: string; warehouse: string; warehouses: Warehouse[]; products: { code: string; name: string }[] }

const TD = S.td;
const ROW = 'height: 40px';
const SEL = 'height: 40px; padding: 0 12px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';

/** ต้นทุนเฉลี่ยของยอดคงเหลือ = มูลค่า ÷ จำนวน (ปัด 4 ตำแหน่ง · คำนวณด้วยจำนวนเต็ม ไม่ใช้ float) */
function avg(value: string, q: string): string {
  const toInt = (s: string, dp: number) => { const neg = s.startsWith('-'); const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.'); const n = BigInt(i + (f + '0'.repeat(dp)).slice(0, dp)); return neg ? -n : n; };
  const qv = toInt(q, 4);
  if (qv <= 0n) return '';
  const vv = toInt(value, 2) * 1000000n; // มูลค่า × 10^2 × 10^6 ÷ (จำนวน × 10^4) = ต้นทุน × 10^4
  let r = vv / qv;
  if ((vv % qv) * 2n >= qv) r += 1n;
  const s = r.toString().padStart(5, '0');
  return unitCost(`${s.slice(0, -4)}.${s.slice(-4)}`);
}

export function StockCardScreen({ card, from, to, warehouse, warehouses, products }: Props) {
  const router = useRouter();
  const [f, setF] = useState(thaiDate(from));
  const [t, setT] = useState(thaiDate(to));
  const [wh, setWh] = useState(warehouse);
  const [prod, setProd] = useState(card.product.code);
  const [err, setErr] = useState<string | null>(null);
  const show = () => {
    const a = parseThaiDate(f); const b = parseThaiDate(t);
    if (!a || !b) { setErr('วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)'); return; }
    setErr(null);
    const u = new URLSearchParams({ from: a, to: b, ...(wh ? { warehouse: wh } : {}) });
    router.push(`/inventory/stock-card/${encodeURIComponent(prod)}?${u.toString()}`);
  };
  const p = card.product;
  return (
    <>
      <TopBar crumb={`โมดูลเพิ่มเติม / สินค้าคงคลัง / สต็อกการ์ด ${p.code}`} right={<a href={href('inventory')} style={css('color: #0f62fe; font-size: 14px')}>สินค้าคงคลัง</a>} />
      <div style={css(S.content)}>
        <TempBanner />
        <div><h1 style={css(S.h1)}>{`สต็อกการ์ด ${p.code} ${p.name}`}</h1><span style={css(S.sub)}>{`หน่วยหลัก ${p.unit ?? '—'} · ${warehouse ? `คลัง ${warehouses.find((w) => w.id === warehouse)?.code ?? ''}` : 'ทุกคลัง'} · ${thaiDate(from)} – ${thaiDate(to)}`}</span></div>
        <div style={css('display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap')}>
          <label style={css(S.label)}>สินค้า
            <select value={prod} onChange={(e) => setProd(e.target.value)} style={css(SEL)}>
              {!products.some((x) => x.code === prod) && <option value={prod}>{prod}</option>}
              {products.map((x) => <option key={x.code} value={x.code}>{`${x.code} · ${x.name}`}</option>)}
            </select>
          </label>
          <label style={css(S.label)}>ตั้งแต่วันที่<input value={f} onChange={(e) => setF(e.target.value)} style={css(`${S.input}; width: 150px; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(S.label)}>ถึงวันที่<input value={t} onChange={(e) => setT(e.target.value)} style={css(`${S.input}; width: 150px; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(S.label)}>คลัง
            <select value={wh} onChange={(e) => setWh(e.target.value)} style={css(SEL)}>
              <option value="">ทุกคลัง</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{`${w.code} · ${w.name}`}</option>)}
            </select>
          </label>
          <Button kind="primary" onClick={show}>แสดง</Button>
        </div>
        <Msg msg={err ? { kind: 'err', text: err } : null} />
        <section style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 1200px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>เลขที่</th><th style={css(S.th)}>รายการ</th><th style={css(S.th)}>คลัง</th>
              <th style={css(`${S.th}; text-align: right`)}>รับ</th><th style={css(`${S.th}; text-align: right`)}>จ่าย</th><th style={css(`${S.th}; text-align: right`)}>ต้นทุนต่อหน่วย</th><th style={css(`${S.th}; text-align: right`)}>มูลค่า</th>
              <th style={css(`${S.th}; text-align: right`)}>คงเหลือ</th><th style={css(`${S.th}; text-align: right`)}>ต้นทุนเฉลี่ย</th><th style={css(`${S.th}; text-align: right`)}>มูลค่าคงเหลือ</th><th style={css(S.th)}>Lot / Serial</th>
            </tr></thead>
            <tbody>
              <tr style={css(S.tr)}>
                <td style={css(`${ROW}; ${TD}; color: #525252`)} colSpan={8}>ยกมา</td>
                <td style={css(S.num)}>{qty(card.opening.qty)}</td><td style={css(S.num)}>{avg(card.opening.value, card.opening.qty)}</td><td style={css(S.num)}>{money(card.opening.value, { paren: true })}</td><td />
              </tr>
              {card.rows.map((r, i) => (
                <tr key={i} style={css(S.tr)}>
                  <td style={css(`${ROW}; ${TD}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.date)}</td>
                  <td style={css(`${TD}; white-space: nowrap`)}>{r.docNo ?? ''}</td>
                  <td style={css(TD)}>{`${MOVE_KIND[r.kind] ?? r.kind}${r.docType ? ` (${r.docType})` : ''}${r.reversal ? ' · กลับรายการ' : ''}`}</td>
                  <td style={css(TD)}>{r.warehouseCode}</td>
                  <td style={css(S.num)}>{r.qtyIn === '0.0000' ? '' : qty(r.qtyIn)}</td><td style={css(S.num)}>{r.qtyOut === '0.0000' ? '' : qty(r.qtyOut)}</td>
                  <td style={css(S.num)}>{unitCost(r.unitCost)}</td><td style={css(S.num)}>{money(r.value, { paren: true })}</td>
                  <td style={css(S.num)}>{qty(r.balanceQty)}</td><td style={css(S.num)}>{avg(r.balanceValue, r.balanceQty)}</td><td style={css(S.num)}>{money(r.balanceValue, { paren: true })}</td>
                  <td style={css(TD)}>{[r.lot, r.serial].filter(Boolean).join(' / ')}</td>
                </tr>
              ))}
              {!card.rows.length && <tr style={css(S.tr)}><td colSpan={12} style={css(`${ROW}; ${TD}; color: #525252`)}>ไม่มีความเคลื่อนไหวในช่วงนี้</td></tr>}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}>
              <td colSpan={8} style={css(`${ROW}; ${TD}`)}>คงเหลือยกไป</td>
              <td style={css(S.num)}>{qty(card.closing.qty)}</td><td style={css(S.num)}>{avg(card.closing.value, card.closing.qty)}</td><td style={css(S.num)}>{money(card.closing.value, { paren: true })}</td><td />
            </tr></tfoot>
          </table>
        </section>
      </div>
    </>
  );
}
