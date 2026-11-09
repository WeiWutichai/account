'use client';
// P1 รายการบิลซื้อ — design/project/ScreenPurchaseList.dc.html (Sidebar active="purchase")
// ใช้ซ้ำกับรายการใบสั่งซื้อ / ค่าใช้จ่าย / ใบลดหนี้ซื้อ — TODO(Wei): ไม่มีแบบร่างรายการของสามประเภทนี้ (ScreenPurchaseOrder/ScreenExpense/ScreenPurchaseCreditNote.dc.html มีแต่ฟอร์ม)
import { Button, ButtonLink, css, money, Tag, thaiDate, type TagKind } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { daysBetween } from '../../sales/_lib/doc.ts';
import { fromCents, toCents } from '../../sales/_lib/num.ts';
import { monthBE, pDocNo, pHref, type PRow, pStatusTag } from './types.ts';

export interface ListRow extends PRow { vendor_ref: string | null; external_source: string | null; pay_now: boolean; outstanding: string | null; po: { received: number; lines: number } | null }
type TabId = 'all' | 'review' | 'open' | 'due7' | 'po' | 'paid';
type Source = 'all' | 'manual' | 'tms' | 'ocr';
export interface ListVariant { title: string; crumb: string; create: { label: string; href: string }; bills: boolean }

const TAB_ON = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600';
const TAB_OFF = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #525252; font-family: inherit; font-size: 14px';
const LINKBTN = 'border: 0; background: none; padding: 0; font-family: inherit; font-size: 14px; color: #0f62fe; cursor: pointer';
const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const PER = 25;

const isOpen = (r: ListRow) => r.status === 'posted' && toCents(r.outstanding) > 0n;
const isPoOpen = (r: ListRow) => r.doc_type === 'PO' && r.status === 'approved' && !!r.po && r.po.received < r.po.lines;

