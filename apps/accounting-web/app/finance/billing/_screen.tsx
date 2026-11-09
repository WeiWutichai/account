'use client';
// F1 ใบวางบิล / รับวางบิล — design/project/ScreenBilling.dc.html (ใช้ทั้งสร้างใหม่และดูใบที่ออกแล้ว)
// TODO(M5): ปุ่ม "รับวางบิลผู้ขาย (BNR)" — ฝั่งซื้อทำใน M5 · ตอนนี้แสดงตามแบบร่างแต่ยังไม่ทำงาน
// TODO(Wei): แบบร่างมีแต่สถานะ "ออกแล้ว" — ปุ่ม "บันทึก" ของใบวางบิลใหม่ไม่มีในไฟล์
// TODO(Wei): "รอบวางบิล: ทุกวันที่ 1 และ 16 · นัดรับเช็ค: วันพฤหัส" ใต้ช่องลูกค้า — ข้อมูลคู่ค้ายังไม่มีรอบวางบิล/วันนัดรับเช็ค (ต้องเพิ่มใน ScreenContacts) จึงยังไม่แสดง
// TODO(Wei): กล่อง "ส่งใบวางบิล" (อีเมล/พิมพ์ต้นฉบับ) — ยังไม่มีระบบส่งอีเมล · คงข้อความตามแบบร่าง (รวม ap@[ลูกค้า].co.th) และยังไม่ทำงาน
import { Button, ButtonLink, buttonStyle, css, href, money, parseThaiDate, S, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cents, fromCents } from '../_shared/num';
import { PRINT } from '../_shared/types';

export interface BillRow { id: string; docNo: string; issue: string; due: string | null; ref: string; total: string; outstanding: string; checked: boolean }
export interface CalendarRow { due: string; weekday: string; text: string; amount: string; tone: 'ok' | 'part' | 'late' | 'none' }
export interface BillingView { id: string; docNo: string; issue: string; due: string | null; sent: boolean; received: string; receipts: string[]; outstanding: string; total: string }
interface Props {
  mode: 'new' | 'view';
  today: string;
  contacts: { id: string; code: string; name: string }[];
  contact: { id: string; code: string; name: string } | null;
  rows: BillRow[];
  calendar: CalendarRow[];
  view?: BillingView;
}

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const TONE: Record<CalendarRow['tone'], string> = { ok: 'color: #0e6027', part: 'color: #684e00', late: 'color: #a2191f', none: '' };
const SEG = 'height: 32px; padding: 0 12px; border: 0; border-radius: 0; font-family: inherit; font-size: 14px; cursor: pointer';
const label = (c: { code: string; name: string }) => `${c.code} · ${c.name}`;

