'use client';
// F3 จ่ายชำระ — design/project/ScreenPayment.dc.html (ใช้ทั้งรอบจ่ายใหม่ และดูรอบจ่าย/ใบสำคัญจ่ายที่สร้างแล้ว)
// กติกา (CLAUDE.md): หัก ณ ที่จ่ายรับรู้ตอนจ่ายจริง · 50 ทวิ ออกต่อการจ่าย · เข้า ภ.ง.ด.3/53 เดือนที่จ่าย · ฟรีแลนซ์ = ค่าตั้ง "รอยืนยัน"
// TODO(Wei) ScreenPayment.dc.html: แบบร่างมีแต่สถานะ "จ่ายแล้ว" — สถานะรอบจ่ายใหม่ (ปุ่ม "ส่งอนุมัติ") · รออนุมัติ (ป้าย "รออนุมัติ" + ปุ่ม "อนุมัติ" ในสายอนุมัติ)
//   และช่องข้อมูลเช็ค (ชื่อช่องยืมจาก ScreenCheque.dc.html) ไม่มีในไฟล์
// TODO(Wei) ScreenPayment.dc.html: "+ จ่ายรายการเดียว" — ตีความเป็นโหมดเลือกบิลได้ใบเดียว → POST /v1/payments (รองรับเช็ค) · รอบจ่าย → POST /v1/payment-runs
// บัญชีรับโอน = contact.bank_account (ทะเบียนผู้ติดต่อ) · ไม่มี → "ยังไม่มีบัญชีธนาคาร" ตามข้อความแบบร่าง (ยังไม่บังคับห้ามเลือก — ไฟล์โอนชุดจะไม่สร้างถ้ามีผู้ขายไม่มีบัญชี)
// TODO(Wei) ScreenPayment.dc.html: แบบร่างแสดง "[ธนาคาร] xxx-x-x1234-x" แต่ fixtures contacts.bank มีแค่เลขที่บัญชี (ไม่มีชื่อธนาคาร) → แสดงตามที่บันทึกในทะเบียน
// สายอนุมัติ: วงเงินขั้น 2 จาก GET /v1/approval-settings (ค่าตั้งบริษัท) · เกินวงเงิน = ผู้จัดการอนุมัติ (ขั้น 2) แล้วกรรมการอนุมัติ (ขั้น 3) คนละคน — ปุ่ม "อนุมัติ" เดียวกัน API ตัดสินขั้นเอง
import { Button, ButtonLink, buttonStyle, css, href, money, parseThaiDate, S, Tag, thaiDate, thaiMonth, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { cents, fromCents } from '../_shared/num';
import { docVoidHref } from '../_shared/types';

export interface BillRow {
  id: string; docNo: string; contactId: string; contact: string; due: string;
  outstanding: string; wht: string; pct: string | null; paid: string; pendingAuditor: boolean; whtError: string | null;
  tms: boolean; cnr: string | null; exempt: boolean; desc: string | null;
  paidOn: string | null; pvId: string | null; bank: string | null;
}
export interface Cert { id: string; certNo: string; pnd: string; pendingAuditor: boolean; paymentId: string }
/** level = approval_level (0 ยังไม่อนุมัติ · 2 ผู้จัดการอนุมัติแล้ว · 3 กรรมการอนุมัติแล้ว) */
export interface PvInfo { id: string; docNo: string | null; status: string; contact: string; paid: string; level: number }
export interface PaymentView {
  id: string; docNo: string | null; status: string; date: string; payFrom: string; method: string; batchRef: string | null;
  pvs: PvInfo[]; certs: Cert[]; balance: { before: string; after: string } | null;
  submittedAt: string | null; l2At: string | null; approvedAt: string | null; voidReason: string | null;
  /** ชื่อผู้จัดทำ/ผู้อนุมัติจาก Innovera ID (GET /v1/documents/:id events[].actor_name · approved_by_name) */
  submittedBy: string | null; l2By: string | null; approvedBy: string | null;
}
interface Props { mode: 'new' | 'view'; today: string; rows: BillRow[]; view?: PaymentView; accountNames: Record<string, string>; l2Limit: string }

// ตัวเลือกตามแบบร่าง (ตัวอักษรตามไฟล์)
const PAY_FROM: [string, string][] = [['1100100', '1100100 ออมทรัพย์ [ธนาคาร A]'], ['1100200', '1100200 กระแสรายวัน [ธนาคาร B]']];
const METHOD: [string, string][] = [['bulk_transfer', 'โอนเป็นชุด (ไฟล์ธนาคาร)'], ['cheque', 'เช็ค — พิมพ์จากระบบ'], ['promptpay', 'PromptPay']];
/** วงเงินในป้ายสายอนุมัติ: '1000000.00' → '1,000,000' (ตามรูปแบบในแบบร่าง) */
const limitText = (v: string) => money(v).replace(/\.00$/u, '');

const LABEL = 'flex: 1 1 220px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const BOX = 'flex: 1 1 380px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px';
const ROW = 'display: flex; justify-content: space-between';

const isoParts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
/** '2026-11-28' → '28 พ.ย.' */
const dayMonth = (iso: string) => { const p = isoParts(iso); return `${p.d} ${thaiMonth(p.m)}`; };
const longDate = (iso: string) => `${dayMonth(iso)} ${isoParts(iso).y + 543}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** วันสิ้นเดือนของวันที่ */
function monthEnd(iso: string): string {
  const p = isoParts(iso);
  const last = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  return `${iso.slice(0, 8)}${String(last).padStart(2, '0')}`;
}
/** timestamp → 'DD/MM HH:MM' (เวลาไทย) */
function stamp(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** 'PV2611-0031', 'PV2611-0033' → 'PV2611-0031–0033' */
function noRange(nos: string[], sep: string): string {
  if (!nos.length) return '';
  if (nos.length === 1) return nos[0]!;
  const a = nos[0]!;
  const b = nos.at(-1)!;
  const i = a.lastIndexOf('-');
  return a.slice(0, i) === b.slice(0, b.lastIndexOf('-')) ? `${a}${sep}${b.slice(i + 1)}` : `${a}${sep}${b}`;
}
const bankLabel = (name: string | undefined) => (name ?? '').replace(/^เงินฝากธนาคาร\s*(ออมทรัพย์|กระแสรายวัน|ประจำ)?\s*/u, '').replace(/[[\]]/gu, '');

export function PaymentScreen({ mode, today, rows, view, accountNames, l2Limit }: Props) {
  const router = useRouter();
  const ro = mode === 'view';
  const [date, setDate] = useState(thaiDate(view?.date ?? today));
  const [payFrom, setPayFrom] = useState(view?.payFrom ?? '1100100');
  const [method, setMethod] = useState(view?.method ?? 'bulk_transfer');
  const [single, setSingle] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(ro ? rows.map((r) => r.id) : []));
  const [cheque, setCheque] = useState({ no: '', bank: '', date: '' });
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const iso = parseThaiDate(date);

  // ยอดบัญชีจ่ายจาก ณ วันที่จ่าย (รอบใหม่) — จากบัญชีแยกประเภทจริง
  useEffect(() => {
    if (ro || !iso) return;
    const ctl = new AbortController();
    void fetch(`/api/proxy/ledger?account=${payFrom}&from=${iso}&to=${iso}`, { signal: ctl.signal })
      .then(async (r) => { const t = (await r.json()) as { closing?: string }; setBalance(r.ok ? (t.closing ?? null) : null); }).catch(() => undefined);
    return () => ctl.abort();
  }, [ro, iso, payFrom]);

  const chosen = rows.filter((r) => sel.has(r.id));
  const sum = (k: 'outstanding' | 'wht' | 'paid') => chosen.reduce((s, r) => s + cents(r[k]), 0n);
  const vendors = new Set(chosen.map((r) => r.contactId)).size;
  const paidTotal = sum('paid');
  const before = ro ? view?.balance?.before ?? null : balance;
  const after = ro ? view?.balance?.after ?? null : balance === null ? null : fromCents(cents(balance) - paidTotal);
  const dueTo = iso ? monthEnd(iso) : null;
  const firstOfVendor = useMemo(() => {
    const seen = new Set<string>();
    return new Set(rows.filter((r) => { const k = `${r.pvId ?? ''}:${r.contactId}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((r) => r.id));
  }, [rows]);

  function toggle(r: BillRow, on: boolean) {
    if (ro || r.whtError) return;
    if (single) { setSel(on ? new Set([r.id]) : new Set()); return; }
    const n = new Set(sel);
    if (on) n.add(r.id); else n.delete(r.id);
    setSel(n);
  }
  function pullDue() {
    if (!dueTo) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    setSingle(false);
    setSel(new Set(rows.filter((r) => !r.whtError && r.due <= dueTo).map((r) => r.id)));
  }

  async function submit() {
    setMsg(null);
    if (!iso) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    if (!chosen.length) { setMsg({ kind: 'err', text: 'เลือกบิลอย่างน้อย 1 ใบ' }); return; }
    setBusy(true);
    let res: Response;
    if (single) {
      const r = chosen[0]!;
      const chq = method === 'cheque' && cheque.no.trim() ? { chequeNo: cheque.no.trim(), bank: cheque.bank.trim(), chequeDate: parseThaiDate(cheque.date) ?? '' } : null;
      res = await fetch('/api/proxy/payments', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId: r.contactId, date: iso, payFrom, bills: [{ documentId: r.id }], method, cheque: chq }) });
    } else {
      const t = new Date();
      const batchRef = `PAYRUN-${isoParts(iso).y + 543}-${iso.slice(5, 7)}-${iso.slice(8, 10)}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
      res = await fetch('/api/proxy/payment-runs', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: iso, payFrom, billIds: chosen.map((r) => r.id), batchRef, method }) });
    }
    const out = (await res.json()) as { id?: string; vouchers?: { id: string }[]; error?: string | string[] };
    setBusy(false);
    const first = out.id ?? out.vouchers?.[0]?.id;
    if (!res.ok || !first) { setMsg({ kind: 'err', text: Array.isArray(out.error) ? out.error.join(' · ') : (out.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    router.push(`${href('payment')}/${first}`);
  }

  async function approve() {
    if (!view) return;
    setMsg(null);
    setBusy(true);
    const done: string[] = [];
    // ขั้นที่ยังค้าง: ใบที่ยังไม่ผ่านขั้น 2 ก่อน · ผ่านขั้น 2 ครบแล้ว = ขั้น 3 (กรรมการ)
    const waiting = view.pvs.filter((x) => x.status === 'pending_approval');
    const step2 = waiting.filter((x) => x.level < 2);
    for (const p of step2.length ? step2 : waiting) {
      const res = await fetch(`/api/proxy/payments/${p.id}/approve`, { method: 'POST' });
      const out = (await res.json()) as { docNo?: string | null; error?: string | string[] };
      if (!res.ok) {
        setBusy(false);
        setMsg({ kind: 'err', text: `${done.length ? `อนุมัติแล้ว ${done.join(', ')} · ` : ''}${Array.isArray(out.error) ? out.error.join(' · ') : (out.error ?? 'อนุมัติไม่สำเร็จ')}` });
        if (done.length) router.refresh();
        return;
      }
      done.push(out.docNo ?? '');
    }
    setBusy(false);
    router.refresh();
  }

  // ---------- สถานะ (ดู) ----------
  const pvs = view?.pvs ?? [];
  const live = pvs.filter((p) => p.status !== 'voided');
  const allPosted = ro && live.length > 0 && live.every((p) => p.status === 'posted');
  const pending = ro && live.some((p) => p.status === 'pending_approval');
  const voided = ro && view!.status === 'voided';
  const pvNos = live.map((p) => p.docNo).filter((x): x is string => Boolean(x));
  const certs = (view?.certs ?? []).slice().sort((a, b) => a.certNo.localeCompare(b.certNo));
  const pnds = [...new Set(certs.map((c) => c.pnd))].sort();
  const needDirector = (ro ? live.reduce((s, p) => s + cents(p.paid), 0n) : paidTotal) > cents(l2Limit);
  const waiting = live.filter((p) => p.status === 'pending_approval');
  const l2Done = ro && live.length > 0 && live.every((p) => p.status === 'posted' || p.level >= 2);
  const runLabel = iso ? dayMonth(iso) : '';
  const isRun = !ro || Boolean(view?.batchRef);
  const title = isRun ? `รอบจ่ายชำระ ${iso ? longDate(iso) : ''}` : `จ่ายชำระ ${view?.docNo ?? ''}`;
  const crumb = `การเงิน / จ่ายชำระ / ${isRun ? `รอบจ่าย ${runLabel}` : (view?.docNo ?? '')}`;
  const nextMonth = iso ? thaiMonth((isoParts(iso).m % 12) + 1) : '';
  const bank = bankLabel(accountNames[payFrom]);
  // ชื่อธนาคารในข้อความไฟล์โอนชุดตามแบบร่าง "[ธนาคาร A]" (ส่วนในวงเล็บของชื่อบัญชี)
  const bankTag = /\[[^\]]+\]/u.exec(accountNames[payFrom] ?? '')?.[0] ?? bank;

  return (
    <>
      <TopBar crumb={crumb} right={
        allPosted ? <Tag kind="success">{`จ่ายแล้ว ${ddmm(view!.date)} · ${noRange(pvNos, '–')}`}</Tag>
          : voided ? <Tag kind="error">ยกเลิกแล้ว</Tag>
          : pending ? <Tag kind="warning">รออนุมัติ</Tag> : undefined} />
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1240px; box-sizing: border-box')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css(S.h1)}>{title}</h1><span style={css(S.sub)}>รวมบิลครบกำหนดหลายผู้ขายเป็นชุดเดียว · หัก ณ ที่จ่ายอัตโนมัติ · ส่งไฟล์โอนธนาคาร</span></div>
          <div style={css('display: flex; gap: 8px')}>
            {ro ? (<>
              {/* ดูรอบที่จ่ายแล้ว → ปุ่มพาไปเริ่มรอบจ่ายใหม่ */}
              <ButtonLink href={href('payment')} size={36}>{`ดึงบิลครบกำหนดถึง ${dueTo ? dayMonth(dueTo) : ''}`}</ButtonLink>
              <ButtonLink href={href('payment')} size={36}>+ จ่ายรายการเดียว</ButtonLink>
            </>) : (<>
              <Button size={36} onClick={pullDue}>{`ดึงบิลครบกำหนดถึง ${dueTo ? dayMonth(dueTo) : ''}`}</Button>
              <Button size={36} kind={single ? 'primary' : 'secondary'} aria-pressed={single} onClick={() => { setSingle(!single); setSel(new Set()); }}>+ จ่ายรายการเดียว</Button>
            </>)}
          </div>
        </div>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; font-size: 14px')}>
          <label style={css(LABEL)}>จ่ายจาก<select disabled={ro} value={payFrom} onChange={(e) => setPayFrom(e.target.value)} style={css(`${INPUT}${ro ? '; color: #161616; opacity: 1' : ''}`)}>
            {PAY_FROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!PAY_FROM.some(([v]) => v === payFrom) && <option value={payFrom}>{`${payFrom} ${accountNames[payFrom] ?? ''}`}</option>}
          </select></label>
          <label style={css(LABEL)}>วิธีจ่าย<select disabled={ro} value={method} onChange={(e) => setMethod(e.target.value)} style={css(`${INPUT}${ro ? '; color: #161616; opacity: 1' : ''}`)}>
            {METHOD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!METHOD.some(([v]) => v === method) && <option value={method}>{method === 'cash' ? 'เงินสด' : method}</option>}
          </select></label>
          <label style={css(LABEL)}>วันที่จ่าย<input readOnly={ro} value={date} onChange={(e) => setDate(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          <div style={css('flex: 1 1 220px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>{`ยอด${bank} ก่อน → หลังจ่าย (${iso ? ddmm(iso) : ''})`}
            <span style={css('height: 40px; display: flex; align-items: center; font-size: 15px; color: #161616; font-variant-numeric: tabular-nums')}>{before === null ? '—' : <>{money(before)} → <strong style={css('margin-left: 6px')}>{money(after)}</strong></>}</span></div>
          {!ro && single && method === 'cheque' && (<>
            <label style={css(LABEL)}>เลขเช็ค<input value={cheque.no} onChange={(e) => setCheque({ ...cheque, no: e.target.value })} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>ธนาคาร<input value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>วันที่บนเช็ค<input value={cheque.date} placeholder="วว/ดด/ปปปป" onChange={(e) => setCheque({ ...cheque, date: e.target.value })} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          </>)}
        </div>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 1000px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css('height: 40px; width: 40px; padding: 0 12px')}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={rows.length > 0 && chosen.length === rows.filter((r) => !r.whtError).length} aria-readonly={ro || single || undefined}
                onChange={(e) => { if (!ro && !single) setSel(e.target.checked ? new Set(rows.filter((r) => !r.whtError).map((r) => r.id)) : new Set()); }} style={css('width: 16px; height: 16px; margin: 0')} /></th>
              <th style={css(S.th)}>ผู้ขาย</th><th style={css(S.th)}>บิล</th><th style={css(S.th)}>ครบกำหนด</th><th style={css(S.th)}>บัญชีรับโอน</th>
              <th style={css(`${S.th}; text-align: right`)}>ค้างจ่าย</th><th style={css(`${S.th}; text-align: right`)}>หัก ณ ที่จ่าย</th><th style={css(`${S.th}; text-align: right`)}>จ่ายจริง</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const on = sel.has(r.id);
                const late = r.due < (r.paidOn ?? iso ?? r.due);
                return (
                  <tr key={r.id} style={css(`border-top: 1px solid #e0e0e0${on ? '' : '; color: #525252'}`)}>
                    <td style={css('height: 40px; padding: 0 12px')}><input type="checkbox" checked={on} aria-readonly={ro || undefined} disabled={!ro && Boolean(r.whtError)} onChange={(e) => toggle(r, e.target.checked)} style={css('width: 16px; height: 16px; margin: 0')} aria-label="เลือก" /></td>
                    <td style={css(TD)}>{r.contact}</td>
                    <td style={css(TD)}><a href={`${href('purchase')}/${r.id.split(':').at(-1)}`} style={css('text-decoration: none')}>{r.docNo}</a>
                      {r.tms && <> <span style={css('display: inline-block; padding: 0 6px; background: #393939; color: #ffffff; font-size: 11px; line-height: 18px; border-radius: 4px')}>TMS</span></>}
                      {r.cnr && <> <span style={css('color: #525252')}>{`หลัง ${r.cnr}`}</span></>}
                      {r.exempt && <>{r.desc ? ` ${r.desc}` : ''} <span style={css('color: #525252')}>ยกเว้น VAT</span></>}</td>
                    <td style={css(late ? 'padding: 0 12px; color: #a2191f' : TD)}>{thaiDate(r.due)}{r.paidOn && late ? ` · จ่ายแล้ว ${ddmm(r.paidOn)}` : ''}</td>
                    <td style={css(!firstOfVendor.has(r.id) ? 'padding: 0 12px; color: #525252' : r.bank ? TD : 'padding: 0 12px; color: #a2191f')}>{!firstOfVendor.has(r.id) ? 'รวมโอนครั้งเดียว' : (r.bank ?? 'ยังไม่มีบัญชีธนาคาร')}</td>
                    <td style={css(NUM)}>{money(r.outstanding)}</td>
                    <td style={css(`${NUM}; white-space: nowrap`)}>{r.whtError ? <span style={css('color: #a2191f')}>{r.whtError}</span> : <>{money(r.wht)}{r.pct && cents(r.wht) > 0n && <> <span style={css('color: #525252')}>{r.pct}</span></>}{r.pendingAuditor && <> <span style={css('color: #684e00')}>รอยืนยัน</span></>}</>}</td>
                    <td style={css(NUM)}>{money(r.paid)}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr style={css(S.tr)}><td colSpan={8} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}>
              <td colSpan={5} style={css('height: 40px; padding: 0 12px')}>{`เลือก ${chosen.length} บิล · ${vendors} ผู้ขาย · ${vendors} รายการโอน`}</td>
              <td style={css(NUM)}>{money(fromCents(sum('outstanding')))}</td><td style={css(NUM)}>{money(fromCents(sum('wht')))}</td><td style={css(NUM)}>{money(fromCents(paidTotal))}</td>
            </tr></tfoot>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          {allPosted && (
            <section style={css(BOX)}><strong>{`เมื่ออนุมัติและจ่าย (ทำแล้ว ${ddmm(view!.date)}) ระบบได้`}</strong>
              {/* TODO(M6): แบบร่างต่อท้าย "· จับคู่ statement 28/11 แล้ว" — แสดงเมื่อมีกระทบยอดธนาคารของรอบจ่ายจริง */}
              <span>{`· สร้าง ${noRange(pvNos, '…')} แยกตามผู้ขาย (1 ใบ = 1 รายการโอน)`}</span>
              {certs.length > 0 && <span>· ออก 50 ทวิ {certs.length} ฉบับ (<span>{certs.map((c, i) => <span key={c.id}>{i ? ', ' : ''}<a href={`/print/wht50/${c.id}`} style={css('text-decoration: none')}>{c.certNo}</a>{c.pendingAuditor && <span style={css('color: #684e00')}> รอยืนยัน</span>}</span>)}</span>) {`เข้า ${pnds.map((p) => `ภ.ง.ด.${p}`).join(' / ')} เดือน ${isoParts(view!.date).m}`}</span>}
              {/* TODO(Wei): รูปแบบไฟล์ Bulk Payment ของธนาคารยังไม่ได้รับ spec — API สร้าง CSV กลาง (GET /v1/payment-runs/:batchRef/bulk-file) */}
              {view!.batchRef && <span>· <a href={`/api/proxy/payment-runs/${encodeURIComponent(view!.batchRef)}/bulk-file`} download style={css('text-decoration: none')}>{`สร้างไฟล์โอนชุดสำหรับ ${bankTag} (รูปแบบ Bulk Payment) ให้ดาวน์โหลดไปอัปโหลด`}</a></span>}
              {/* TODO(M7): "แจ้ง TMS ว่าบิลของผู้รับเหมาขนส่งถูกจ่ายแล้ว (payment.paid)" — แสดงเมื่อมี webhook จริง */}
            </section>
          )}
          <section style={css(BOX)}><strong>สายอนุมัติ</strong>
            <div style={css(ROW)}><span>1. บัญชี จัดทำ</span>{ro && view!.submittedAt ? <span style={css('color: #0e6027')}>{`เสร็จ · ${view!.submittedBy ? `${view!.submittedBy} ` : ''}${ddmm(new Date(new Date(view!.submittedAt).getTime() + 7 * 3_600_000).toISOString().slice(0, 10))}`}</span> : <span style={css('color: #525252')}>—</span>}</div>
            <div style={css(ROW)}><span>{`2. ผู้จัดการบัญชี อนุมัติ (≤ ${limitText(l2Limit)})`}</span>
              {needDirector && l2Done && view!.l2At ? <span style={css('color: #0e6027')}>{`อนุมัติ · ${view!.l2By ? `${view!.l2By} ` : ''}${stamp(view!.l2At)}`}</span>
                : allPosted && view!.approvedAt ? <span style={css('color: #0e6027')}>{`อนุมัติ · ${view!.approvedBy ? `${view!.approvedBy} ` : ''}${stamp(view!.approvedAt)}`}</span>
                : pending && !l2Done ? <Button kind="primary" size={32} disabled={busy} onClick={() => void approve()}>อนุมัติ</Button>
                : <span style={css('color: #525252')}>—</span>}</div>
            <div style={css(needDirector ? ROW : `${ROW}; color: #525252`)}><span>{`3. กรรมการ (เกิน ${limitText(l2Limit)})`}</span>
              {!needDirector ? <span>ไม่ต้อง</span>
                : allPosted && view!.approvedAt ? <span style={css('color: #0e6027')}>{`อนุมัติ · ${view!.approvedBy ? `${view!.approvedBy} ` : ''}${stamp(view!.approvedAt)}`}</span>
                : pending && l2Done && waiting.length > 0 ? <Button kind="primary" size={32} disabled={busy} onClick={() => void approve()}>อนุมัติ</Button>
                : <span style={css('color: #525252')}>ต้องอนุมัติ</span>}</div>
          </section>
        </div>
        {voided && view!.voidReason && <div role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #da1e28; font-size: 14px')}>{`ยกเลิกแล้ว · ${view!.voidReason}`}</div>}
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: flex-end; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0')}>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {ro ? (<>
            <a href={`/print/payment-voucher/${view!.id}`} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>ดูตัวอย่างใบสำคัญจ่าย</a>
            <a href={`/print/payment-voucher/${view!.id}/pdf`} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>พิมพ์ใบสำคัญจ่าย</a>
            {view!.status !== 'voided' && <ButtonLink href={docVoidHref(view!.id)} kind="danger">บันทึกรับคืนเงิน / ยกเลิก</ButtonLink>}
            <ButtonLink href={href('payment')} kind="primary">{`สร้างรอบจ่ายถัดไป (${nextMonth})`}</ButtonLink>
          </>) : (
            <Button kind="primary" disabled={busy || !chosen.length} onClick={() => void submit()}>ส่งอนุมัติ</Button>
          )}
        </div>
      </div>
    </>
  );
}
