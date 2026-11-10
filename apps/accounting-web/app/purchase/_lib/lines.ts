// บรรทัดเอกสารซื้อระหว่างกรอก — ยอดจาก POST /v1/documents/preview (useTotals ของหน้าขาย · engine เดียวกับตอนบันทึก)
import { type LineRow, priceText, useTotals, validRow as validSales } from '../../sales/_lib/lines.ts';
import { parseDec, qtyText } from '../../sales/_lib/num.ts';
import type { PLine, Totals } from './types.ts';

/** unit = หน่วยของบรรทัด (P2A สต็อก · แสดงเมื่อเปิดโมดูลเท่านั้น) */
export interface PLineRow { item: string; account: string; qty: string; price: string; vat: boolean; wht: string; unit?: string }
export const blankPLine = (vat = true): PLineRow => ({ item: '', account: '', qty: '1', price: '', vat, wht: '' });

const plain = (v: string | null) => (v === null ? '' : qtyText(v).replace(/,/gu, ''));
export const pRowFromLine = (l: PLine): PLineRow => pRowOf(l, false);
/** P2A สต็อก: แสดง "รหัสสินค้า ชื่อ" ในช่องรายการ */
export const pRowWithCode = (l: PLine): PLineRow => pRowOf(l, true);
function pRowOf(l: PLine, withCode: boolean): PLineRow {
  return { item: withCode && l.product_code ? `${l.product_code} ${l.description}` : l.description, account: l.account_code ?? '', qty: plain(l.qty), price: priceText(l.unit_price), vat: l.vat_rate !== null, wht: l.wht_type ?? '',
    ...(l.unit ? { unit: l.unit } : {}) };
}
const toSales = (r: PLineRow): LineRow => ({ item: r.item, account: r.account, qty: r.qty, price: r.price, disc: '', vat: r.vat });
export const validP = (r: PLineRow): boolean => validSales(toSales(r));
const dec = (v: string) => v.replace(/,/gu, '').trim();
export const accCode = (v: string): string | null => v.trim().slice(0, 7) || null;

/** payload บรรทัดของ PurchaseDraftInput */
export function pLinePayload(r: PLineRow) {
  return { lineType: 'item' as const, productCode: null, description: r.item.trim(), qty: dec(r.qty), unitPrice: dec(r.price), discount: '0.00', vat: r.vat, accountCode: accCode(r.account), whtType: r.wht || null };
}

/** ยอดเอกสาร · idx[i] = ตำแหน่งบรรทัด i ใน totals.lines (-1 = ยังไม่ครบ) */
export function usePTotals(rows: PLineRow[], priceInclVat = false): { totals: Totals | null; idx: number[]; err: string | null } {
  return useTotals(rows.map(toSales), priceInclVat, '');
}

/** บรรทัดที่ครบ + ยอดสุทธิจาก engine (ใช้คิด WHT ที่คาดไว้ / ตัวอย่างการลงบัญชี) */
export function netLines(rows: PLineRow[], totals: Totals | null, idx: number[]) {
  return rows.map((r, i) => ({ r, k: idx[i] ?? -1 })).filter((x) => x.k >= 0 && totals?.lines[x.k])
    .map(({ r, k }) => ({ amount: totals!.lines[k]!.amount, gross: totals!.lines[k]!.gross, account: accCode(r.account), whtType: r.wht || null }));
}

export const hasNum = (v: string): boolean => parseDec(v, 4) !== null;
