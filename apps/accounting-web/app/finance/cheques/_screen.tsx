'use client';
// F3 ทะเบียนเช็ค — design/project/ScreenCheque.dc.html
// รับเช็ค → นำฝาก → ผ่าน / คืน · ลงบัญชีตามสูตร CHQ-IN ฝั่ง API (POST /v1/cheques/deposit · /:id/clear)
// TODO(Wei) ScreenCheque.dc.html: ไม่มีปุ่มบันทึกเช็คคืนในแบบร่าง (API POST /v1/cheques/:id/bounce พร้อมแล้ว)
// TODO(Wei) ScreenCheque.dc.html: แบบร่างมีแต่มุมมองเช็ครับ — มุมมองเช็คจ่ายใช้โครงเดียวกัน (หัวเรื่อง "ทะเบียนเช็คจ่าย" · สรุปยอดค้างผ่าน · ป้ายสถานะเช็คจ่าย) ยังไม่มีแบบร่าง
// TODO(Wei) ScreenCheque.dc.html: แบบร่างไม่ได้กำหนดลำดับแถว — เรียงตามขั้นงาน (ในมือ → นำฝาก → คืน → ผ่าน) แล้ววันที่บนเช็ค ซึ่งได้ลำดับเดียวกับแบบร่าง
import { Button, ButtonLink, css, href, money, S, shortDate, Tag, thaiDate, thaiMonth, TopBar, type TagKind } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

interface Sum { total: string; count: number }
export interface ChequeRow {
  id: string; cheque_no: string; bank: string; branch: string | null; cheque_date: string; amount: string; status: string;
  deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; received_on: string | null; bounce_reason: string | null;
  document_id: string | null; doc_no: string | null; ref: string | null; payer: string | null;
  postdated: boolean; dueToday: boolean; overdueClearing: boolean;
}
export interface ChequeRegister {
  today: string;
  summary: { onHand: Sum & { postdated: number }; deposited: Sum; dueToday: Sum; dueTodayReceivedToday: number; bounced90: Sum; issuedOutstanding: Sum };
  rows: ChequeRow[];
}
type Direction = 'received' | 'issued';

