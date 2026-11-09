// ข้อมูลหน้าจ่ายชำระ (design/project/ScreenPayment.dc.html) — ทุกตัวเลขมาจาก accounting-api (/v1/payables · documents · wht-certificates · ledger)
import 'server-only';
import { api } from '../../lib/api';
import { detailCache, listDocs } from '../_shared/data';
import { cents, fromCents, roundDiv } from '../_shared/num';
import type { DocDetail } from '../_shared/types';
import type { BillRow, Cert, PvInfo } from './_screen';

/** GET /v1/payables (packages/db/src/purchase.ts payables) */
export interface Payable {
  id: string; doc_no: string; doc_type: string; issue_date: string; due_date: string | null; grand_total: string; vendor_ref: string | null;
  contact_id: string; contact_code: string; contact_name: string; outstanding: string;
  wht: { type: string; label: string; section: string | null; base: string; rate: string; amount: string; pendingAuditor: boolean }[];
}
/** เอกสารซื้อ/จ่าย — ฟิลด์เพิ่มจาก DocDetail ฝั่งขาย */
export type PurchaseDetail = DocDetail & { doc: DocDetail['doc'] & { batch_ref: string | null; vendor_ref: string | null; created_by: string | null; approved_by: string | null } };
export interface CertRow {
  id: string; cert_no: string; pnd: string; income_type: string; income_section: string | null; pay_date: string; base: string; rate: string; amount: string;
  pending_auditor: boolean; voided: boolean; code: string; name: string; tax_id: string | null; payment_no: string | null; payment_id: string;
}

/** อัตรา % ที่ใช้จริง = ภาษีหัก ÷ ฐาน (แสดงหลังยอดหัก ณ ที่จ่าย) */
export function pctOf(wht: string, base: string | null): string | null {
  const b = cents(base);
  const w = cents(wht);
  if (b <= 0n || w <= 0n) return null;
  const bp = roundDiv(w * 10000n, b); // ร้อยละ × 100
  const frac = (bp % 100n).toString().padStart(2, '0').replace(/0+$/u, '');
  return `${bp / 100n}${frac ? `.${frac}` : ''}%`;
}

/** หมายเหตุในช่อง "บิล" ตามแบบร่าง: บิลจาก TMS → ป้าย TMS · มีใบลดหนี้ซื้อ → "หลัง CNR…" · ไม่มี VAT → "<รายการ> ยกเว้น VAT"
 * TODO(Wei) ScreenPayment.dc.html: แบบร่างแสดงหมายเหตุเฉพาะบางแถว (AP2611-0088/0091 ก็ยกเว้น VAT แต่แสดงแค่ป้าย TMS) — ใช้ลำดับ TMS → CNR → ยกเว้น VAT ตามตัวอย่าง */
function billNote(b: DocDetail): Pick<BillRow, 'tms' | 'cnr' | 'desc' | 'exempt'> {
  const tms = (b.doc.external_source ?? '').toLowerCase() === 'tms';
  const cnr = b.settlementsIn.filter((s) => !s.voided && s.doc_type === 'CNR').map((s) => s.doc_no).join(', ') || null;
  const exempt = !tms && !cnr && cents(b.doc.vat) === 0n;
  return { tms, cnr, exempt, desc: exempt ? (b.lines.find((l) => l.line_type === 'item' && l.description)?.description ?? null) : null };
}

/** บิลค้างจ่ายทั้งหมด (เรียงตามครบกำหนด) → แถวของรอบจ่ายใหม่ */
export async function payableRows(): Promise<BillRow[]> {
  const detail = detailCache();
  const list = await api<Payable[]>('/v1/payables');
  return Promise.all(list.map(async (p) => {
    const err = p.wht.find((w) => w.type === 'error');
    const wht = err ? 0n : p.wht.reduce((s, w) => s + cents(w.amount), 0n);
    const base = p.wht.filter((w) => w.type !== 'error').reduce((s, w) => s + cents(w.base), 0n);
    return {
      id: p.id, docNo: p.doc_no, contactId: p.contact_id, contact: `${p.contact_code} ${p.contact_name}`, due: p.due_date ?? p.issue_date,
      outstanding: p.outstanding, wht: fromCents(wht), pct: pctOf(fromCents(wht), fromCents(base)), paid: fromCents(cents(p.outstanding) - wht),
      pendingAuditor: p.wht.some((w) => w.pendingAuditor && w.type !== 'error'), whtError: err?.label ?? null, paidOn: null, pvId: null,
      ...billNote(await detail(p.id)),
    };
  }));
}

