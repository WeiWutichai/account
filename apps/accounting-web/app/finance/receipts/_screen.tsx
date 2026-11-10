'use client';
// F2 รับชำระ — design/project/ScreenReceipt.dc.html (ใช้ทั้งรับชำระใหม่และดูใบที่ลงบัญชีแล้ว)
// TODO(Wei): แบบร่างมีแต่สถานะ "ลงบัญชีแล้ว" — ปุ่มบันทึกของรับชำระใหม่ ("ลงบัญชี") และช่องข้อมูลเช็ค (เมื่อรับเข้า 1150100) ไม่มีในไฟล์
//   ชื่อช่องเช็คยืมจาก ScreenCheque.dc.html (เลขเช็ค · ธนาคาร / สาขา · วันที่บนเช็ค) · ใบที่ลงบัญชีแล้วแสดงเช็คจาก cheques[] (อ่านอย่างเดียว)
// TODO(Wei): แบบร่างแสดงตัวอย่างการลงบัญชี 4 บรรทัด + หมายเหตุการโอน 2150400 → 2150100 — หน้าจอแสดงทุกบรรทัดของ journal จริง (รวม 2 บรรทัดโอนภาษีขาย)
import { Button, ButtonLink, buttonStyle, css, money, parseThaiDate, S, Tag, thaiDate, TopBar, href } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { P2A_OFF, type P2A } from '../../_p2a/types';
import { P2A_INPUT, P2A_LABEL, rateText, TempHint, toThb } from '../../_p2a/ui';
import { cents, fromCents, norm, pctToBp, bpToRate, rateToPct, roundDiv } from '../_shared/num';
import { docVoidHref, PRINT, type Account, type Cheque, type DocDetail, type DocRow, type JournalRow } from '../_shared/types';

export interface Row {
  id: string; docNo: string; due: string | null; outstanding: string; grandTotal: string; vat: string; taxMode: string | null;
  desc: string | null; vatDueBefore: string; checked: boolean; applied: string; wht: string; whtBase: string | null; remaining: string | null;
  /** P2A: สกุลของใบแจ้งหนี้ (ยอดในแถวเป็นสกุลนี้) */
  currency?: string;
}
export interface ReceiptView {
  doc: DocDetail['doc']; contactLabel: string; cheque: Cheque | null; journal: JournalRow[]; billingNo: string | null; voidJournalNo: string | null;
}
interface Props {
  mode: 'new' | 'view';
  today: string;
  contacts: { id: string; code: string; name: string }[];
  accounts: Account[];
  rows: Row[];
  view?: ReceiptView;
  initial?: { contactId: string | null; billingId: string | null; billingNo: string | null };
  warnings?: string[];
  /** P2A: อัตรา ณ วันรับ (ใบแจ้งหนี้สกุลต่างประเทศ) + สาขา — แสดงเมื่อเปิดโมดูลเท่านั้น · TODO(Wei): ชั่วคราว รอแบบร่าง */
  p2a?: P2A;
}

// ตัวเลือกตามแบบร่าง (ตัวอักษรตามไฟล์)
const RECEIVE: [string, string][] = [['1100100', '1100100 ออมทรัพย์ [ธนาคาร A]'], ['1100200', '1100200 กระแสรายวัน [ธนาคาร B]'], ['1000100', '1000100 เงินสด'], ['1150100', '1150100 เช็ครับรอเรียกเก็บ']];
const FEE_ACC: [string, string][] = [['5401100', '5401100 ค่าธรรมเนียมธนาคาร'], ['4900100', '4900100 กำไร(ขาดทุน)จากส่วนต่าง']];

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const MUTED_NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; color: #525252';
const CUT = 'width: 130px; height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 14px; font-variant-numeric: tabular-nums';

const contactLabel = (c: { code: string; name: string }) => `${c.code} · ${c.name}`;

/** ฐานภาษีถูกหักของยอดค้าง (ไม่รวม VAT) และภาษีถูกหักตามอัตรา */
function whtOf(r: Row, bp: bigint | null): { base: bigint; wht: bigint } {
  const gt = cents(r.grandTotal);
  if (!bp || gt === 0n) return { base: 0n, wht: 0n };
  const base = roundDiv((gt - cents(r.vat)) * cents(r.outstanding), gt);
  return { base, wht: roundDiv(base * bp, 10000n) };
}

