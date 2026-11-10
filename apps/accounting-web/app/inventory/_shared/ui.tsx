// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ของร่วมหน้าสินค้าคงคลัง (Phase 2A INV) — ป้ายหน้าชั่วคราว · รูปข้อมูลจาก /v1/inventory/* · รูปแบบจำนวน (ทศนิยมสูงสุด 4 ตำแหน่ง)
import { css, Tag, type TagKind } from '@innovera/ui';

/** ป้ายบนสุดของทุกหน้าที่ยังไม่มีแบบร่าง (Wei สั่งให้ใช้งานได้ก่อน) */
export function TempBanner() {
  return (
    <div role="note" style={css('padding: 8px 16px; background: #fcf4d6; border-left: 3px solid #f1c21b; color: #684e00; font-size: 14px')}>
      หน้าชั่วคราว — ยังไม่มีแบบร่าง (Phase 2A)
    </div>
  );
}

/** ข้อความผลลัพธ์/ข้อผิดพลาดจาก API (422 ภาษาไทย) */
export function Msg({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return <div role={msg.kind === 'err' ? 'alert' : 'status'} style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>;
}

/** เรียก /api/proxy/... แล้วคืน { ok, body } · error ของ API (string | string[]) รวมเป็นข้อความเดียว */
export async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/proxy/${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const r = (await res.json()) as T & { error?: string | string[]; message?: string | string[] };
    if (!res.ok) {
      const e = r.error ?? r.message ?? `ไม่สำเร็จ (${res.status})`;
      return { ok: false, error: Array.isArray(e) ? e.join(' · ') : e };
    }
    return { ok: true, data: r };
  } catch {
    return { ok: false, error: 'เชื่อมต่อระบบไม่ได้' };
  }
}

/** จำนวน: คั่นหลักพัน · ทศนิยมสูงสุด 4 ตำแหน่ง (ตัดศูนย์ท้าย) · ไม่ใช้ float */
export function qty(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  const ff = f.slice(0, 4).replace(/0+$/u, '');
  const body = `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}${ff ? `.${ff}` : ''}`;
  return neg && body !== '0' ? `−${body}` : body;
}
/** ต้นทุนต่อหน่วย: ทศนิยมอย่างน้อย 2 สูงสุด 4 ตำแหน่ง */
export function unitCost(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const [i = '0', f = ''] = v.split('.');
  const t = f.slice(0, 4).replace(/0+$/u, '');
  const ff = t.length >= 2 ? t : `${t}00`.slice(0, 2);
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${ff}`;
}
/** ข้อความที่ผู้ใช้พิมพ์ → จำนวน (ลบคอมมา) · ผิดรูป = null */
export function normQty(s: string, signed = false): string | null {
  const t = s.replace(/,/gu, '').trim();
  return (signed ? /^-?\d+(\.\d{1,4})?$/u : /^\d+(\.\d{1,4})?$/u).test(t) ? t : null;
}

/** แท็บของหน้า /inventory (?tab=) */
export const INV_TABS: readonly (readonly [string, string])[] = [
  ['balances', 'คงเหลือและมูลค่า'], ['warehouses', 'คลังสินค้า'], ['products', 'ตั้งค่าสต็อกของสินค้า'], ['reorder', 'ถึงจุดสั่งซื้อ'], ['section87', 'รายงาน ม.87(3)'],
];

export const DOC_TYPE: Record<string, string> = { GR: 'ใบรับสินค้า', GI: 'ใบเบิกสินค้า', TRF: 'ใบโอนคลัง', ADJ: 'ใบปรับยอด / ตรวจนับ' };
export const MOVE_KIND: Record<string, string> = {
  receipt: 'รับสินค้า', purchase: 'ซื้อ', sale: 'ขาย', issue: 'เบิก', transfer_out: 'โอนออก', transfer_in: 'โอนเข้า', adjust: 'ปรับยอด', price_variance: 'ผลต่างราคา',
};
const STATUS: Record<string, [TagKind, string]> = {
  draft: ['neutral', 'ร่าง'], pending_approval: ['warning', 'รออนุมัติ'], posted: ['success', 'ผ่านรายการแล้ว'], voided: ['error', 'ยกเลิกแล้ว'],
};
export function StatusTag({ status }: { status: string }) {
  const [k, t] = STATUS[status] ?? ['neutral', status];
  return <Tag kind={k}>{t}</Tag>;
}

export interface Warehouse { id: string; code: string; name: string; branch_code: string; allow_negative: boolean; is_default: boolean; active: boolean }
export interface InvStatus { enabled: boolean; settings: { method: 'periodic' | 'perpetual'; costing: string; writedownNrv: boolean; pendingAuditor: boolean } }
export interface ProductRow {
  code: string; name: string; kind: string; unit: string | null; track_stock: boolean; reorder_point: string | null; max_qty: string | null; barcode: string | null;
  inventory_account: string | null; cogs_account: string | null;
}
export interface ProductUnit { product_code: string; unit: string; factor: string; barcode: string | null }
