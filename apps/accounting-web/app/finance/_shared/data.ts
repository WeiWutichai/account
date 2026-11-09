// ดึงข้อมูลฝั่ง server สำหรับหน้าการเงิน — ทุกตัวเลขมาจาก accounting-api
import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { api } from '../../lib/api';
import { cents, fromCents } from './num';
import type { BillingItem, DocDetail, DocRow, SettlementIn } from './types';

export const getDoc = (id: string) => api<DocDetail>(`/v1/documents/${encodeURIComponent(id)}`);
/** เอกสารตาม id · ไม่พบ/ผิดรูป = null (ปล่อย redirect ของ api() ผ่าน) */
export async function findDoc(id: string): Promise<DocDetail | null> {
  try { return await getDoc(id); } catch (e) { unstable_rethrow(e); return null; }
}
export const listDocs = (q: Record<string, string>) => api<DocRow[]>(`/v1/documents?${new URLSearchParams(q).toString()}`);

export interface BillingSummary {
  row: DocRow; items: BillingItem[];
  /** รับชำระแล้ว (ตัด + ภาษีถูกหัก) ของใบที่อยู่ในใบวางบิล ตั้งแต่วันวางบิล */
  received: string; receipts: { id: string; doc_no: string; issue_date: string }[];
  /** ยอดค้างปัจจุบันรวมของใบที่อยู่ในใบวางบิล */
  outstanding: string;
}

/** ใบวางบิลพร้อมยอดรับแล้ว/ค้าง (คำนวณจากการตัดยอดจริงของใบที่วางบิล) */
export async function billingSummaries(bns: DocRow[], invoices: Map<string, DocRow>, detail: (id: string) => Promise<DocDetail>): Promise<BillingSummary[]> {
  return Promise.all(bns.map(async (row) => {
    const d = await detail(row.id);
    let received = 0n;
    let outstanding = 0n;
    const receipts = new Map<string, { id: string; doc_no: string; issue_date: string }>();
    for (const it of d.billing) {
      const inv = await detail(it.id);
      outstanding += cents(invoices.get(it.id)?.outstanding ?? inv.outstanding ?? '0.00');
      for (const s of inv.settlementsIn as SettlementIn[]) {
        if (s.voided || s.doc_type !== 'RV' || s.issue_date < row.issue_date) continue;
        received += cents(s.applied) + cents(s.wht);
        receipts.set(s.id, { id: s.id, doc_no: s.doc_no, issue_date: s.issue_date });
      }
    }
    return { row, items: d.billing, received: fromCents(received), receipts: [...receipts.values()], outstanding: fromCents(outstanding) };
  }));
}

/** cache รายละเอียดเอกสารภายในหนึ่ง request */
export function detailCache(): (id: string) => Promise<DocDetail> {
  const m = new Map<string, Promise<DocDetail>>();
  return (id) => {
    let p = m.get(id);
    if (!p) { p = getDoc(id); m.set(id, p); }
    return p;
  };
}