export function ReceiptScreen({ mode, today, contacts, accounts, rows: initialRows, view, initial, warnings = [], p2a = P2A_OFF }: Props) {
  const router = useRouter();
  const ro = mode === 'view';
  const d = view?.doc;
  const [contactText, setContactText] = useState(view ? view.contactLabel : (() => { const c = contacts.find((x) => x.id === initial?.contactId); return c ? contactLabel(c) : ''; })());
  const [contactId, setContactId] = useState<string | null>(d?.contact_id ?? initial?.contactId ?? null);
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [account, setAccount] = useState(d?.receive_account ?? '1100100');
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [whtOn, setWhtOn] = useState(ro ? Boolean(d?.wht_cert_no) || cents(d?.wht) > 0n : false);
  const [certNo, setCertNo] = useState(d?.wht_cert_no ?? '');
  const [ratePct, setRatePct] = useState(ro ? rateToPct(d?.wht_rate) : '3');
  const [fee, setFee] = useState(ro ? money(d?.fee ?? '0.00') : '0.00');
  const [feeAccount, setFeeAccount] = useState(d?.fee_account ?? '5401100');
  const vc = view?.cheque;
  const [cheque, setCheque] = useState(vc ? { no: vc.cheque_no, bank: vc.branch ? `${vc.bank} / ${vc.branch}` : vc.bank, date: thaiDate(vc.cheque_date) } : { no: '', bank: '', date: '' });
  const [vatDue, setVatDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const bp = pctToBp(ratePct);
  // ---------- P2A: สกุลเงิน/สาขา ----------
  const [fxRate, setFxRate] = useState(d?.fx_rate ? rateText(d.fx_rate) : '');
  const [fxManual, setFxManual] = useState(false);
  const [fxNote, setFxNote] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  const docCur = ro ? (d?.currency ?? 'THB') : (rows.find((r) => r.checked)?.currency ?? 'THB');
  const foreign = docCur !== 'THB';
  const isoDate = parseThaiDate(date);
  useEffect(() => {
    if (ro || !foreign || fxManual || !isoDate) return;
    const ctl = new AbortController();
    void fetch(`/api/proxy/fx/rates/on?currency=${docCur}&date=${isoDate}`, { signal: ctl.signal }).then(async (r) => {
      const j = (await r.json()) as { rate?: string; error?: string };
      if (r.ok && j.rate) { setFxRate(rateText(j.rate)); setFxNote(`อัตรา ณ ${isoDate} จากทะเบียนอัตรา`); } else { setFxRate(''); setFxNote(j.error ?? 'ยังไม่มีอัตรา ณ วันที่นี้'); }
    }).catch(() => undefined);
    return () => ctl.abort();
  }, [ro, foreign, docCur, isoDate, fxManual]);

  // ---------- โหลดเอกสารค้างของลูกค้า (รับชำระใหม่) ----------
  async function loadOpen(cid: string, preselect: string[] = []) {
    const res = await fetch(`/api/proxy/contacts/${cid}/open-items`);
    const items = (await res.json()) as DocRow[] | { error: string };
    if (!Array.isArray(items)) { setMsg({ kind: 'err', text: items.error }); setRows([]); return; }
    const details = await Promise.all(items.map(async (it) => (await (await fetch(`/api/proxy/documents/${it.id}`)).json()) as DocDetail));
    setRows(items.map((it, i) => {
      const det = details[i]!;
      const out = it.outstanding ?? '0.00';
      return {
        id: it.id, docNo: it.doc_no ?? '', due: it.due_date, outstanding: out, grandTotal: it.grand_total, vat: it.vat, taxMode: it.tax_mode,
        desc: det.lines.find((l) => l.description)?.description ?? null,
        vatDueBefore: fromCents(det.settlementsIn.filter((s) => !s.voided).reduce((s, x) => s + cents(x.vat_due), 0n)),
        checked: preselect.includes(it.id), applied: preselect.includes(it.id) ? money(out) : '', wht: '0.00', whtBase: null, remaining: null,
        ...(det.doc.currency && det.doc.currency !== 'THB' ? { currency: det.doc.currency } : {}),
      };
    }));
  }
  useEffect(() => {
    if (mode === 'new' && initial?.contactId) void loadOpen(initial.contactId, initialRows.filter((r) => r.checked).map((r) => r.id));
  }, []);

  function pickContact(text: string) {
    setContactText(text);
    const c = contacts.find((x) => contactLabel(x) === text);
    if (c && c.id !== contactId) { setContactId(c.id); setRows([]); void loadOpen(c.id); }
  }

  // ภาษีถูกหักต่อใบ (ใหม่: ตามอัตราใน 50 ทวิ · ดู: ตามที่บันทึก)
  const calc = useMemo(() => rows.map((r) => {
    if (ro) return { wht: cents(r.wht), base: cents(r.whtBase), applied: cents(r.applied) };
    if (!r.checked) return { wht: 0n, base: 0n, applied: 0n };
    const w = whtOn ? whtOf(r, bp) : { base: 0n, wht: 0n };
    return { ...w, applied: cents(norm(r.applied)) };
  }), [rows, ro, whtOn, bp]);

  // เปลี่ยนอัตรา/เปิดปิด 50 ทวิ → ตั้งยอดตัดใหม่ = ค้าง − ภาษีถูกหัก
  useEffect(() => {
    if (ro) return;
    setRows((rs) => rs.map((r) => (r.checked ? { ...r, applied: money(fromCents(cents(r.outstanding) - (whtOn ? whtOf(r, bp).wht : 0n))) } : r)));
  }, [whtOn, ratePct]);

  const applied = calc.reduce((s, c) => s + c.applied, 0n);
  const wht = calc.reduce((s, c) => s + c.wht, 0n);
  const whtBase = calc.reduce((s, c) => s + (c.wht > 0n ? c.base : 0n), 0n);
  const feeC = ro ? cents(d?.fee) : cents(norm(fee));
  const cashIn = applied - feeC;
  const totalOutstanding = rows.reduce((s, r) => s + cents(r.outstanding), 0n);

  // ภาษีขายที่ถึงกำหนด (ม.78/1) จาก engine เดียวกับตอนบันทึก — ใช้แสดงตัวอย่างการลงบัญชี
  useEffect(() => {
    if (ro) return;
    const apps = rows.map((r, i) => ({ r, c: calc[i]! })).filter(({ r }) => r.checked);
    if (!apps.length) { setVatDue(null); return; }
    const ctl = new AbortController();
    void fetch('/api/proxy/receipts/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ fee: fromCents(feeC), applications: apps.map(({ r, c }) => ({
        invoiceTotal: r.grandTotal, invoiceVat: r.vat, vatOnPayment: r.taxMode === 'on_payment', settledBefore: fromCents(cents(r.grandTotal) - cents(r.outstanding)),
        vatDueBefore: r.vatDueBefore, applied: fromCents(c.applied), wht: fromCents(c.wht),
      })) }),
    }).then(async (res) => { const t = (await res.json()) as { vatDue?: string }; setVatDue(res.ok ? (t.vatDue ?? null) : null); }).catch(() => undefined);
    return () => ctl.abort();
  }, [calc, feeC]);

  const accName = useMemo(() => new Map(accounts.map((a) => [a.code, a.name])), [accounts]);
  const journal: { dr: boolean; code: string; name: string; amount: string }[] = ro
    ? view!.journal.map((l) => ({ dr: cents(l.debit) > 0n, code: l.account_code, name: l.name, amount: cents(l.debit) > 0n ? l.debit : l.credit }))
    : (() => {
      const v = cents(vatDue);
      const out: { dr: boolean; code: string; amount: bigint }[] = [
        { dr: true, code: account, amount: cashIn }, { dr: true, code: '1160100', amount: wht }, { dr: true, code: feeAccount, amount: feeC },
        { dr: true, code: '2150400', amount: v }, { dr: false, code: '1130100', amount: applied + wht }, { dr: false, code: '2150100', amount: v },
      ];
      return out.filter((l) => l.amount !== 0n).map((l) => ({ dr: l.dr, code: l.code, name: accName.get(l.code) ?? '', amount: fromCents(l.amount) }));
    })();
  const vatShown = ro ? cents(d?.vat) : cents(vatDue);

  function setRow(i: number, patch: Partial<Row>) { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function toggle(i: number, on: boolean) {
    const r = rows[i]!;
    setRow(i, { checked: on, applied: on ? money(fromCents(cents(r.outstanding) - (whtOn ? whtOf(r, bp).wht : 0n))) : '' });
  }

  async function submit() {
    setMsg(null);
    const iso = parseThaiDate(date);
    if (!iso) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    if (!contactId) { setMsg({ kind: 'err', text: 'เลือกลูกค้า' }); return; }
    if (whtOn && !bp) { setMsg({ kind: 'err', text: 'อัตราภาษีถูกหัก ณ ที่จ่ายไม่ถูกต้อง' }); return; }
    const chq = account === '1150100' ? { chequeNo: cheque.no.trim(), bank: cheque.bank.split('/')[0]!.trim(), branch: cheque.bank.split('/').slice(1).join('/').trim() || undefined, chequeDate: parseThaiDate(cheque.date) ?? '' } : null;
    setBusy(true);
    const res = await fetch('/api/proxy/receipts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contactId, date: iso, receiveAccount: account, fee: fromCents(feeC), feeAccount,
        applications: rows.map((r, i) => ({ r, c: calc[i]! })).filter(({ r }) => r.checked).map(({ r, c }) => ({ documentId: r.id, applied: fromCents(c.applied), wht: fromCents(c.wht), ...(c.wht > 0n ? { whtBase: fromCents(c.base) } : {}) })),
        whtCertNo: whtOn ? certNo.trim() || null : null, whtRate: whtOn && bp ? bpToRate(bp) : null, billingId: initial?.billingId ?? null, cheque: chq,
        ...(foreign && fxRate.trim() ? { fxRate: fxRate.replace(/,/gu, '').trim() } : {}), ...(p2a.modules.branches && branch ? { branchCode: branch } : {}),
      }),
    });
    const r = (await res.json()) as { id?: string; docNo?: string; warnings?: string[]; error?: string | string[] };
    setBusy(false);
    if (!res.ok || !r.id) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    const w = r.warnings?.length ? `?w=${encodeURIComponent(JSON.stringify(r.warnings))}` : '';
    router.push(`${href('receipt')}/${r.id}${w}`);
  }

  const posted = ro && d!.status === 'posted';
  const voided = ro && d!.status === 'voided';
  const taxReceipt = vatShown > 0n;
  const title = ro ? (d!.doc_no ?? '') : 'ใหม่';

  return (
    <>
      <TopBar crumb={`การเงิน / รับชำระ / ${title}`} right={
        posted ? <Tag kind="success">{`ลงบัญชีแล้ว ${thaiDate(d!.issue_date).slice(0, 5)} · ${taxReceipt ? 'ออกใบเสร็จ/ใบกำกับแล้ว' : 'ออกใบเสร็จแล้ว'}`}</Tag>
          : voided ? <Tag kind="error">ยกเลิกแล้ว</Tag> : undefined} />
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css(S.h1)}>{ro ? `รับชำระ ${d!.doc_no ?? ''}` : 'รับชำระ'}</h1><span style={css(S.sub)}>ตัดยอดหลายใบในครั้งเดียว · รองรับถูกหัก ณ ที่จ่าย ค่าธรรมเนียม และส่วนต่าง</span></div>
        <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <label style={css(`grid-column: span 2; ${LABEL}`)}>รับจากลูกค้า
            <input readOnly={ro} list={ro ? undefined : 'rv-contacts'} value={contactText} onChange={(e) => pickContact(e.target.value)} style={css(INPUT)} />
            {!ro && <datalist id="rv-contacts">{contacts.map((c) => <option key={c.id} value={contactLabel(c)} />)}</datalist>}
            {(contactId || ro) && <span style={css('font-size: 13px; color: #525252')}>{(view?.billingNo ?? initial?.billingNo) ? `อ้างอิงใบวางบิล ${view?.billingNo ?? initial?.billingNo} · ` : ''}ค้างทั้งหมด {money(fromCents(totalOutstanding))}</span>}
          </label>
          <label style={css(LABEL)}>วันที่รับเงิน<input readOnly={ro} value={date} onChange={(e) => setDate(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(LABEL)}>รับเข้า<select disabled={ro} value={account} onChange={(e) => setAccount(e.target.value)} style={css(`${INPUT}${ro ? '; color: #161616; opacity: 1' : ''}`)}>
            {RECEIVE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {!RECEIVE.some(([v]) => v === account) && <option value={account}>{account}</option>}
          </select></label>
          {((!ro && account === '1150100') || (ro && vc)) && (<>
            <label style={css(LABEL)}>เลขเช็ค<input readOnly={ro} value={cheque.no} onChange={(e) => setCheque({ ...cheque, no: e.target.value })} style={css(INPUT)} /></label>
            <label style={css(`grid-column: span 2; ${LABEL}`)}>ธนาคาร / สาขา<input readOnly={ro} value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>วันที่บนเช็ค<input readOnly={ro} value={cheque.date} placeholder={ro ? undefined : 'วว/ดด/ปปปป'} onChange={(e) => setCheque({ ...cheque, date: e.target.value })} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          </>)}
          {/* TODO(Wei): ช่อง P2A (อัตรา ณ วันรับ · สาขา) ไม่มีใน ScreenReceipt.dc.html — แสดงเมื่อเปิดโมดูล/ใบสกุลต่างประเทศเท่านั้น (ชั่วคราว) */}
          {foreign && <label style={css(P2A_LABEL)}><span>{`อัตรา ณ วันรับ (บาท/1 ${docCur})`}<TempHint /></span>
            <input readOnly={ro} inputMode="decimal" value={fxRate} onChange={(e) => { setFxManual(true); setFxRate(e.target.value); setFxNote(null); }} style={css(`${P2A_INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} />
            {!ro && fxNote && <span style={css('font-size: 12px; color: #525252')}>{fxNote}</span>}</label>}
          {p2a.modules.branches && !ro && <label style={css(P2A_LABEL)}><span>สาขาที่รับ<TempHint /></span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} style={css(P2A_INPUT)}><option value="">ตามใบแจ้งหนี้</option>{p2a.branches.map((b) => <option key={b.code} value={b.code}>{b.code} {b.name}</option>)}</select></label>}
          {ro && d?.branch_code && d.branch_code !== '00000' && <div style={css(P2A_LABEL)}><span>สาขา<TempHint /></span><span style={css('font-size: 15px; color: #161616')}>{d.branch_code}</span></div>}
        </section>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <div style={css('padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; display: flex; justify-content: space-between')}><span>เอกสารค้างชำระ · ระบุยอดที่ตัด</span><span style={css('color: #525252')}>เรียงตามครบกำหนด (เก่าก่อน)</span></div>
          <table style={css('width: 100%; min-width: 820px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css(S.theadRow)}><th style={css('height: 40px; width: 40px; padding: 0 12px')}></th><th style={css(S.th)}>เอกสาร</th><th style={css(S.th)}>ครบกำหนด</th><th style={css(`${S.th}; text-align: right`)}>ค้างชำระ</th><th style={css(`${S.th}; text-align: right`)}>ถูกหัก ณ ที่จ่าย</th><th style={css(`${S.th}; text-align: right`)}>ตัดยอดครั้งนี้</th><th style={css(`${S.th}; text-align: right`)}>คงเหลือ</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const c = calc[i]!;
                const rem = ro ? (r.remaining ?? '') : fromCents(cents(r.outstanding) - c.applied - c.wht);
                return (
                  <tr key={r.id} style={css(`border-top: 1px solid #e0e0e0${r.checked ? '; background: #e0e0e0' : ''}`)}>
                    <td style={css('height: 40px; padding: 0 12px')}><input type="checkbox" checked={r.checked} aria-readonly={ro || undefined} onChange={(e) => { if (!ro) toggle(i, e.target.checked); }} style={css('width: 16px; height: 16px; margin: 0')} aria-label="เลือก" /></td>
                    <td style={css(TD)}><a href={`${href('invoice')}/${r.id}`} style={css('text-decoration: none; font-weight: 500')}>{r.docNo}</a>{r.currency && <span style={css('font-size: 12px; color: #525252')}> {r.currency}</span>}{r.checked && c.wht > 0n && <> <span style={css('color: #525252')}>{r.desc ? `${r.desc} · ` : ''}ฐาน {money(fromCents(c.base))} + VAT {money(r.vat)}</span></>}</td>
                    <td style={css(TD)}>{r.due ? thaiDate(r.due) : '—'}</td>
                    <td style={css(NUM)}>{money(r.outstanding)}</td>
                    {r.checked ? <td style={css(NUM)}>{money(fromCents(c.wht))}</td> : <td style={css(MUTED_NUM)}>—</td>}
                    {r.checked
                      ? <td style={css('padding: 0 12px; text-align: right')}><input aria-label={`ตัดยอดครั้งนี้ ${r.docNo}`} readOnly={ro} value={ro ? money(r.applied) : r.applied} onChange={(e) => setRow(i, { applied: e.target.value })} onBlur={(e) => setRow(i, { applied: norm(e.target.value) ? money(norm(e.target.value)) : '' })} style={css(CUT)} /></td>
                      : <td style={css(MUTED_NUM)}>—</td>}
                    <td style={css(cents(rem) === 0n && r.checked ? MUTED_NUM : NUM)}>{rem === '' ? '—' : money(rem)}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr style={css(S.tr)}><td colSpan={7} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; justify-content: space-between')}>
          <section style={css('flex: 1 1 420px; display: flex; flex-direction: column; gap: 16px')}>
            <div style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>หนังสือรับรองหัก ณ ที่จ่ายที่ได้รับ</strong>
              {ro
                ? <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={whtOn} aria-readonly onChange={() => undefined} /> ได้รับ 50 ทวิ จากลูกค้าแล้ว{whtOn ? ` เลขที่ ${d!.wht_cert_no ?? '—'} · ${ratePct}% ของฐาน ${money(fromCents(whtBase))} = ${money(fromCents(wht))}` : ''}</label>
                : <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
                  <input id="rv-wht" type="checkbox" checked={whtOn} onChange={(e) => setWhtOn(e.target.checked)} /><label htmlFor="rv-wht">ได้รับ 50 ทวิ จากลูกค้าแล้ว</label>
                  {whtOn && <>เลขที่ <input aria-label="เลขที่ 50 ทวิ" value={certNo} onChange={(e) => setCertNo(e.target.value)} style={css('width: 110px; height: 28px; padding: 0 8px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')} /> · <input aria-label="อัตรา %" value={ratePct} onChange={(e) => setRatePct(e.target.value)} style={css('width: 48px; height: 28px; padding: 0 8px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')} />% ของฐาน {money(fromCents(whtBase))} = {money(fromCents(wht))}</>}
                </div>}
              <span style={css('color: #525252')}>บันทึกเป็นภาษีถูกหัก ณ ที่จ่าย (สินทรัพย์) ใช้เครดิตใน ภ.ง.ด.50 ปลายปี</span></div>
            <div style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>ส่วนต่าง / ค่าธรรมเนียม</strong><div style={css('display: flex; gap: 16px')}>
              <label style={css('flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>ค่าธรรมเนียมธนาคาร<input readOnly={ro} value={fee} onChange={(e) => setFee(e.target.value)} onBlur={(e) => setFee(norm(e.target.value) ? money(norm(e.target.value)) : '0.00')} style={css('height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; font-variant-numeric: tabular-nums')} /></label>
              <label style={css('flex: 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>ลงบัญชี<select disabled={ro} value={feeAccount} onChange={(e) => setFeeAccount(e.target.value)} style={css(`height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px${ro ? '; color: #161616; opacity: 1' : ''}`)}>{FEE_ACC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            </div></div>
          </section>
          <table style={css('flex: 0 1 340px; border-collapse: collapse; font-size: 15px')}><tbody>
            <tr><td style={css('height: 32px')}>ตัดยอดรวม</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(fromCents(applied))}</td></tr>
            <tr><td style={css('height: 32px')}>ถูกหัก ณ ที่จ่าย</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(fromCents(wht))}</td></tr>
            <tr><td style={css('height: 32px')}>ค่าธรรมเนียม</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(fromCents(-feeC), { paren: true })}</td></tr>
            <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css('height: 40px; font-weight: 600; font-size: 16px')}>เงินเข้าบัญชีจริง</td><td style={css('text-align: right; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums')}>{money(ro ? d!.grand_total : fromCents(cashIn))}</td></tr>
            {foreign && <tr><td style={css('height: 28px; font-size: 13px; color: #525252')}>{`สกุล ${docCur} · เงินเข้าเป็นบาท${ro && d?.grand_total_thb ? '' : ' (ประมาณ)'}`}<TempHint /></td>
              <td style={css('text-align: right; font-size: 13px; color: #525252; font-variant-numeric: tabular-nums')}>{money((ro ? d?.grand_total_thb : null) ?? toThb(ro ? d!.grand_total : fromCents(cashIn), fxRate) ?? '')}</td></tr>}
          </tbody></table>
        </div>
        <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; max-width: 560px')}>
          <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่างการลงบัญชี</strong><span style={css('font-size: 13px; color: #525252')}>สูตร {d?.rule_code ?? 'Receive[RV]'}{view?.journal[0] ? ` · ${view.journal[0].journal_no}` : ''}</span></div>
          <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}><tbody>
            {journal.map((l, i) => (
              <tr key={`${l.code}-${i}`} style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
                <td style={css(l.dr ? 'height: 32px; padding: 0 16px' : 'height: 32px; padding: 0 16px 0 32px')}>{l.dr ? 'Dr' : 'Cr'} {l.code} {l.name}</td>
                <td style={css(i ? 'text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums' : 'width: 120px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{l.dr ? money(l.amount) : ''}</td>
                <td style={css(l.dr ? (i ? '' : 'width: 120px') : 'text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{l.dr ? '' : money(l.amount)}</td>
              </tr>
            ))}
          </tbody></table>
          {foreign && !ro && <p style={css('margin: 0; padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #684e00')}>{`ตัวอย่างเป็นยอดสกุล ${docCur} — ระบบลงบัญชีเป็นบาท ล้างลูกหนี้ตามอัตราเดิมของใบแจ้งหนี้ ผลต่างลงกำไร/ขาดทุนจากอัตราแลกเปลี่ยน (4910100/5920100)`} (ชั่วคราว)</p>}
          {vatShown > 0n && <p style={css('margin: 0; padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>ใบที่ตัดรอบนี้เป็นค่าบริการที่มี VAT ระบบจึงออก “ใบเสร็จรับเงิน/ใบกำกับภาษี” และโอน Dr 2150400 ภาษีขายยังไม่ถึงกำหนด → Cr 2150100 ภาษีขาย ในรายการเดียวกัน (จุดภาษีเกิดเมื่อรับชำระ ม.78/1)</p>}
        </section>
        {warnings.map((w) => <div key={w} role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #f1c21b; font-size: 14px')}>{w}</div>)}
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px')}>
        {/* TODO(M7/M6): แบบร่างต่อท้ายว่า "· แจ้ง TMS (payment.received) สำเร็จ · จับคู่ statement แล้ว" — แสดงเมื่อมี webhook (M7) และกระทบยอดธนาคาร (M6) จริง */}
        <span style={css('color: #525252')}>{posted ? `ลงบัญชี ${thaiDate(d!.issue_date).slice(0, 5)} · ${taxReceipt ? 'ออกใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ออกใบเสร็จรับเงิน'} ${d!.doc_no ?? ''} แล้ว`
          : voided ? `ยกเลิกแล้ว${view?.voidJournalNo ? ` · กลับรายการ ${view.voidJournalNo}` : ''}${d!.void_reason ? ` · ${d!.void_reason}` : ''}` : ''}</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {ro ? (<>
            <a href={taxReceipt ? PRINT.receiptTax(d!.id) : PRINT.receiptNoVat(d!.id)} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>ดูตัวอย่างพิมพ์</a>
            <a href={PRINT.receiptNoVat(d!.id)} style={css('text-decoration: none')}>ตัวอย่างใบเสร็จไม่มี VAT</a>
            <ButtonLink href={PRINT.receiptVoucher(d!.id)}>ใบสำคัญรับ</ButtonLink>
            {posted && <ButtonLink href={docVoidHref(d!.id)} kind="danger">ยกเลิก / กลับรายการ</ButtonLink>}
            <ButtonLink href={`${href('receipt')}/new`} kind="primary">รับชำระใหม่</ButtonLink>
          </>) : (
            <Button kind="primary" disabled={busy || !rows.some((r) => r.checked)} onClick={() => void submit()}>ลงบัญชี</Button>
          )}
        </div>
      </div>
    </>
  );
}
