// บรรทัดเอกสารขายระหว่างกรอก + ยอดจาก POST /v1/documents/preview (engine เดียวกับตอนบันทึก)
import { useEffect, useState } from 'react';
import { call } from './client.ts';
import type { DocLine, Totals } from './doc.ts';
import { fromCents, lineDiscount, parseDec, qtyText } from './num.ts';

/** zero = VAT 0% ส่งออก (P2A · vatCode 'zero' · vat_rate 0) — มีเฉพาะเมื่อเปิดโมดูลหลายสกุลเงิน · TODO(Wei): ชั่วคราว รอแบบร่าง */
export interface LineRow { item: string; account: string; qty: string; price: string; disc: string; vat: boolean; zero?: boolean }
export const blankLine = (): LineRow => ({ item: '', account: '', qty: '', price: '', disc: '', vat: true });

/** "S-0001 พัฒนาซอฟต์แวร์" → { productCode: 'S-0001', description: 'พัฒนาซอฟต์แวร์' } */
export function parseItem(item: string): { productCode: string | null; description: string } {
  const m = /^([A-Z]{1,4}-\d{2,})\s+(.+)$/u.exec(item.trim());
  return m ? { productCode: m[1]!, description: m[2]!.trim() } : { productCode: null, description: item.trim() };
}
const plain = (v: string | null) => (v === null ? '' : qtyText(v).replace(/,/gu, ''));
/** ราคา/หน่วย 4 ตำแหน่ง → "1,500.00" (คงทศนิยมที่ 3–4 ถ้ามี) */
export const priceText = (v: string | null) => { if (v === null) return ''; const [i = '0', f = ''] = v.split('.'); const t = f.replace(/0+$/u, ''); return `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${t.padEnd(2, '0')}`; };

export function rowFromLine(l: DocLine): LineRow {
  const zero = l.vat_rate !== null && parseDec(l.vat_rate, 4) === 0n;
  return {
    item: `${l.product_code ? `${l.product_code} ` : ''}${l.description}`, account: l.account_code ?? '', qty: plain(l.qty), price: priceText(l.unit_price),
    disc: l.discount === '0.00' ? '' : l.discount, vat: l.vat_rate !== null && !zero, ...(zero ? { zero: true } : {}),
  };
}

export const validRow = (r: LineRow): boolean => !!r.item.trim() && parseDec(r.qty, 4) !== null && parseDec(r.price, 4) !== null && lineDiscount(r.disc, r.qty, r.price) !== null;
const dec = (v: string) => v.replace(/,/gu, '').trim();

/** payload บรรทัดสำหรับ SalesDraftInput */
export function linePayload(r: LineRow) {
  const { productCode, description } = parseItem(r.item);
  return { lineType: 'item' as const, productCode, description, qty: dec(r.qty), unitPrice: dec(r.price), discount: lineDiscount(r.disc, r.qty, r.price) ?? '0.00', vat: r.vat, accountCode: r.account.trim().slice(0, 7) || null,
    ...(r.zero ? { vat: false, vatCode: 'zero' as const } : {}) };
}

/** ยอดเอกสารระหว่างกรอก · idx[i] = ตำแหน่งของบรรทัด i ใน totals.lines (-1 = ยังไม่ครบ) */
export function useTotals(rows: LineRow[], priceInclVat: boolean, billDiscount: string): { totals: Totals | null; idx: number[]; err: string | null } {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = rows.map(validRow);
  let k = 0;
  const idx = valid.map((v) => (v ? k++ : -1));
  const lines = rows.filter((_, i) => valid[i]).map((r) => ({ qty: dec(r.qty), unitPrice: dec(r.price), discount: lineDiscount(r.disc, r.qty, r.price) ?? '0.00', vat: r.vat }));
  const bd = parseDec(billDiscount, 2);
  const key = JSON.stringify({ lines, priceInclVat, bd: bd === null ? '0' : bd.toString() });
  useEffect(() => {
    if (!lines.length) { setTotals(null); return; }
    const t = setTimeout(() => {
      void call<Totals>('documents/preview', 'POST', { lines, priceInclVat, billDiscount: fromCents(bd ?? 0n) }).then((r) => {
        if (r.ok) { setTotals(r.data); setErr(null); } else setErr(r.error);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [key]);
  return { totals, idx, err };
}
