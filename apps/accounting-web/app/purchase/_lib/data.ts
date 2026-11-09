// ข้อมูลฝั่ง server ของหน้ารายการ/ฟอร์มซื้อ — GET /v1/documents ส่ง vendor_ref, external_source, pay_now, outstanding มาแล้ว
// เปิดรายละเอียดเฉพาะ PO (และ AP ที่อ้าง PO) เพื่อนับบรรทัดที่รับบิลแล้ว (ต้องใช้บรรทัดของเอกสาร)
import 'server-only';
import { fromCents, toCents } from '../../sales/_lib/num.ts';
import type { BillOption } from './CreditNoteForm';
import type { ListRow } from './PurchaseList';
import { getPDoc, listPDocs } from './server.ts';
import type { PDetail, PRow } from './types.ts';

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
  // PO: บรรทัดของ PO + AP ที่อ้าง PO (นับ "PO ค้างรับ x/y")
  const pos = rows.filter((r) => r.doc_type === 'PO');
  const poInfo = new Map<string, ListRow['po']>();
  if (pos.length) {
    const poIds = new Set(pos.map((r) => r.id));
    const aps = (types.includes('AP') ? rows : await listPDocs('type=AP')).filter((r) => r.doc_type === 'AP' && r.ref_document_id && poIds.has(r.ref_document_id));
    const [poDetails, apDetails] = await Promise.all([Promise.all(pos.map((r) => getPDoc(r.id))), Promise.all(aps.map((r) => getPDoc(r.id)))]);
    for (const d of poDetails) {
      const items = d.lines.filter((l) => l.line_type === 'item');
      const rec = receivedOf(d, apDetails.filter((a) => a.doc.ref_document_id === d.doc.id));
      poInfo.set(d.doc.id, { lines: items.length, received: items.filter((l, i) => toCents(rec[i]) >= toCents(l.amount)).length });
    }
  }
  return rows.map((r: PRow) => ({ ...r, po: poInfo.get(r.id) ?? null }));
}

/** บิลซื้อที่ลงบัญชีแล้ว (ตัวเลือก "อ้างอิงบิลซื้อเดิม" · ScreenPurchaseCreditNote) */
export async function billOptions(): Promise<BillOption[]> {
  const rows = (await listPDocs('type=AP&status=posted')).slice(0, 200);
  return rows.map((r) => ({ id: r.id, doc_no: r.doc_no, issue_date: r.issue_date, vendor_ref: r.vendor_ref, grand_total: r.grand_total, outstanding: r.outstanding ?? '0.00', contact_id: r.contact_id }));
}