/** วันสุดท้ายของเดือน (YYYY-MM-DD) */
function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function BillingScreen({ mode, today, contacts, contact, rows: initialRows, calendar, view }: Props) {
  const router = useRouter();
  const ro = mode === 'view';
  const [contactText, setContactText] = useState(contact ? label(contact) : '');
  const [date, setDate] = useState(thaiDate(view?.issue ?? today));
  const [due, setDue] = useState(view?.due ? thaiDate(view.due) : '');
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cutoff = monthEnd(parseThaiDate(date) ?? today);
  const picked = rows.filter((r) => r.checked);
  const total = ro ? cents(view!.total) : picked.reduce((s, r) => s + cents(r.outstanding), 0n);

  function pickContact(text: string) {
    setContactText(text);
    const c = contacts.find((x) => label(x) === text);
    if (c && c.id !== contact?.id) router.push(`${href('bn')}/new?contact=${c.id}`);
  }
  async function save() {
    setMsg(null);
    const iso = parseThaiDate(date);
    const dueIso = due.trim() ? parseThaiDate(due) : null;
    if (!iso || (due.trim() && !dueIso)) { setMsg('วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)'); return; }
    if (!contact) { setMsg('เลือกลูกค้า'); return; }
    setBusy(true);
    const res = await fetch('/api/proxy/billings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id, date: iso, dueDate: dueIso, documentIds: picked.map((r) => r.id) }) });
    const r = (await res.json()) as { id?: string; error?: string | string[] };
    setBusy(false);
    if (!res.ok || !r.id) { setMsg(Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ')); return; }
    router.push(`${href('bn')}/${r.id}`);
  }

  const sub = view ? [
    `${view.sent ? 'ออกและส่งแล้ว' : 'ออกแล้ว'} ${thaiDate(view.issue).slice(0, 5)}`,
    view.due ? `นัดรับเงิน ${thaiDate(view.due).slice(0, 5)}` : null,
    cents(view.received) > 0n ? `${cents(view.outstanding) > 0n ? 'รับชำระบางส่วนแล้ว' : 'รับชำระแล้ว'} ${money(view.received)}${view.receipts.length ? ` (${view.receipts.join(', ')})` : ''}` : null,
    `ค้าง ${money(view.outstanding)}`,
  ].filter(Boolean).join(' · ') : 'ใบวางบิลไม่ลงบัญชี · เมื่อรับเงินจะสร้างใบเสร็จอ้างอิงเลขนี้';

  return (
    <>
      <header style={css(S.topbar)}><span style={css(S.crumb)}>การเงิน / ใบวางบิล / {view?.docNo ?? 'ใหม่'}</span>
        <div role="group" style={css('display: inline-flex; border: 1px solid #8d8d8d; border-radius: 4px; overflow: hidden')}>
          <button type="button" aria-pressed="true" style={css(`${SEG}; background: #0f62fe; color: #ffffff; font-weight: 600`)}>วางบิลลูกค้า (BN)</button>
          <button type="button" aria-pressed="false" style={css(`${SEG}; background: #ffffff; color: #161616; font-weight: 400`)}>รับวางบิลผู้ขาย (BNR)</button>
        </div>
      </header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css(S.h1)}>ใบวางบิล{view ? ` ${view.docNo}` : ''}</h1><span style={css(S.sub)}>{sub}</span></div>
        <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <label style={css(`grid-column: span 2; ${LABEL}`)}>ลูกค้า<input readOnly={ro} list={ro ? undefined : 'bn-contacts'} value={contactText} onChange={(e) => pickContact(e.target.value)} style={css(INPUT)} />
            {!ro && <datalist id="bn-contacts">{contacts.map((c) => <option key={c.id} value={label(c)} />)}</datalist>}</label>
          <label style={css(LABEL)}>วันที่วางบิล<input readOnly={ro} value={date} onChange={(e) => setDate(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(LABEL)}>วันนัดรับเงิน<input readOnly={ro} value={due} placeholder={ro ? undefined : 'วว/ดด/ปปปป'} onChange={(e) => setDue(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
        </section>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}><span>ใบกำกับค้างชำระของลูกค้า · เลือกที่จะวางบิล</span>
            <Button size={32} onClick={() => { if (!ro) setRows(rows.map((r) => ((r.due ?? r.issue) <= cutoff ? { ...r, checked: true } : r))); }}>{`เลือกทั้งหมดที่ครบกำหนดก่อน ${Number(cutoff.slice(8))} ${thaiMonth(Number(cutoff.slice(5, 7)))}`}</Button></div>
          <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css(S.theadRow)}><th style={css('height: 40px; width: 40px; padding: 0 12px')}></th><th style={css(S.th)}>เลขที่</th><th style={css(S.th)}>วันที่</th><th style={css(S.th)}>ครบกำหนด</th><th style={css(S.th)}>อ้างอิง</th><th style={css(`${S.th}; text-align: right`)}>ยอดรวม</th><th style={css(`${S.th}; text-align: right`)}>ค้างชำระ</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={css(`border-top: 1px solid #e0e0e0${r.checked ? '; background: #e0e0e0' : ''}`)}>
                  <td style={css('height: 40px; padding: 0 12px')}><input type="checkbox" checked={r.checked} aria-readonly={ro || undefined} aria-label="เลือก" onChange={(e) => { if (!ro) setRows(rows.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x))); }} style={css('width: 16px; height: 16px; margin: 0')} /></td>
                  <td style={css(S.td)}><a href={`${href('invoice')}/${r.id}`} style={css('text-decoration: none; font-weight: 500')}>{r.docNo}</a></td>
                  <td style={css(S.td)}>{thaiDate(r.issue)}</td>
                  <td style={css(S.td)}>{r.due ? thaiDate(r.due) : '—'}</td>
                  <td style={css('padding: 0 12px; color: #525252')}>{r.ref}</td>
                  <td style={css(S.num)}>{money(r.total)}</td>
                  <td style={css(S.num)}>{money(r.outstanding)}</td>
                </tr>
              ))}
              {!rows.length && <tr style={css(S.tr)}><td colSpan={7} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}><td colSpan={6} style={css('height: 40px; padding: 0 12px')}>{ro ? rows.filter((r) => r.checked).length : picked.length} ใบ · ยอดวางบิล</td><td style={css(S.num)}>{money(fromCents(total))}</td></tr></tfoot>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap')}>
          <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>ส่งใบวางบิล</strong>
            <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" defaultChecked /> อีเมลถึง ap@[ลูกค้า].co.th พร้อม PDF และลิงก์ชำระ</label>
            <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" /> พิมพ์ต้นฉบับสำหรับไปวางบิลที่สำนักงาน</label>
            <span style={css('color: #525252')}>ใบวางบิลไม่ลงบัญชี · เมื่อรับเงินจะสร้างใบเสร็จอ้างอิงเลขนี้</span></section>
          <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>ปฏิทินนัดรับเงิน (รอบนี้และรอบถัดไป)</strong>
            <table style={css('border-collapse: collapse; width: 100%')}><tbody>
              {calendar.map((c, i) => (
                <tr key={i} style={TONE[c.tone] ? css(TONE[c.tone]) : undefined}><td style={css('height: 28px')}>{c.weekday} {Number(c.due.slice(8))} {thaiMonth(Number(c.due.slice(5, 7)))}</td><td>{c.text}</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(c.amount)}</td></tr>
              ))}
            </tbody></table></section>
        </div>
        {msg && <div role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #da1e28; font-size: 14px')}>{msg}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: flex-end; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; align-items: center')}>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {view ? (<>
            <a href={PRINT.billing(view.id)} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>ดูตัวอย่างพิมพ์</a>
            {cents(view.outstanding) > 0n && <ButtonLink href={`${href('receipt')}/new?billing=${view.id}`} kind="primary">{`รับชำระส่วนที่เหลือ ${money(view.outstanding)}`}</ButtonLink>}
          </>) : <Button kind="primary" disabled={busy || !picked.length} onClick={() => void save()}>บันทึก</Button>}
        </div>
      </div>
    </>
  );
}