export function PurchaseList({ rows, today, periodLabel, variant }: { rows: ListRow[]; today: string; periodLabel: string; variant: ListVariant }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('all');
  const [q, setQ] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  // เลขใบกำกับซ้ำ: ผู้ขายเดียวกัน + เลขเดียวกัน กับบิลอื่นที่ไม่ยกเลิก
  const dup = (r: ListRow) => !!r.vendor_ref && r.doc_type === 'AP' && rows.some((x) => x.id !== r.id && x.doc_type === 'AP' && x.status !== 'voided' && x.contact_id === r.contact_id && x.vendor_ref?.trim() === r.vendor_ref?.trim());
  const needle = q.trim().toLowerCase();
  const matches = (r: ListRow) => !needle || [r.doc_no, r.contact_name, r.contact_code, r.vendor_ref].some((x) => x?.toLowerCase().includes(needle));
  const fromSource = (r: ListRow) => source === 'all' || (source === 'manual' ? !r.external_source : r.external_source === source);
  const base = rows.filter((r) => matches(r) && fromSource(r));
  const tabRows: Record<TabId, ListRow[]> = {
    all: base,
    review: base.filter((r) => r.status === 'pending_approval'),
    open: base.filter(isOpen),
    due7: base.filter((r) => isOpen(r) && !!r.due_date && daysBetween(today, r.due_date) >= 0 && daysBetween(today, r.due_date) <= 7),
    po: base.filter(isPoOpen),
    paid: base.filter((r) => r.status === 'posted' && ['AP', 'EXP', 'DNR'].includes(r.doc_type) && toCents(r.outstanding) <= 0n),
  };
  const list = tabRows[tab];
  const pageRows = list.slice(page * PER, page * PER + PER);
  const openTotal = fromCents(rows.filter(isOpen).reduce((s, r) => s + toCents(r.outstanding), 0n));
  const selected = rows.filter((r) => sel.has(r.id));
  const allOn = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function payRun() {
    const bills = selected.filter(isOpen);
    if (!bills.length) { setMsg('เลือกบิลที่ค้างจ่าย'); return; }
    // TODO(M5): หน้าใบสำคัญจ่าย/รอบจ่ายเป็นของ app/finance/payments (agent อื่น) — ส่งบิลที่เลือกทาง query ?bills=
    router.push(`/finance/payments/new?bills=${bills.map((b) => b.id).join(',')}`);
  }

  const tag = (r: ListRow): { kind: TagKind; text: string } => {
    if (r.doc_type === 'PO' && r.status === 'approved' && r.po) {
      // TODO(Wei): "PO ค้างรับ 2/5" — แบบร่างไม่บอกว่านับอะไร → นับบรรทัดที่รับบิลครบ / บรรทัดทั้งหมด
      return r.po.received < r.po.lines ? { kind: 'info', text: `PO ค้างรับ ${r.po.received}/${r.po.lines}` } : { kind: 'success', text: 'อนุมัติแล้ว' };
    }
    return pStatusTag(r, today, r.outstanding, dup(r));
  };
  const outShown = (r: ListRow): string => {
    if (dup(r) || r.doc_type === 'PO' || r.doc_type === 'PR') return '';
    if (r.status === 'pending_approval') return r.grand_total;
    return isOpen(r) ? r.outstanding ?? '' : '';
  };
  const vatMonth = (r: ListRow): string => {
    if (r.doc_type === 'PO' || r.doc_type === 'PR' || r.status === 'draft' || dup(r)) return '—';
    // TODO(backend): เดือนที่ใช้ภาษีซื้อ (เลื่อนได้) และ ภ.พ.36 ยังไม่มีฟิลด์ → ใช้เดือนตามบิล
    return toCents(r.vat) === 0n ? 'ยกเว้น' : monthBE(r.issue_date);
  };

  const tabs: [TabId, string][] = [
    ['all', `ทั้งหมด ${tabRows.all.length}`], ['review', `รอตรวจ ${tabRows.review.length}`], ['open', `ค้างจ่าย ${tabRows.open.length}`],
    ['due7', `ครบกำหนด 7 วัน ${tabRows.due7.length}`], ['po', `ใบสั่งซื้อค้างรับ ${tabRows.po.length}`], ['paid', 'จ่ายแล้ว'],
  ];

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}><span style={css('color: #525252')}>{variant.crumb}</span><span style={css('color: #525252')}>{periodLabel}</span></header>
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
          <h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>{variant.title}</h1>
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            {/* TODO(backend): อัปโหลดบิล/OCR ยังไม่มี API */}
            {variant.bills && <Button size={36}>อัปโหลดบิล (OCR)</Button>}
            {variant.bills && <ButtonLink href="/purchase/orders/new" size={36} extra="border-left: 0">ใบสั่งซื้อ</ButtonLink>}
            <ButtonLink href={variant.create.href} kind="primary" size={36}>{variant.create.label}</ButtonLink>
          </div>
        </div>

        <div role="tablist" aria-label="สถานะ" style={css('display: flex; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          {tabs.map(([id, text]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setPage(0); }} style={css(tab === id ? TAB_ON : TAB_OFF)}>{text}</button>)}
        </div>

        <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
          <label style={css('display: flex; flex: 1 1 280px; max-width: 400px; height: 40px; background: #f4f4f4; border-bottom: 1px solid #8d8d8d; align-items: center; padding: 0 16px')}>
            <span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden')}>ค้นหา</span>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="ค้นหาผู้ขาย เลขใบกำกับผู้ขาย" style={css('flex: 1; border: 0; background: transparent; font-family: inherit; font-size: 14px; outline: none')} />
          </label>
          <select aria-label="แหล่งที่มา" value={source} onChange={(e) => { setSource(e.target.value as Source); setPage(0); }} style={css('height: 40px; padding: 0 32px 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')}>
            <option value="all">ทุกแหล่ง</option><option value="manual">กรอกเอง</option><option value="tms">จาก TMS</option><option value="ocr">OCR</option>
          </select>
          <span style={css('margin-left: auto; font-size: 13px; color: #525252')}>ค้างจ่ายรวม {money(openTotal)}</span>
        </div>

        <div style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 980px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
              <th style={css('height: 40px; width: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={allOn} onChange={() => setSel((s) => { const n = new Set(s); for (const r of pageRows) { if (allOn) n.delete(r.id); else n.add(r.id); } return n; })} style={css('width: 16px; height: 16px; margin: 0')} /></th>
              <th style={css('padding: 0 12px; font-weight: 400')}>เลขที่</th><th style={css('padding: 0 12px; font-weight: 400')}>ใบกำกับผู้ขาย</th><th style={css('padding: 0 12px; font-weight: 400')}>วันที่บิล</th><th style={css('padding: 0 12px; font-weight: 400')}>ครบกำหนด</th><th style={css('padding: 0 12px; font-weight: 400')}>ผู้ขาย</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ยอดรวม</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ค้างจ่าย</th><th style={css('padding: 0 12px; font-weight: 400')}>ภาษีซื้อเดือน</th><th style={css('padding: 0 12px; font-weight: 400')}>สถานะ</th>
            </tr></thead>
            <tbody>
              {pageRows.map((r) => {
                const t = tag(r);
                const isDup = dup(r);
                return (
                  <tr key={r.id} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือก" checked={sel.has(r.id)} onChange={() => toggle(r.id)} style={css('width: 16px; height: 16px; margin: 0')} /></td>
                    <td style={css(TD)}><a href={pHref(r)} style={css('font-weight: 500; text-decoration: none')}>{pDocNo(r)}</a>{r.external_source === 'tms' && <> <span style={css('font-size: 11px; padding: 1px 6px; background: #393939; color: #ffffff; border-radius: 4px')}>TMS</span></>}</td>
                    <td style={css(r.vendor_ref ? TD : 'padding: 0 12px; color: #525252')}>{r.vendor_ref ? (isDup ? <span style={css('color: #a2191f')}>{r.vendor_ref}</span> : r.vendor_ref) : '—'}</td>
                    <td style={css(TD)}>{thaiDate(r.issue_date)}</td>
                    <td style={css(r.due_date ? TD : 'padding: 0 12px; color: #525252')}>{r.due_date ? thaiDate(r.due_date) : '—'}</td>
                    <td style={css(TD)}>{r.contact_name ?? '—'}</td>
                    <td style={css(NUM)}>{money(r.grand_total)}</td>
                    <td style={css(NUM)}>{money(outShown(r))}</td>
                    <td style={css('padding: 0 12px; color: #525252')}>{vatMonth(r)}</td>
                    <td style={css(TD)}><Tag kind={t.kind}>{t.text}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {msg && <div role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #0f62fe; font-size: 14px')}>{msg}</div>}

        <div style={css('display: flex; justify-content: space-between; font-size: 14px; color: #525252; flex-wrap: wrap; gap: 8px')}>
          <span>เลือก {selected.length} รายการ · <button type="button" onClick={payRun} style={css(LINKBTN)}>ทำใบสำคัญจ่ายรวม</button> · <button type="button" onClick={() => window.print()} style={css(LINKBTN)}>พิมพ์</button></span>
          <span>{list.length ? page * PER + 1 : 0}–{Math.min(list.length, page * PER + PER)} จาก {list.length}
            {page > 0 && <> · <button type="button" onClick={() => setPage(page - 1)} style={css(LINKBTN)}>‹ ก่อนหน้า</button></>}
            {(page + 1) * PER < list.length && <> · <button type="button" onClick={() => setPage(page + 1)} style={css(LINKBTN)}>ถัดไป ›</button></>}
          </span>
        </div>
      </div>
    </>
  );
}
