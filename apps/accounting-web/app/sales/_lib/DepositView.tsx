'use client';
// S7 เงินมัดจำ — design/project/ScreenDeposit.dc.html · รายการมัดจำ + แผงตัดมัดจำในใบกำกับภาษีร่าง (บันทึกผ่าน PUT /v1/documents/:id deposits[])
import { ButtonLink, css, money, Tag, type TagKind, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call } from './client.ts';
import { docNo, type DocDetail, type Totals } from './doc.ts';
import { usePreview } from './JournalPreview';
import { fromCents, parseDec, subMoney, toCents } from './num.ts';

export interface DepositRow {
  id: string; docNo: string; date: string; contactId: string | null; contact: string; ref: string; total: string; received: string; applied: string; remaining: string;
  status: { kind: TagKind; text: string }; posted: boolean; age: number; remainingBase: string; appliedThisMonth: string; ivThisMonth: string[]; journal: DocDetail['journal']; receivedNo: string;
}
export interface ApplyTarget { detail: DocDetail }
interface Summary { liability: string; openCount: number; openCustomers: number; pendingTotal: string; pendingCount: number; appliedMonth: string; appliedInvoices: number; stale: string }

const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const NUMG = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; color: #525252';
const TH = 'padding: 0 12px; font-weight: 400';
const THN = 'padding: 0 12px; font-weight: 400; text-align: right';

