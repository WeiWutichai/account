'use client';
// S2 รายการเอกสาร — design/project/ScreenDocList.dc.html (ใบกำกับภาษี / ใบแจ้งหนี้)
// ใช้ซ้ำกับรายการใบเสนอราคา/ใบลดหนี้ (ไม่มีแบบร่างรายการของสองประเภทนี้ — TODO(Wei) อ้าง ScreenQuote/ScreenCreditNote.dc.html ที่มีแต่ฟอร์ม)
import { Button, ButtonLink, css, money, Tag, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client.ts';
import { docHref, docNo, type DocRow, outstandingShown, printHref, statusTag } from './doc.ts';
import { fromCents, toCents } from './num.ts';

type TabId = 'all' | 'draft' | 'pending' | 'outstanding' | 'overdue' | 'paid';
type Range = 'month' | 'prev' | 'year' | 'custom';
const TAB_ON = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600';
const TAB_OFF = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #525252; font-family: inherit; font-size: 14px';
const LINKBTN = 'border: 0; background: none; padding: 0; font-family: inherit; font-size: 14px; color: #0f62fe; cursor: pointer';
const SEL = 'height: 40px; padding: 0 32px 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; color: #161616';

const isOpen = (r: DocRow) => r.status === 'posted' && toCents(r.outstanding) > 0n;
const isOverdue = (r: DocRow, today: string) => isOpen(r) && !!r.due_date && r.due_date < today;

export function DocList({ rows, today, periodLabel, title, crumb, createLabel, createHref, lastReceipt, initialTab = 'all' }: {
  rows: DocRow[]; today: string; periodLabel: string; title: string; crumb: string; createLabel: string; createHref: string;
  lastReceipt: Record<string, string>; initialTab?: TabId;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [per, setPer] = useState(25);
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`;
  const prev = m === 1 ? ym(y - 1, 12) : ym(y, m - 1);

  // TODO(Wei): แบบร่าง "เดือนนี้ (พ.ย. 2569)" แสดงใบเดือนก่อนที่ยังค้างชำระด้วย (IVS2610-0008, IV2610-0048) → เดือนนี้ = ออกในเดือน + ใบที่ยังเปิดอยู่
  const inRange = (r: DocRow): boolean => {
    if (range === 'month') return r.issue_date.startsWith(ym(y, m)) || isOpen(r) || r.status === 'draft' || r.status === 'pending_approval';
    if (range === 'prev') return r.issue_date.startsWith(prev);
    if (range === 'year') return r.issue_date.startsWith(String(y));
    return (!from || r.issue_date >= from) && (!to || r.issue_date <= to);
  };
  const needle = q.trim().toLowerCase();
  // TODO(backend): ค้นหาด้วยเลขผู้เสียภาษี — GET /v1/documents ยังไม่ส่ง tax_id ของลูกค้า
  const matches = (r: DocRow) => !needle || [r.doc_no, r.contact_name, r.contact_code].some((x) => x?.toLowerCase().includes(needle));
  const base = rows.filter((r) => inRange(r) && matches(r));
  const tabRows: Record<TabId, DocRow[]> = {
    all: base,
    draft: base.filter((r) => r.status === 'draft'),
    pending: base.filter((r) => r.status === 'pending_approval'),
    outstanding: base.filter(isOpen),
    overdue: base.filter((r) => isOverdue(r, today)),
    paid: base.filter((r) => r.status === 'posted' && toCents(r.outstanding) <= 0n),
  };
  const list = tabRows[tab];
  const pageRows = list.slice(page * per, page * per + per);
  const live = (xs: DocRow[]) => xs.filter((r) => r.status !== 'voided');
  const sum = (xs: DocRow[], f: (r: DocRow) => string | null) => fromCents(live(xs).reduce((s, r) => s + toCents(f(r)), 0n));
  const selected = rows.filter((r) => sel.has(r.id));
  const monthName = `${thaiMonth(m)} ${y + 543}`;

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id));

  async function submitSelected() {
    const drafts = selected.filter((r) => r.status === 'draft');
    if (!drafts.length) { setMsg('เลือกเอกสารร่างที่จะส่งขออนุมัติ'); return; }
    for (const r of drafts) {
      const res = await call(`documents/${r.id}/submit`, 'POST');
      if (!res.ok) { setMsg(`${docNo(r)}: ${res.error}`); return; }
    }
    setMsg(`ส่งขออนุมัติแล้ว ${drafts.length} รายการ`);
    setSel(new Set());
    router.refresh();
  }
  function printSelected() {
    for (const r of selected) window.open(printHref(r), '_blank', 'noopener');
  }
  async function shareSelected() {
    // TODO(M7): ส่งอีเมลจริง — ตอนนี้สร้างลิงก์สำหรับลูกค้า (ScreenSendDoc.dc.html) แล้วเปิดให้คัดลอกส่งเอง
    for (const r of selected) {
      const res = await call<{ token: string }>(`documents/${r.id}/share`, 'POST');
      if (!res.ok) { setMsg(`${docNo(r)}: ${res.error}`); return; }
      window.open(`/d/${res.data.token}`, '_blank', 'noopener');
    }
  }

  const tabs: [TabId, string][] = [
    ['all', `ทั้งหมด ${tabRows.all.length}`], ['draft', `ร่าง ${tabRows.draft.length}`], ['pending', `รออนุมัติ ${tabRows.pending.length}`],
    ['outstanding', `ค้างชำระ ${tabRows.outstanding.length}`], ['overdue', `เกินกำหนด ${tabRows.overdue.length}`], ['paid', 'ชำระแล้ว'],
  ];
  const TD = 'padding: 0 12px';
  const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>{crumb}</span>
        <span style={css('color: #525252')}>{periodLabel}</span>
      </header>

      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
          <h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>{title}</h1>
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            {/* TODO(Wei): "นำเข้า" ไม่มีแบบร่างขั้นตอนนำเข้าเอกสารขาย (ScreenDocList.dc.html) และยังไม่มี API */}
            <Button size={36}>นำเข้า</Button>
            <ButtonLink href={createHref} kind="primary" size={36}>{createLabel}</ButtonLink>
          </div>
        </div>

        <div role="tablist" aria-label="สถานะ" style={css('display: flex; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setPage(0); }} style={css(tab === id ? TAB_ON : TAB_OFF)}>{label}</button>
          ))}
        </div>

        <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
          <label style={css('display: flex; flex: 1 1 280px; max-width: 400px; height: 40px; background: #f4f4f4; border-bottom: 1px solid #8d8d8d; align-items: center; gap: 8px; padding: 0 16px')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#525252" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
            <span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden')}>ค้นหา</span>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="ค้นหาเลขที่ ลูกค้า เลขผู้เสียภาษี" style={css('flex: 1; border: 0; background: transparent; font-family: inherit; font-size: 14px; color: #161616; outline: none')} />
          </label>
          <select aria-label="ช่วงวันที่" value={range} onChange={(e) => { setRange(e.target.value as Range); setPage(0); }} style={css(SEL)}>
            <option value="month">เดือนนี้ ({monthName})</option><option value="prev">เดือนก่อน</option><option value="year">ปีนี้</option><option value="custom">กำหนดเอง</option>
          </select>
          {range === 'custom' && <>
            <input type="date" aria-label="ตั้งแต่" value={from} onChange={(e) => setFrom(e.target.value)} style={css(SEL)} />
            <input type="date" aria-label="ถึง" value={to} onChange={(e) => setTo(e.target.value)} style={css(SEL)} />
          </>}
          {/* TODO(Wei): "ตัวกรองขั้นสูง" ไม่มีแบบร่างของแผงตัวกรอง (ScreenDocList.dc.html) */}
          <Button kind="ghost" size={36}>ตัวกรองขั้นสูง</Button>
          <span style={css('margin-left: auto; font-size: 13px; color: #525252')}>{list.length} รายการ · ยอดรวม {money(sum(list, (r) => r.grand_total))}</span>
        </div>

        <div style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 980px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
              <th style={css('height: 40px; width: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={allOn} onChange={() => setSel((s) => { const n = new Set(s); for (const r of pageRows) { if (allOn) n.delete(r.id); else n.add(r.id); } return n; })} style={css('width: 16px; height: 16px; margin: 0')} /></th>
              <th style={css('padding: 0 12px; font-weight: 400')}>เลขที่</th><th style={css('padding: 0 12px; font-weight: 400')}>วันที่</th><th style={css('padding: 0 12px; font-weight: 400')}>ครบกำหนด</th><th style={css('padding: 0 12px; font-weight: 400')}>ลูกค้า</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ก่อนภาษี</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>VAT</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ยอดรวม</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ค้างชำระ</th><th style={css('padding: 0 12px; font-weight: 400')}>สถานะ</th>
            </tr></thead>
            <tbody>
              {pageRows.map((r) => {
                const t = statusTag(r, today, lastReceipt[r.id]);
                // TODO(backend): ป้าย TMS (ScreenDocList.dc.html แถว IV2611-0053) — GET /v1/documents ยังไม่ส่ง external_source
                return (
                  <tr key={r.id} style={css(sel.has(r.id) ? 'border-top: 1px solid #e0e0e0; background: #e0e0e0' : 'border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือก" checked={sel.has(r.id)} onChange={() => toggle(r.id)} style={css('width: 16px; height: 16px; margin: 0')} /></td>
                    <td style={css(TD)}><a href={docHref(r)} style={css('font-weight: 500; text-decoration: none')}>{docNo(r)}</a></td>
                    <td style={css(TD)}>{thaiDate(r.issue_date)}</td>
                    <td style={css(TD)}>{r.due_date ? thaiDate(r.due_date) : '—'}</td>
                    <td style={css(TD)}>{r.contact_name ?? '—'}</td>
                    <td style={css(NUM)}>{money(r.subtotal)}</td>
                    <td style={css(NUM)}>{money(r.vat)}</td>
                    <td style={css(NUM)}>{money(r.grand_total)}</td>
                    <td style={css(NUM)}>{money(outstandingShown(r))}</td>
                    <td style={css(TD)}><Tag kind={t.kind}>{t.text}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}>
              <td colSpan={5} style={css('height: 40px; padding: 0 12px')}>รวมหน้านี้ {pageRows.length} รายการ</td>
              <td style={css(NUM)}>{money(sum(pageRows, (r) => r.subtotal))}</td>
              <td style={css(NUM)}>{money(sum(pageRows, (r) => r.vat))}</td>
              <td style={css(NUM)}>{money(sum(pageRows, (r) => r.grand_total))}</td>
              <td style={css(NUM)}>{money(sum(pageRows, (r) => outstandingShown(r) || '0.00'))}</td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>

        {msg && <div role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #0f62fe; font-size: 14px')}>{msg}</div>}

        <div style={css('display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #525252; flex-wrap: wrap; gap: 8px')}>
          <span>เลือก {selected.length} รายการ · <button type="button" onClick={() => void submitSelected()} style={css(LINKBTN)}>ส่งขออนุมัติ</button> · <button type="button" onClick={printSelected} style={css(LINKBTN)}>พิมพ์ PDF</button> · <button type="button" onClick={() => void shareSelected()} style={css(LINKBTN)}>ส่งอีเมล</button></span>
          <span>แถวต่อหน้า <select aria-label="แถวต่อหน้า" value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(0); }} style={css('height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select> · {list.length ? page * per + 1 : 0}–{Math.min(list.length, page * per + per)} จาก {list.length}
            {page > 0 && <> · <button type="button" onClick={() => setPage(page - 1)} style={css(LINKBTN)}>‹ ก่อนหน้า</button></>}
            {(page + 1) * per < list.length && <> · <button type="button" onClick={() => setPage(page + 1)} style={css(LINKBTN)}>ถัดไป ›</button></>}
          </span>
        </div>
      </div>
    </>
  );
}
