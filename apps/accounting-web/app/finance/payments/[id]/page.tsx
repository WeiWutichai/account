// F3 จ่ายชำระ — ดูรอบจ่าย/ใบสำคัญจ่าย (PV) · design/project/ScreenPayment.dc.html
// id = ใบสำคัญจ่าย · PV ที่สร้างจากรอบจ่ายเดียวกัน (batch_ref) แสดงรวมเป็นรอบ ตามแบบร่าง
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { currentPeriod, Shell } from '../../../lib/shell';
import { findDoc } from '../../_shared/data';
import type { Account } from '../../_shared/types';
import { approvalSettings, balanceAround, runOf, type PurchaseDetail } from '../_data';
import { PaymentScreen } from '../_screen';

export default async function PaymentViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = (await findDoc(id)) as PurchaseDetail | null;
  if (!d || d.doc.doc_type !== 'PV') notFound();
  const { year } = await currentPeriod();
  const [run, accounts, limits] = await Promise.all([runOf(d), api<Account[]>(`/v1/accounts?year=${year}&period=13`), approvalSettings()]);
  const payFrom = d.doc.receive_account ?? '1100100';
  const balance = await balanceAround(payFrom, d.doc.issue_date, run.pvs.filter((x) => x.doc.status === 'posted').map((x) => x.doc.id));
  const last = (ev: string) => d.events.filter((e) => e.event === ev).at(-1) ?? null;
  const at = (ev: string) => last(ev)?.at ?? null;
  // ขั้น 2 (ผู้จัดการบัญชี) ของรอบที่ต้องมีกรรมการ = เหตุการณ์ approved ที่ detail.level = 2 (ยังไม่ลงบัญชี)
  const l2Ev = d.events.filter((e) => e.event === 'approved' && e.detail?.level === 2).at(-1) ?? null;
  const l2At = l2Ev?.at ?? null;
  return (
    <Shell active="payment">
      <PaymentScreen mode="view" today={d.doc.issue_date} rows={run.rows} l2Limit={limits.payment.l2Limit} accountNames={Object.fromEntries(accounts.map((a) => [a.code, a.name]))}
        view={{ id, docNo: d.doc.doc_no, status: d.doc.status, date: d.doc.issue_date, payFrom, method: d.doc.reference ?? 'transfer', batchRef: d.doc.batch_ref,
          pvs: run.pvInfo, certs: run.certs, balance, submittedAt: at('submitted'), l2At, approvedAt: d.doc.approved_at ?? at('approved'), voidReason: d.doc.void_reason,
          submittedBy: last('submitted')?.actor_name ?? d.created_by_name ?? null, l2By: l2Ev?.actor_name ?? null, approvedBy: d.approved_by_name ?? last('approved')?.actor_name ?? null }} />
    </Shell>
  );
}