export function DepositView({ rows, summary, candidates, target, names }: { rows: DepositRow[]; summary: Summary; candidates: { id: string; label: string }[]; target: ApplyTarget | null; names: Record<string, string> }) {
  const router = useRouter();
  const iv = target?.detail ?? null;
  const available = iv ? rows.filter((r) => r.posted && r.contactId === iv.doc.contact_id) : [];
  const current = new Map((iv?.settlementsIn ?? []).filter((s) => s.doc_type === 'DP').map((s) => [s.id, s.applied]));
  const [pick, setPick] = useState<Record<string, { on: boolean; amount: string }>>(
    Object.fromEntries(available.map((r) => [r.id, { on: current.has(r.id), amount: money(current.get(r.id) ?? r.remainingBase) }])),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const first = useRef(true);
  const key = JSON.stringify(pick);

  // เปลี่ยนการเลือก/ยอด → บันทึกใบกำกับร่าง (ยอด VAT/ยอดเรียกเก็บคำนวณที่ server · totalsOf ใน packages/db/src/sales.ts)
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!iv) return;
    const t = setTimeout(async () => {
      const deposits = Object.entries(pick).filter(([, v]) => v.on).map(([documentId, v]) => ({ documentId, amount: fromCents(parseDec(v.amount, 2) ?? 0n) }));
      const d = iv.doc;
      const r = await call(`documents/${d.id}`, 'PUT', {
        docType: 'IV', contactId: d.contact_id, issueDate: d.issue_date, dueDate: d.due_date, priceInclVat: d.price_incl_vat, billDiscount: d.bill_discount, taxMode: d.tax_mode, ruleCode: d.rule_code,
        address: d.address, notes: d.notes, reference: d.reference, refDocumentId: d.ref_document_id, creditDays: d.credit_days, receiveAccount: d.receive_account, deposits,
        lines: iv.lines.map((l) => ({ lineType: l.line_type, productCode: l.product_code, description: l.description, qty: l.qty ?? undefined, unitPrice: l.unit_price ?? undefined, discount: l.discount, vat: l.vat_rate !== null, accountCode: l.account_code })),
      });
      if (!r.ok) { setMsg(r.error); return; }
      setMsg(null);
      router.refresh();
    }, 700);
    return () => clearTimeout(t);
  }, [key]);

  const d = iv?.doc;
  const depositSum = fromCents((iv?.settlementsIn ?? []).filter((s) => s.doc_type === 'DP').reduce((s, x) => s + toCents(x.applied), 0n));
  const net = d ? subMoney(d.subtotal, d.discount) : '0.00';
  const selected = new Set(Object.entries(pick).filter(([, v]) => v.on).map(([k]) => k));
  const ivTotals: Totals | null = iv && d ? {
    lines: iv.lines.filter((l) => l.line_type === 'item').map((l) => ({ gross: l.amount, amount: l.amount })), subtotal: d.subtotal, discount: d.discount, net, vatBase: net, exemptBase: '0.00', vat: d.vat, grandTotal: d.grand_total, amountText: '',
  } : null;
  const usedDp = rows.find((r) => selected.has(r.id));
  // ③ ตัดมัดจำในใบกำกับ — engine จริงด้วยสูตรของใบกำกับ (ลงจริงเมื่ออนุมัติ)
  const step3 = usePreview({ rule: d?.rule_code ?? '', docType: 'IV', totals: ivTotals, lineAccounts: (iv?.lines ?? []).filter((l) => l.line_type === 'item').map((l) => l.account_code), deposit: depositSum, ...(d ? { grandTotal: d.grand_total } : {}) }, null);

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}><span style={css('color: #525252')}>ขาย / เงินมัดจำ</span>
        {/* TODO(M5): มัดจำจ่ายให้ผู้ขาย (ฝั่งซื้อ) */}
        <div role="group" style={css('display: inline-flex; border: 1px solid #8d8d8d; border-radius: 4px; overflow: hidden')}><button aria-pressed="true" style={css('height: 32px; padding: 0 12px; border: 0; border-radius: 0; background: #0f62fe; color: #ffffff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer')}>มัดจำรับจากลูกค้า</button><button aria-pressed="false" style={css('height: 32px; padding: 0 12px; border: 0; border-radius: 0; background: #ffffff; color: #161616; font-family: inherit; font-size: 14px; font-weight: 400; cursor: pointer')}>มัดจำจ่ายให้ผู้ขาย</button></div></header>
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}><div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>เงินมัดจำรับจากลูกค้า</h1><span style={css('font-size: 13px; color: #525252')}>ออกใบแจ้งหนี้มัดจำ → รับเงินและออกใบกำกับภาษี/ใบเสร็จ (จุดภาษีเกิดเมื่อรับเงิน) → ตัดมัดจำในใบกำกับงานจริง</span></div><ButtonLink href="/sales/deposits/new" kind="primary" size={36}>+ ใบแจ้งหนี้มัดจำ</ButtonLink></div>
        <div style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          <div><span style={css('color: #525252; font-size: 13px')}>มัดจำคงค้าง (หนี้สิน 2140100)</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(summary.liability)}</div><span style={css('color: #525252')}>{summary.openCount} รายการ · {summary.openCustomers} ลูกค้า</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>แจ้งหนี้มัดจำ รอรับเงิน</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(summary.pendingTotal)}</div><span style={css('color: #525252')}>{summary.pendingCount} ใบ · ยังไม่ลงบัญชี</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>ตัดมัดจำเดือนนี้</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(summary.appliedMonth)}</div><span style={css('color: #525252')}>ใน {summary.appliedInvoices} ใบกำกับ</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>ค้างเกิน 180 วัน</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: #684e00')}>{money(summary.stale)}</div><span style={css('color: #684e00')}>ตรวจสอบว่างานยกเลิก/คืนเงิน</span></div>
        </div>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 1100px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เลขที่</th><th style={css(TH)}>วันที่</th><th style={css(TH)}>ลูกค้า</th><th style={css(TH)}>อ้างอิง (ใบเสนอราคา/สัญญา)</th><th style={css(THN)}>มัดจำ (รวม VAT)</th><th style={css(THN)}>รับแล้ว</th><th style={css(THN)}>ตัดแล้ว</th><th style={css(THN)}>คงเหลือ</th><th style={css(TH)}>สถานะ</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} style={css(selected.has(r.id) ? 'border-top: 1px solid #e0e0e0; background: #e0e0e0' : 'border-top: 1px solid #e0e0e0')}>
                <td style={css('height: 40px; padding: 0 12px')}><a href={`/sales/deposits/${r.id}`} style={css('text-decoration: none; font-weight: 500')}>{r.docNo}</a></td>
                <td style={css('padding: 0 12px; font-variant-numeric: tabular-nums')}>{thaiDate(r.date)}</td>
                <td style={css('padding: 0 12px')}>{r.contact}</td>
                <td style={css('padding: 0 12px')}>{r.ref}</td>
                <td style={css(NUM)}>{money(r.total)}</td>
                <td style={css(toCents(r.received) === 0n ? NUMG : NUM)}>{money(r.received)}</td>
                <td style={css(toCents(r.applied) === 0n ? NUMG : NUM)}>{money(r.applied)}</td>
                <td style={css(toCents(r.remaining) === 0n ? NUMG : NUM)}>{money(r.remaining)}</td>
                <td style={css('padding: 0 12px')}><Tag kind={r.status.kind}>{r.status.text}</Tag></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('border: 1px solid #0f62fe; display: flex; flex-direction: column')}>
            <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; background: #edf5ff; gap: 8px; flex-wrap: wrap')}>
              <strong style={css('font-weight: 600')}>ตัดมัดจำในใบกำกับภาษี {d ? `${docNo(d)} (ร่าง) — ${iv?.contact?.name ?? ''}` : '—'}</strong>
              {/* TODO(Wei): แบบร่างไม่ได้กำหนดวิธีเลือกใบกำกับที่จะตัดมัดจำ — ใช้รายการใบกำกับร่างของลูกค้าที่มีมัดจำคงเหลือ */}
              {candidates.length > 1
                ? <select aria-label="ใบกำกับภาษีร่าง" value={d?.id ?? ''} onChange={(e) => router.push(`/sales/deposits?iv=${e.target.value}`)} style={css('height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 13px')}>{candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                : <span style={css('font-size: 13px; color: #525252')}>เลือกมัดจำที่จะตัด</span>}
            </div>
            {iv && d ? <>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}><tbody>
                <tr><td style={css('height: 36px; padding: 0 16px')}>มูลค่างานงวดนี้ ({iv.lines.find((l) => l.line_type === 'item')?.description ?? '—'})</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(net)}</td></tr>
                {available.map((r) => (
                  <tr key={r.id} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 36px; padding: 0 16px')}><label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={pick[r.id]?.on ?? false} onChange={(e) => setPick({ ...pick, [r.id]: { amount: pick[r.id]?.amount ?? money(r.remainingBase), on: e.target.checked } })} /> หัก มัดจำ {r.docNo} (คงเหลือ {money(r.remainingBase)} ก่อน VAT)</label></td>
                    <td style={css('text-align: right; padding: 0 16px')}><input aria-label={`ยอดหักมัดจำ ${r.docNo}`} value={pick[r.id]?.amount ?? ''} onChange={(e) => setPick({ ...pick, [r.id]: { on: pick[r.id]?.on ?? true, amount: e.target.value } })} style={css('width: 130px; height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; font-variant-numeric: tabular-nums')} /></td>
                  </tr>
                ))}
                <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css('height: 36px; padding: 0 16px')}>มูลค่าที่ต้องเสียภาษีงวดนี้</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(subMoney(net, depositSum))}</td></tr>
                <tr><td style={css('height: 36px; padding: 0 16px')}>VAT 7% (เฉพาะส่วนที่ยังไม่เคยเสีย)</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(d.vat)}</td></tr>
                <tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}><td style={css('height: 40px; padding: 0 16px')}>ยอดเรียกเก็บลูกค้า</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums; font-size: 16px')}>{money(d.grand_total)}</td></tr>
              </tbody></table>
              {msg && <div role="status" style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #a2191f')}>{msg}</div>}
              {/* backend: มัดจำรับเงินและออกใบกำกับในเอกสาร DP เดียวกัน → อ้างเลขที่/วันที่ของ DP */}
              <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>บนใบกำกับพิมพ์: แสดงบรรทัด &quot;หัก เงินมัดจำตามใบกำกับภาษีเลขที่ {usedDp?.receivedNo ?? '—'} ลงวันที่ {usedDp ? thaiDate(usedDp.date) : '—'}&quot; ตามแนวปฏิบัติกรมสรรพากร · รายงานภาษีขายไม่ซ้ำ</div>
            </> : (
              <div style={css('padding: 12px 16px; font-size: 14px; color: #525252; display: flex; gap: 12px; align-items: center; flex-wrap: wrap')}>— <ButtonLink href="/sales/invoices/new" size={32}>สร้างใบกำกับภาษี</ButtonLink></div>
            )}
          </section>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <div style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}>
              <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่างการลงบัญชี</strong><span style={css('font-size: 13px; color: #525252')}>3 ขั้น</span></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 13px')}><tbody>
                {/* TODO(Wei): ① แบบร่างบอกว่าแจ้งหนี้มัดจำไม่ลงบัญชี แต่ backend ลงบัญชี DP ตอนอนุมัติเป็นการรับเงินมัดจำ (สูตร Deposit[DP]) */}
                <tr><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #525252')}>① แจ้งหนี้มัดจำ DP — ไม่ลงบัญชี (เป็นเอกสารแจ้งเท่านั้น)</td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #525252')}>② รับเงินมัดจำ {usedDp?.receivedNo ?? '—'} + ใบกำกับภาษี</td></tr>
                {(usedDp?.journal ?? []).map((j, i) => <JRow key={i} j={j} names={names} />)}
                <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #525252')}>③ ตัดมัดจำใน {d ? docNo(d) : '—'}</td></tr>
                {step3.rows.map(([side, acc, amt], i) => <JRow key={i} j={{ journal_no: '', line_no: i, account_code: acc, name: '', debit: side === 'Dr' ? amt : '0.00', credit: side === 'Cr' ? amt : '0.00' }} names={names} />)}
                {step3.err && <tr><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #a2191f')}>{step3.err}</td></tr>}
              </tbody></table>
            </div>
            {/* TODO(M5): ฝั่งผู้ขาย (มัดจำจ่าย) · รายงานมัดจำจ่ายคงค้าง */}
            <div style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 6px')}><strong>ฝั่งผู้ขาย (มัดจำจ่าย) — แท็บถัดไป</strong><span style={css('color: #525252')}>จ่ายมัดจำ → Dr 1140100 เงินมัดจำจ่ายล่วงหน้า / Dr 1170100 ภาษีซื้อ / Cr 1100100 · หัก ณ ที่จ่ายตอนจ่ายมัดจำตามฐานมัดจำ · ตัดมัดจำในบิลซื้อ AP: Dr ค่าใช้จ่าย / Cr 1140100 / Cr 2110100 ส่วนที่เหลือ (หัก ณ ที่จ่ายเฉพาะยอดที่จ่ายจริงเพิ่ม)</span><span style={css('color: #525252')}>รายงานมัดจำจ่ายคงค้าง — รายการ · —</span></div>
          </section>
        </div>
      </div>
    </>
  );
}

function JRow({ j, names }: { j: DocDetail['journal'][number]; names: Record<string, string> }) {
  const dr = toCents(j.debit) !== 0n;
  return (
    <tr>
      <td style={css(dr ? 'height: 28px; padding: 0 16px' : 'height: 28px; padding: 0 16px 0 32px')}>{dr ? 'Dr' : 'Cr'} {j.account_code} {names[j.account_code] ?? j.name}</td>
      {dr ? <><td style={css('width: 100px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(j.debit)}</td><td style={css('width: 100px')}></td></>
        : <><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(j.credit)}</td></>}
    </tr>
  );
}
