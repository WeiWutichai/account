// ข้อมูลฝั่ง server ของหน้ารายการ/ฟอร์มซื้อ — เติมฟิลด์ที่ GET /v1/documents ยังไม่ส่ง (vendor_ref, external_source, ยอดค้างจ่าย, การรับบิลของ PO)
// TODO(backend): GET /v1/documents ควรส่ง vendor_ref, external_source, pay_now และ outstanding ของ AP/EXP/DNR — ตอนนี้ต้องเปิดรายละเอียดทีละใบ (N+1)
import 'server-only';
import { fromCents, toCents } from '../../sales/_lib/num.ts';
import type { BillOption } from './CreditNoteForm';
import type { ListRow } from './PurchaseList';
import { getPDoc, listPDocs } from './server.ts';
import { outstandingOf, type PDetail, type PRow } from './types.ts';

/** ยอดที่รับบิลแล้วต่อบรรทัดของ PO = Σ บรรทัด AP (ไม่ยกเลิก) ที่อ้าง PO นี้ · จับคู่ด้วยรายการ + บัญชี */
export function receivedOf(po: PDetail, aps: PDetail[]): string[] {
  const lines = po.lines.filter((l) => l.line_type === 'item');
  return lines.map((l) => fromCents(aps.filter((a) => a.doc.status !== 'voided').flatMap((a) => a.lines)
    .filter((x) => x.line_type === 'item' && x.description === l.description && x.account_code === l.account_code).reduce((s, x) => s + toCents(x.amount), 0n)));
}

export async function poReceived(po: PDetail): Promise<string[]> {
  const aps = (await listPDocs('type=AP')).filter((r) => r.ref_document_id === po.doc.id);
  return receivedOf(po, await Promise.all(aps.map((r) => getPDoc(r.id))));
}

export async function listRows(types: string): Promise<ListRow[]> {
  const rows = await listPDocs(`type=${types}`);
  const details = new Map<string, PDetail>((await Promise.all(rows.slice(0, 300).map((r) => getPDoc(r.id)))).map((d) => [d.doc.id, d]));
  // PO: ใบ AP ที่อ้าง PO
  const poIds = rows.filter((r) => r.doc_type === 'PO').map((r) => r.id);
  let apByPo = new Map<string, PDetail[]>();
  if (poIds.length) {
    const aps = (types.includes('AP') ? rows : await listPDocs('type=AP')).filter((r) => r.doc_type === 'AP' && r.ref_document_id && poIds.includes(r.ref_document_id));
    const apDetails = await Promise.all(aps.map((r) => details.get(r.id) ?? getPDoc(r.id)));
    apByPo = apDetails.reduce((m, a) => m.set(a.doc.ref_document_id!, [...(m.get(a.doc.ref_document_id!) ?? []), a]), new Map<string, PDetail[]>());
  }
  return rows.map((r: PRow) => {
    const d = details.get(r.id);
    let po: ListRow['po'] = null;
    if (r.doc_type === 'PO' && d) {
      const items = d.lines.filter((l) => l.line_type === 'item');
      const rec = receivedOf(d, apByPo.get(r.id) ?? []);
      po = { lines: items.length, received: items.filter((l, i) => toCents(rec[i]) >= toCents(l.amount)).length };
    }
    return { ...r, vendor_ref: d?.doc.vendor_ref ?? null, external_source: d?.doc.external_source ?? null, pay_now: d?.doc.pay_now ?? false, outstanding: d ? outstandingOf(d) : null, po };
  });
}

/** บิลซื้อที่ลงบัญชีแล้ว (ตัวเลือก "อ้างอิงบิลซื้อเดิม" · ScreenPurchaseCreditNote) */
export async function billOptions(): Promise<BillOption[]> {
  const rows = (await listPDocs('type=AP&status=posted')).slice(0, 200);
  const details = await Promise.all(rows.map((r) => getPDoc(r.id)));
  return details.map((d) => ({ id: d.doc.id, doc_no: d.doc.doc_no, issue_date: d.doc.issue_date, vendor_ref: d.doc.vendor_ref, grand_total: d.doc.grand_total, outstanding: outstandingOf(d) ?? '0.00', contact_id: d.doc.contact_id }));
}
