'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// รายละเอียดเอกสารสต็อก (Phase 2A INV) — บรรทัด · ความเคลื่อนไหวสต็อก · JV · ผ่านรายการ (POST …/post + lot/serial) · ยกเลิก (POST …/void + เหตุผล = void + reversal)
import { Button, css, href, money, parseThaiDate, S, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { JournalRow } from '../../../finance/_shared/types';
import { call, DOC_TYPE, MOVE_KIND, Msg, qty, StatusTag, TempBanner, unitCost } from '../../_shared/ui';

interface DocLine { id: string; line_no: number; product_code: string | null; description: string | null; qty: string | null; unit: string | null; unit_price: string | null; amount: string; account_code: string | null; counted_qty: string | null; line_type: string }
interface Move { id: string; move_date: string; product_code: string; warehouse_id: string; kind: string; qty: string; unit_cost: string; value: string; lot: string | null; serial: string | null; reversal_of: string | null }
export interface StockDoc {
  doc: { id: string; doc_type: string; doc_no: string | null; status: string; issue_date: string; warehouse_id: string | null; to_warehouse_id: string | null; grand_total: string;
    reference: string | null; notes: string | null; void_reason: string | null; voided_at: string | null };
  lines: DocLine[]; moves: Move[];
}
interface Props {
  today: string; inv: StockDoc; journal: JournalRow[]; contact: string | null; refDoc: { id: string; docNo: string } | null;
  /** at = ข้อความวันเวลาที่จัดรูปแล้วฝั่ง server (กัน hydration ต่างกัน) */
  events: { at: string; event: string; actor: string | null }[]; warehouses: Record<string, string>; err: string | null;
}
type M = { kind: 'ok' | 'err'; text: string } | null;
const TD = S.td;
const ROW = 'height: 40px';
const CELL = 'height: 32px; padding: 0 8px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; box-sizing: border-box; width: 100%';
const EVENT: Record<string, string> = { created: 'สร้าง', edited: 'แก้ไข', posted: 'ผ่านรายการ', voided: 'ยกเลิก' };

export function StockDocScreen({ today, inv, journal, contact, refDoc, events, warehouses, err }: Props) {
  const router = useRouter();
  const d = inv.doc;
  const draft = d.status === 'draft' || d.status === 'pending_approval';
  const [lots, setLots] = useState<Record<number, { lot: string; serial: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(err ? { kind: 'err', text: err } : null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [voidDate, setVoidDate] = useState(thaiDate(today));
  const items = inv.lines.filter((l) => l.line_type === 'item');
  const whName = (id: string | null) => (id ? (warehouses[id] ?? id) : 'คลังตั้งต้น');

  async function post() {
    setBusy(true); setMsg(null);
    const body: Record<number, { lot?: string; serial?: string }> = {};
    for (const [k, v] of Object.entries(lots)) if (v.lot.trim() || v.serial.trim()) body[Number(k)] = { ...(v.lot.trim() ? { lot: v.lot.trim() } : {}), ...(v.serial.trim() ? { serial: v.serial.trim() } : {}) };
    const r = await call<{ docNo: string; journalNo: string | null; total: string }>(`inventory/documents/${d.id}/post`, 'POST', Object.keys(body).length ? { lots: body } : {});
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `ผ่านรายการ ${r.data.docNo}${r.data.journalNo ? ` · ${r.data.journalNo}` : ' · ไม่มี JV (วิธี periodic / โอนคลัง)'} · มูลค่า ${money(r.data.total, { paren: true })}` });
    router.replace(`/inventory/documents/${d.id}`);
    router.refresh();
  }
  async function doVoid() {
    const date = parseThaiDate(voidDate);
    if (!date) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    if (!reason.trim()) { setMsg({ kind: 'err', text: 'ต้องระบุเหตุผลการยกเลิก' }); return; }
    setBusy(true); setMsg(null);
    const r = await call<{ reversalJournalNo?: string | null }>(`inventory/documents/${d.id}/void`, 'POST', { reason: reason.trim(), date });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setVoiding(false);
    setMsg({ kind: 'ok', text: 'ยกเลิกเอกสารแล้ว (กลับรายการสต็อก/JV เลขที่คงเดิม)' });
    router.refresh();
  }

  return (
    <>
      <TopBar crumb={`โมดูลเพิ่มเติม / เอกสารสต็อก / ${d.doc_no ?? 'ร่าง'}`} right={<a href={href('stockdocs')} style={css('color: #0f62fe; font-size: 14px')}>กลับไปรายการ</a>} />
      <div style={css(S.content)}>
        <TempBanner />
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap')}>
          <div>
            <h1 style={css(S.h1)}>{`${DOC_TYPE[d.doc_type] ?? d.doc_type} ${d.doc_no ?? '(ร่าง)'}`}</h1>
            <span style={css(S.sub)}>{`วันที่ ${thaiDate(d.issue_date)} · ${d.doc_type === 'TRF' ? `${whName(d.warehouse_id)} → ${whName(d.to_warehouse_id)}` : whName(d.warehouse_id)}`}</span>
          </div>
          <div style={css('display: flex; gap: 8px; align-items: center')}>
            <StatusTag status={d.status} />
            {draft && <Button kind="primary" size={36} disabled={busy} onClick={() => void post()}>ผ่านรายการ</Button>}
            {d.status === 'posted' && <Button kind="danger" size={36} disabled={busy} onClick={() => setVoiding(!voiding)} aria-expanded={voiding}>ยกเลิกเอกสาร</Button>}
          </div>
        </div>
        {voiding && (
          <section aria-label="ยกเลิกเอกสาร" style={css('border: 1px solid #da1e28; padding: 16px; display: grid; grid-template-columns: 200px 1fr auto; gap: 16px; align-items: end')}>
            <label style={css(S.label)}>วันที่ยกเลิก<input value={voidDate} onChange={(e) => setVoidDate(e.target.value)} style={css(`${S.input}; font-variant-numeric: tabular-nums`)} /></label>
            <label style={css(S.label)}>เหตุผลการยกเลิก<input value={reason} onChange={(e) => setReason(e.target.value)} style={css(S.input)} /></label>
            <div style={css('display: flex; gap: 8px')}><Button onClick={() => setVoiding(false)}>ไม่ยกเลิก</Button><Button kind="danger" disabled={busy || !reason.trim()} onClick={() => void doVoid()}>ยืนยันยกเลิก</Button></div>
          </section>
        )}
        <Msg msg={msg} />
        <dl style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 24px; margin: 0; font-size: 14px')}>
          {[
            ['ผู้ขาย', contact ?? '—'], ['อ้างใบสั่งซื้อ', refDoc?.docNo ?? '—'], ['อ้างอิง', d.reference ?? '—'], ['หมายเหตุ', d.notes ?? '—'],
            ['มูลค่าตามทุน', draft ? '—' : money(d.grand_total, { paren: true })], ['เลขที่ JV', journal[0]?.journal_no ?? '—'],
            ...(d.status === 'voided' ? [['เหตุผลการยกเลิก', d.void_reason ?? '—'] as const] : []),
          ].map(([k, v]) => (
            <div key={k}><dt style={css('color: #525252; font-size: 13px')}>{k}</dt><dd style={css('margin: 0')}>{v}</dd></div>
          ))}
        </dl>
        <h2 style={css('margin: 0; font-size: 16px; font-weight: 600')}>รายการ</h2>
        <section style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 960px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>#</th><th style={css(S.th)}>สินค้า</th><th style={css(`${S.th}; text-align: right`)}>{d.doc_type === 'ADJ' ? 'ผลต่าง' : 'จำนวน'}</th>
              {d.doc_type === 'ADJ' && <th style={css(`${S.th}; text-align: right`)}>ยอดนับได้</th>}
              <th style={css(S.th)}>หน่วย</th><th style={css(`${S.th}; text-align: right`)}>ต้นทุนต่อหน่วย</th><th style={css(`${S.th}; text-align: right`)}>มูลค่า</th><th style={css(S.th)}>บัญชี</th>
              {draft && <><th style={css(`${S.th}; width: 120px`)}>Lot</th><th style={css(`${S.th}; width: 120px`)}>Serial</th></>}
            </tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} style={css(S.tr)}>
                  <td style={css(`${ROW}; ${TD}; color: #525252`)}>{l.line_no}</td>
                  <td style={css(TD)}><a href={`/inventory/stock-card/${encodeURIComponent(l.product_code ?? '')}`} style={css('color: #0f62fe')}>{l.product_code}</a>{` ${l.description ?? ''}`}</td>
                  <td style={css(S.num)}>{qty(l.qty)}</td>
                  {d.doc_type === 'ADJ' && <td style={css(S.num)}>{qty(l.counted_qty)}</td>}
                  <td style={css(TD)}>{l.unit ?? 'หน่วยหลัก'}</td><td style={css(S.num)}>{unitCost(l.unit_price)}</td>
                  <td style={css(S.num)}>{draft ? '' : money(l.amount, { paren: true })}</td><td style={css(TD)}>{l.account_code ?? ''}</td>
                  {draft && <>
                    <td style={css(TD)}><input aria-label={`Lot บรรทัด ${l.line_no}`} value={lots[l.line_no]?.lot ?? ''} onChange={(e) => setLots({ ...lots, [l.line_no]: { lot: e.target.value, serial: lots[l.line_no]?.serial ?? '' } })} style={css(CELL)} /></td>
                    <td style={css(TD)}><input aria-label={`Serial บรรทัด ${l.line_no}`} value={lots[l.line_no]?.serial ?? ''} onChange={(e) => setLots({ ...lots, [l.line_no]: { serial: e.target.value, lot: lots[l.line_no]?.lot ?? '' } })} style={css(CELL)} /></td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {inv.moves.length > 0 && <>
          <h2 style={css('margin: 0; font-size: 16px; font-weight: 600')}>ความเคลื่อนไหวสต็อก</h2>
          <section style={css(S.tableBox)}>
            <table style={css(S.table)}>
              <thead><tr style={css(S.theadRow)}>
                <th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>สินค้า</th><th style={css(S.th)}>คลัง</th><th style={css(S.th)}>ประเภท</th>
                <th style={css(`${S.th}; text-align: right`)}>จำนวน (หน่วยหลัก)</th><th style={css(`${S.th}; text-align: right`)}>ต้นทุนต่อหน่วย</th><th style={css(`${S.th}; text-align: right`)}>มูลค่า</th><th style={css(S.th)}>Lot / Serial</th>
              </tr></thead>
              <tbody>
                {inv.moves.map((m) => (
                  <tr key={m.id} style={css(S.tr)}>
                    <td style={css(`${ROW}; ${TD}; font-variant-numeric: tabular-nums`)}>{thaiDate(m.move_date)}</td><td style={css(TD)}>{m.product_code}</td><td style={css(TD)}>{whName(m.warehouse_id)}</td>
                    <td style={css(TD)}>{`${MOVE_KIND[m.kind] ?? m.kind}${m.reversal_of ? ' (กลับรายการ)' : ''}`}</td>
                    <td style={css(S.num)}>{qty(m.qty)}</td><td style={css(S.num)}>{unitCost(m.unit_cost)}</td><td style={css(S.num)}>{money(m.value, { paren: true })}</td>
                    <td style={css(TD)}>{[m.lot, m.serial].filter(Boolean).join(' / ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>}
        {journal.length > 0 && <>
          <h2 style={css('margin: 0; font-size: 16px; font-weight: 600')}>{`การลงบัญชี ${journal[0]!.journal_no}`}</h2>
          <section style={css(S.tableBox)}>
            <table style={css(S.table)}>
              <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>บัญชี</th><th style={css(`${S.th}; text-align: right`)}>เดบิต</th><th style={css(`${S.th}; text-align: right`)}>เครดิต</th></tr></thead>
              <tbody>
                {journal.map((j) => (
                  <tr key={j.line_no} style={css(S.tr)}>
                    <td style={css(`${ROW}; ${TD}`)}>{`${j.account_code} ${j.name}`}</td><td style={css(S.num)}>{money(j.debit, { blankZero: true })}</td><td style={css(S.num)}>{money(j.credit, { blankZero: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>}
        {events.length > 0 && (
          <p style={css(S.note)}>{`ประวัติ: ${events.map((e) => `${EVENT[e.event] ?? e.event} ${e.at}${e.actor ? ` (${e.actor})` : ''}`).join(' · ')}`}</p>
        )}
      </div>
    </>
  );
}