/** รอบจ่ายของใบสำคัญจ่าย: PV ที่ batch_ref เดียวกัน (วันเดียวกัน) · ไม่มี batch_ref = ใบเดียว */
export async function runOf(pv: PurchaseDetail): Promise<{ pvs: PurchaseDetail[]; rows: BillRow[]; certs: Cert[]; pvInfo: PvInfo[] }> {
  const detail = detailCache();
  const date = pv.doc.issue_date;
  let pvs: PurchaseDetail[] = [pv];
  if (pv.doc.batch_ref) {
    const same = await listDocs({ type: 'PV', from: date, to: date });
    const ds = (await Promise.all(same.map((x) => (x.id === pv.doc.id ? Promise.resolve(pv) : (detail(x.id) as Promise<PurchaseDetail>)))));
    pvs = ds.filter((x) => x.doc.batch_ref === pv.doc.batch_ref);
  }
  pvs.sort((a, b) => (a.doc.doc_no ?? '￿').localeCompare(b.doc.doc_no ?? '￿'));
  const allCerts = await api<CertRow[]>(`/v1/wht-certificates?from=${date}&to=${date}`);
  const ids = new Set(pvs.map((x) => x.doc.id));
  const certs: Cert[] = allCerts.filter((c) => ids.has(c.payment_id) && !c.voided).map((c) => ({ id: c.id, certNo: c.cert_no, pnd: c.pnd, pendingAuditor: c.pending_auditor, paymentId: c.payment_id }));
  const rows: BillRow[] = [];
  for (const x of pvs) {
    for (const s of x.settlementsOut) {
      const b = await detail(s.id);
      rows.push({
        id: `${x.doc.id}:${s.id}`, docNo: s.doc_no, contactId: x.doc.contact_id ?? '', contact: x.contact ? `${x.contact.code} ${x.contact.name}` : '', due: s.due_date ?? s.issue_date,
        outstanding: fromCents(cents(s.applied) + cents(s.wht)), wht: s.wht, pct: pctOf(s.wht, s.wht_base), paid: s.applied,
        pendingAuditor: certs.some((c) => c.paymentId === x.doc.id && c.pendingAuditor), whtError: null, paidOn: x.doc.status === 'posted' ? x.doc.issue_date : null, pvId: x.doc.id,
        ...billNote(b),
      });
    }
  }
  const pvInfo: PvInfo[] = pvs.map((x) => ({ id: x.doc.id, docNo: x.doc.doc_no, status: x.doc.status, contact: x.contact?.name ?? '', paid: x.doc.grand_total }));
  return { pvs, rows, certs, pvInfo };
}

interface Ledger { opening: string; closing: string; rows: { debit: string; credit: string; balance: string; source_document_id: string | null }[] }
/** ยอดบัญชีจ่ายจาก ก่อน → หลังรอบจ่าย (จากบัญชีแยกประเภทจริง) */
export async function balanceAround(account: string, date: string, pvIds: string[]): Promise<{ before: string; after: string } | null> {
  try {
    const l = await api<Ledger>(`/v1/ledger?account=${encodeURIComponent(account)}&from=${date}&to=${date}`);
    const mine = l.rows.filter((r) => r.source_document_id && pvIds.includes(r.source_document_id));
    const last = mine.at(-1);
    if (!last) return null;
    const out = mine.reduce((s, r) => s + cents(r.credit) - cents(r.debit), 0n);
    return { before: fromCents(cents(last.balance) + out), after: last.balance };
  } catch {
    return null;
  }
}