const TD = 'padding: 0 12px';
const NUMTD = 'padding: 0 12px; font-variant-numeric: tabular-nums';
const FILTER = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';
const CARD_LABEL = 'color: #525252; font-size: 13px';
const CARD_NUM = 'font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums';
const MUTED = 'color: #525252';
const TOGGLE = 'height: 32px; padding: 0 12px; border: 0; border-radius: 0; font-family: inherit; font-size: 14px; cursor: pointer';
const STATUS_FILTER: [string, string][] = [['', 'ทุกสถานะ'], ['on_hand', 'ในมือ'], ['deposited', 'นำฝากแล้ว'], ['cleared', 'ผ่าน'], ['bounced', 'คืน']];
const DATE_FILTER: [string, string][] = [['', 'วันที่บนเช็ค: ทั้งหมด'], ['week', 'ถึงกำหนดสัปดาห์นี้'], ['postdated', 'ลงวันที่ล่วงหน้า']];
// ลำดับขั้นงาน (สิ่งที่ต้องทำก่อนอยู่บน)
const RANK: Record<string, number> = { on_hand: 0, issued: 0, presented: 1, deposited: 1, bounced: 2, cleared: 3 };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** จันทร์–อาทิตย์ของสัปดาห์ที่มีวันนี้ */
function weekOf(iso: string): [string, string] {
  const w = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const mon = addDays(iso, w === 0 ? -6 : 1 - w);
  return [mon, addDays(mon, 6)];
}
/** '2026-12-15' → '15 ธ.ค.' */
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${thaiMonth(Number(iso.slice(5, 7)))}`;

function chip(r: ChequeRow, direction: Direction): { kind: TagKind; text: string } {
  if (r.status === 'cleared') return { kind: 'success', text: `ผ่าน ${r.cleared_on ? shortDate(r.cleared_on) : ''}` };
  if (r.status === 'bounced') return { kind: 'error', text: `คืน · ${r.bounce_reason ?? ''}` };
  if (r.status === 'deposited') return { kind: 'info', text: `นำฝาก ${r.deposited_on ? shortDate(r.deposited_on) : ''} · รอผ่าน${r.overdueClearing ? ' (เกิน 3 วันทำการ)' : ''}` };
  if (r.dueToday) return { kind: 'warning', text: 'ในมือ · ฝากวันนี้' };
  if (r.postdated) return { kind: 'info', text: 'ในมือ · ล่วงหน้า' };
  // TODO(Wei) ScreenCheque.dc.html: ไม่มีป้ายสถานะเช็คจ่าย (issued / presented) ในแบบร่าง
  if (direction === 'issued' && (r.status === 'issued' || r.status === 'presented')) return { kind: 'info', text: 'รอผ่าน' };
  return { kind: 'neutral', text: r.status };
}

export function ChequeScreen({ direction, today, register }: { direction: Direction; today: string; register: ChequeRegister }) {
  const router = useRouter();
  const { summary } = register;
  const rows = useMemo(() => [...register.rows].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.cheque_date.localeCompare(b.cheque_date) || a.cheque_no.localeCompare(b.cheque_no)), [register.rows]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [when, setWhen] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(register.rows.filter((r) => r.dueToday).map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [mon, sun] = weekOf(today);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (needle && ![r.cheque_no, r.payer ?? '', r.bank].some((v) => v.toLowerCase().includes(needle))) return false;
    if (status && r.status !== status) return false;
    if (when === 'week' && !(r.cheque_date >= mon && r.cheque_date <= sun)) return false;
    if (when === 'postdated' && !(r.cheque_date > today)) return false;
    return true;
  });
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r.id));

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    const s = new Set(selected);
    for (const r of shown) { if (allChecked) s.delete(r.id); else s.add(r.id); }
    setSelected(s);
  }

  async function post(path: string, body: unknown, ok: string) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/proxy/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = (await res.json().catch(() => ({}))) as { error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: ok });
    router.refresh();
  }
  const deposit = (r: ChequeRow) => void post('cheques/deposit', { ids: [r.id], date: today }, `นำฝากเช็ค ${r.cheque_no} แล้ว`);
  const clear = (r: ChequeRow) => void post(`cheques/${r.id}/clear`, { date: today }, `บันทึกเช็ค ${r.cheque_no} ผ่านแล้ว`);

  function action(r: ChequeRow) {
    if (r.status === 'on_hand' && r.dueToday) return <td style={css(TD)}><Button size={32} disabled={busy} onClick={() => deposit(r)}>นำฝาก</Button></td>;
    if (r.status === 'on_hand' && r.postdated) return <td style={css('padding: 0 12px; color: #525252; font-size: 13px')}>{`ฝากได้ ${dayMonth(r.cheque_date)}`}</td>;
    if (r.status === 'deposited' || (direction === 'issued' && (r.status === 'issued' || r.status === 'presented'))) return <td style={css(TD)}><Button size={32} disabled={busy} onClick={() => clear(r)}>บันทึกผ่าน</Button></td>;
    if (r.status === 'bounced') return <td style={css('padding: 0 12px; color: #525252; font-size: 13px')}>กลับเป็นลูกหนี้แล้ว</td>;
    return <td style={css(TD)}></td>;
  }

  const go = (d: Direction) => { if (d !== direction) router.push(`${href('cheque')}?direction=${d}`); };
  const received = direction === 'received';

  return (
    <>
      <TopBar crumb="การเงิน / ทะเบียนเช็ค" right={
        <div role="group" style={css('display: inline-flex; border: 1px solid #8d8d8d; border-radius: 4px; overflow: hidden')}>
          <button type="button" aria-pressed={received} onClick={() => go('received')} style={css(`${TOGGLE}; ${received ? 'background: #0f62fe; color: #ffffff; font-weight: 600' : 'background: #ffffff; color: #161616; font-weight: 400'}`)}>เช็ครับ</button>
          <button type="button" aria-pressed={!received} onClick={() => go('issued')} style={css(`${TOGGLE}; ${!received ? 'background: #0f62fe; color: #ffffff; font-weight: 600' : 'background: #ffffff; color: #161616; font-weight: 400'}`)}>เช็คจ่าย</button>
        </div>} />
      <div style={css(S.content)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css(S.h1)}>{received ? 'ทะเบียนเช็ครับ' : 'ทะเบียนเช็คจ่าย'}</h1><span style={css(S.sub)}>ติดตามสถานะตั้งแต่รับเช็ค → นำฝาก → ผ่าน / คืน และลงบัญชีให้ทุกขั้น</span></div>
          <div style={css('display: flex; gap: 8px')}>
            {/* TODO(Wei) ScreenCheque.dc.html: ไม่มีแบบร่างแบบพิมพ์ใบนำฝาก — ปุ่มเป็นสถานะ "ใช้ไม่ได้" ไปก่อน */}
            <Button size={36} disabled title="ยังไม่มีแบบพิมพ์ใบนำฝาก">พิมพ์ใบนำฝาก</Button>
            {/* หน้ารับชำระใหม่ยังไม่รับพารามิเตอร์วิธีรับเงิน (เช็ค) — เลือกวิธีรับเงินในฟอร์ม */}
            <ButtonLink size={36} kind="primary" href={`${href('receipt')}/new`}>+ รับเช็คใหม่</ButtonLink>
          </div>
        </div>
        <div style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          {received ? (
            <>
              <div><span style={css(CARD_LABEL)}>ในมือ รอฝาก</span><div style={css(CARD_NUM)}>{money(summary.onHand.total)}</div><span style={css(MUTED)}>{`${summary.onHand.count} ฉบับ · ลงวันที่ล่วงหน้า ${summary.onHand.postdated}`}</span></div>
              <div><span style={css(CARD_LABEL)}>นำฝากแล้ว รอผ่าน</span><div style={css(CARD_NUM)}>{money(summary.deposited.total)}</div><span style={css(MUTED)}>{`${summary.deposited.count} ฉบับ`}</span></div>
              <div><span style={css(CARD_LABEL)}>{`ถึงกำหนดนำฝากวันนี้ (${shortDate(today)})`}</span><div style={css(`${CARD_NUM}; color: #684e00`)}>{money(summary.dueToday.total)}</div><span style={css(MUTED)}>{`${summary.dueToday.count} ฉบับ${summary.dueTodayReceivedToday > 0 ? ` · รับวันนี้ ${shortDate(today)}` : ''}`}</span></div>
              {/* TODO(backend): "ติดตามแล้ว" — ยังไม่มีสถานะงานติดตามเช็คคืนใน API · แสดงตามข้อความแบบร่างเมื่อมีเช็คคืน */}
              <div><span style={css(CARD_LABEL)}>เช็คคืน 90 วัน</span><div style={css(`${CARD_NUM}; color: #a2191f`)}>{money(summary.bounced90.total)}</div><span style={css(MUTED)}>{`${summary.bounced90.count} ฉบับ${summary.bounced90.count > 0 ? ' · ติดตามแล้ว' : ''}`}</span></div>
            </>
          ) : (
            // TODO(Wei) ScreenCheque.dc.html: ไม่มีแบบร่างสรุปยอดเช็คจ่าย — ใช้ issuedOutstanding (ออกแล้ว/นำเข้าเรียกเก็บ ยังไม่ผ่าน)
            <div><span style={css(CARD_LABEL)}>เช็คจ่าย รอผ่าน</span><div style={css(CARD_NUM)}>{money(summary.issuedOutstanding.total)}</div><span style={css(MUTED)}>{`${summary.issuedOutstanding.count} ฉบับ`}</span></div>
          )}
        </div>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
          <input aria-label="ค้นหา" placeholder="ค้นหาเลขเช็ค / ลูกค้า / ธนาคาร" value={q} onChange={(e) => setQ(e.target.value)} style={css(`${FILTER}; width: 320px`)} />
          <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)} style={css(FILTER)}>{STATUS_FILTER.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select>
          <select aria-label="วันที่บนเช็ค" value={when} onChange={(e) => setWhen(e.target.value)} style={css(FILTER)}>{DATE_FILTER.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
        <section style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 1040px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css('height: 40px; width: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={allChecked} onChange={toggleAll} style={css('width: 16px; height: 16px; margin: 0')} /></th>
              <th style={css(S.th)}>เลขเช็ค</th><th style={css(S.th)}>ธนาคาร / สาขา</th><th style={css(S.th)}>วันที่บนเช็ค</th><th style={css(S.th)}>ผู้จ่าย</th><th style={css(S.th)}>อ้างอิง</th>
              <th style={css(`${S.th}; text-align: right`)}>จำนวนเงิน</th><th style={css(S.th)}>สถานะ</th><th style={css(S.th)}></th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const c = chip(r, direction);
                return (
                  <tr key={r.id} style={css(r.status === 'cleared' ? 'border-top: 1px solid #e0e0e0; color: #525252' : S.tr)}>
                    <td style={css('height: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือก" checked={selected.has(r.id)} onChange={() => toggle(r.id)} style={css('width: 16px; height: 16px; margin: 0')} /></td>
                    <td style={css(NUMTD)}>{r.cheque_no}</td>
                    <td style={css(TD)}>{r.branch ? `${r.bank} ${r.branch}` : r.bank}</td>
                    <td style={css(NUMTD)}>{thaiDate(r.cheque_date)}</td>
                    <td style={css(TD)}>{r.payer ?? ''}</td>
                    <td style={css(TD)}>{r.document_id
                      ? <a href={`${href('receipt')}/${r.document_id}`} style={css('text-decoration: none')}>{r.ref ?? ''}</a>
                      : (r.ref ?? '')}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(r.amount)}</td>
                    <td style={css(TD)}><Tag kind={c.kind}>{c.text}</Tag></td>
                    {action(r)}
                  </tr>
                );
              })}
              {!shown.length && <tr style={css(S.tr)}><td colSpan={9} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
          </table>
        </section>
        <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; max-width: 720px')}>
          <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>การลงบัญชีตามสถานะ (อัตโนมัติ)</strong><span style={css('font-size: 13px; color: #525252')}>สูตร CHQ-IN</span></div>
          <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}><tbody>
            <tr><td style={css('height: 32px; padding: 0 16px; width: 120px; color: #525252')}>รับเช็ค</td><td style={css('padding: 0 16px')}>Dr 1150100 เช็ครับรอเรียกเก็บ / Cr 1130100 ลูกหนี้การค้า</td></tr>
            <tr style={css(S.tr)}><td style={css('height: 32px; padding: 0 16px; color: #525252')}>นำฝาก</td><td style={css('padding: 0 16px')}>Dr 1150200 เช็ครอเรียกเก็บ-นำฝาก / Cr 1150100</td></tr>
            <tr style={css(S.tr)}><td style={css('height: 32px; padding: 0 16px; color: #525252')}>ผ่าน</td><td style={css('padding: 0 16px')}>Dr 1100100 เงินฝากธนาคาร / Cr 1150200 (ยอดตามสมุดบัญชีจะรอตรงกับ statement)</td></tr>
            <tr style={css(S.tr)}><td style={css('height: 32px; padding: 0 16px; color: #525252')}>คืน</td><td style={css('padding: 0 16px')}>กลับรายการ: Dr 1130100 ลูกหนี้การค้า / Cr 1150200 · ตั้งงานติดตามในคิวหน้าแรก</td></tr>
          </tbody></table>
        </section>
      </div>
    </>
  );
}
