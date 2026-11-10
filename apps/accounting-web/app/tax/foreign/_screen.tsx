'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// /tax/foreign — แท็บ ภ.พ.36 · ภ.ง.ด.54 · ประเทศผู้ติดต่อต่างประเทศ
// API: POST /v1/tax/pp36/:month/filed {filedAt, payFrom, referenceNo} (JV ชำระ + โอน 1170200 → 1170100) · POST /v1/tax/pnd54/:month/filed {filedAt, referenceNo, additional} (ไม่มี JV)
//      PUT /v1/contacts/:id/country {country} · 422 ภาษาไทยแสดงในกล่องข้อความ
import { Button, css, money, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '../../sales/_lib/client';
import { Msg } from '../../sales/_lib/ui';
import { pct, ST, thaiYm } from '../../contracts/_lib';

type M = { kind: 'ok' | 'err'; text: string } | null;
interface Filing { id: string; seq: number; filed_at: string; reference_no: string | null; amount: string; journal_no: string | null }
export interface Pp36Report {
  month: string; base: string; vat: string; unfiled: string; dueDate: string; pendingAuditor: boolean; status: 'filed' | 'draft'; filings: Filing[];
  rows: { id: string; pay_date: string; base: string; rate: string; vat: string; filing_id: string | null; payment_no: string | null; bill_no: string | null; vendor_ref: string | null; name: string; country: string | null; tax_id: string | null }[];
}
export interface Pnd54Report {
  month: string; base: string; tax: string; certs: number; pendingAuditor: boolean; status: 'filed' | 'draft'; filings: Filing[];
  rows: { cert_no: string; pay_date: string; income_type: string; income_section: string | null; base: string; rate: string; amount: string; pending_auditor: boolean; name: string; tax_id: string | null; doc_no: string | null; country: string | null; treaty: boolean; gross_up: boolean }[];
}
export interface Pnd54Type { key: string; section: string; rate: string; label: string }
export interface ForeignContact { id: string; code: string; name: string; kind: string; tax_id: string | null; country: string | null }
type Tab = 'pp36' | 'pnd54' | 'contacts';
interface Props { month: string; months: string[]; tab: Tab; today: string; pp36: Pp36Report; pnd54: Pnd54Report; types: Pnd54Type[]; contacts: ForeignContact[]; payAccounts: { code: string; name: string }[] }

const TAB_ON = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer';
const TAB_OFF = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #525252; font-family: inherit; font-size: 14px; cursor: pointer';
const nextMonthFirst = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };

export function ForeignTaxScreen(p: Props) {
  const router = useRouter();
  const go = (q: { month?: string; tab?: Tab }) => router.push(`/tax/foreign?month=${q.month ?? p.month}&tab=${q.tab ?? p.tab}`);
  return (
    <>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid #e0e0e0')}>
        <div role="tablist" aria-label="แบบภาษี" style={css('display: flex')}>
          {([['pp36', 'ภ.พ.36'], ['pnd54', 'ภ.ง.ด.54'], ['contacts', 'ผู้ขายต่างประเทศ / ประเทศ']] as [Tab, string][]).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={p.tab === t} onClick={() => go({ tab: t })} style={css(p.tab === t ? TAB_ON : TAB_OFF)}>{label}</button>
          ))}
        </div>
        {p.tab !== 'contacts' && (
          <label style={css(`${ST.label}; flex-direction: row; align-items: center; gap: 8px; padding-bottom: 6px`)}>เดือนที่จ่าย
            <select value={p.month} onChange={(e) => go({ month: e.target.value })} style={css(`${ST.input}; height: 36px`)}>
              {p.months.map((m) => <option key={m} value={m}>{thaiYm(m)}</option>)}
            </select>
            <input type="month" aria-label="เลือกเดือนอื่น" value={p.month} onChange={(e) => { if (e.target.value) go({ month: e.target.value }); }} style={css(`${ST.input}; height: 36px`)} />
          </label>
        )}
      </div>
      {p.tab === 'pp36' && <Pp36Tab {...p} />}
      {p.tab === 'pnd54' && <Pnd54Tab {...p} />}
      {p.tab === 'contacts' && <ContactsTab contacts={p.contacts} />}
    </>
  );
}

function Summary({ items }: { items: [string, string, string?][] }) {
  return (
    <div style={css('display: flex; gap: 12px; flex-wrap: wrap')}>
      {items.map(([label, value, note]) => (
        <div key={label} style={css(ST.card)}><span style={css(ST.cardLabel)}>{label}</span><span style={css(ST.cardNum)}>{value}</span>{note && <span style={css('font-size: 13px; color: #525252')}>{note}</span>}</div>
      ))}
    </div>
  );
}

function Filings({ rows }: { rows: Filing[] }) {
  if (!rows.length) return null;
  return (
    <div style={css(S.tableBox)}>
      <table style={css(S.table)}>
        <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>การยื่น</th><th style={css(S.th)}>วันที่ยื่น</th><th style={css(S.th)}>เลขอ้างอิง</th><th style={css(`${S.th}; text-align: right`)}>ยอดภาษี</th><th style={css(S.th)}>JV</th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id} style={css(S.tr)}>
            <td style={css('height: 36px; padding: 0 12px')}>{f.seq === 0 ? 'ยื่นปกติ' : `ยื่นเพิ่มเติม ครั้งที่ ${f.seq}`}</td>
            <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(f.filed_at)}</td>
            <td style={css(S.td)}>{f.reference_no ?? '—'}</td>
            <td style={css(S.num)}>{money(f.amount)}</td>
            <td style={css(S.td)}>{f.journal_no ?? '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Pp36Tab({ month, today, pp36, payAccounts }: Props) {
  const router = useRouter();
  const min = nextMonthFirst(month);
  const [f, setF] = useState({ filedAt: today < min ? min : today, payFrom: payAccounts.find((a) => a.code.startsWith('11'))?.code ?? payAccounts[0]?.code ?? '', referenceNo: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const unfiled = pp36.unfiled !== '0.00';
  async function file() {
    setBusy(true); setMsg(null);
    const r = await call<{ seq: number; amount: string; journalNo: string; claimMonth: string }>(`tax/pp36/${month}/filed`, 'POST', { filedAt: f.filedAt, payFrom: f.payFrom, referenceNo: f.referenceNo.trim() || null });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `บันทึกยื่น ภ.พ.36 ${thaiYm(month)}${r.data.seq ? ` (ยื่นเพิ่มเติม ครั้งที่ ${r.data.seq})` : ''} แล้ว ยอด ${money(r.data.amount)} · ${r.data.journalNo} · ใช้เป็นภาษีซื้อเดือน ${thaiYm(r.data.claimMonth)}` });
    router.refresh();
  }
  return (
    <>
      <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
        <strong style={css('font-size: 16px')}>ภ.พ.36 เดือน {thaiYm(month)}</strong>
        {pp36.status === 'filed' ? <Tag kind="success">{unfiled ? 'ยื่นแล้วบางส่วน' : 'ยื่นแล้ว'}</Tag> : pp36.rows.length ? <Tag kind="warning">{`ยังไม่ยื่น · กำหนด ${thaiDate(pp36.dueDate)}`}</Tag> : <Tag kind="neutral">ไม่มีรายการ</Tag>}
        {pp36.pendingAuditor && <Tag kind="warning">รอยืนยัน (ผู้สอบบัญชี)</Tag>}
      </div>
      <Summary items={[['ฐานภาษี (ค่าบริการ)', money(pp36.base)], ['ภาษี ภ.พ.36 (7%)', money(pp36.vat), `${pp36.rows.length} รายการ`], ['ยังไม่ยื่น', money(pp36.unfiled)], ['กำหนดยื่น', thaiDate(pp36.dueDate), 'ยื่นออนไลน์อาจขยายเวลา (รอยืนยัน)']]} />
      <div style={css(S.tableBox)}>
        <table style={css(`${S.table}; min-width: 1000px`)}>
          <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>วันที่จ่าย</th><th style={css(S.th)}>เอกสารจ่าย</th><th style={css(S.th)}>บิลผู้ขาย</th><th style={css(S.th)}>ผู้ขาย</th><th style={css(S.th)}>ประเทศ</th>
            <th style={css(`${S.th}; text-align: right`)}>ฐานภาษี</th><th style={css(`${S.th}; text-align: right`)}>อัตรา</th><th style={css(`${S.th}; text-align: right`)}>ภาษี</th><th style={css(S.th)}>สถานะ</th></tr></thead>
          <tbody>
            {pp36.rows.length === 0 && <tr style={css(S.tr)}><td colSpan={9} style={css('height: 40px; padding: 0 12px; color: #525252')}>ไม่มีการจ่ายค่าบริการให้ผู้ขายต่างประเทศในเดือนนี้</td></tr>}
            {pp36.rows.map((r) => (
              <tr key={r.id} style={css(S.tr)}>
                <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{thaiDate(r.pay_date)}</td>
                <td style={css(S.td)}>{r.payment_no ?? '—'}</td>
                <td style={css(S.td)}>{r.bill_no ?? '—'}{r.vendor_ref ? <span style={css('font-size: 13px; color: #525252')}> · {r.vendor_ref}</span> : null}</td>
                <td style={css(S.td)}>{r.name}</td>
                <td style={css(S.td)}>{r.country ?? '—'}</td>
                <td style={css(S.num)}>{money(r.base)}</td><td style={css(S.num)}>{pct(r.rate)}</td><td style={css(S.num)}>{money(r.vat)}</td>
                <td style={css(S.td)}>{r.filing_id ? <Tag kind="success">ยื่นแล้ว</Tag> : <Tag kind="warning">ยังไม่ยื่น</Tag>}</td>
              </tr>
            ))}
          </tbody>
          {pp36.rows.length > 0 && <tfoot><tr style={css(S.tfoot)}><td colSpan={5} style={css('height: 40px; padding: 0 12px')}>รวม {pp36.rows.length} รายการ</td><td style={css(S.num)}>{money(pp36.base)}</td><td></td><td style={css(S.num)}>{money(pp36.vat)}</td><td></td></tr></tfoot>}
        </table>
      </div>
      <Filings rows={pp36.filings} />
      <section aria-labelledby="h-pp36-file" style={css(ST.box)}>
        <h2 id="h-pp36-file" style={css(ST.h2)}>บันทึกยื่นแล้ว + ชำระ ภ.พ.36</h2>
        <span style={css('font-size: 13px; color: #525252')}>JV: Dr 2150500 ภาษี ภ.พ.36 ค้างนำส่ง / Cr บัญชีที่จ่าย · Dr 1170100 ภาษีซื้อ / Cr 1170200 ภาษีซื้อรอใช้สิทธิ (ใช้เป็นภาษีซื้อเดือนที่ยื่น) · ยื่นซ้ำ = ยื่นเพิ่มเติมเฉพาะรายการที่ยังไม่ยื่น</span>
        <Msg msg={msg} />
        <div style={css('display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap')}>
          <label style={css(ST.label)}>วันที่ยื่น/ชำระ<input type="date" min={min} value={f.filedAt} onChange={(e) => setF({ ...f, filedAt: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
          <label style={css(ST.label)}>จ่ายจากบัญชี<select value={f.payFrom} onChange={(e) => setF({ ...f, payFrom: e.target.value })} style={css(`${ST.input}; height: 36px`)}>
            {payAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></label>
          <label style={css(ST.label)}>เลขอ้างอิงการยื่น<input value={f.referenceNo} onChange={(e) => setF({ ...f, referenceNo: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
          <Button kind="primary" size={36} disabled={busy || !unfiled || !f.payFrom} onClick={() => void file()}>{pp36.status === 'filed' ? 'บันทึกยื่นเพิ่มเติม' : 'บันทึกยื่นแล้ว'}</Button>
        </div>
      </section>
    </>
  );
}

function Pnd54Tab({ month, today, pnd54, types }: Props) {
  const router = useRouter();
  const min = nextMonthFirst(month);
  const [f, setF] = useState({ filedAt: today < min ? min : today, referenceNo: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const filed = pnd54.status === 'filed';
  const label = (k: string) => types.find((t) => t.key === k)?.label ?? k;
  async function file() {
    setBusy(true); setMsg(null);
    const r = await call<{ seq?: number }>(`tax/pnd54/${month}/filed`, 'POST', { filedAt: f.filedAt, referenceNo: f.referenceNo.trim() || null, additional: filed });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `บันทึกยื่น ภ.ง.ด.54 ${thaiYm(month)}${filed ? ' (ยื่นเพิ่มเติม)' : ''} แล้ว — 2150600 ล้างตอนจ่ายนำส่ง` });
    router.refresh();
  }
  return (
    <>
      <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
        <strong style={css('font-size: 16px')}>ภ.ง.ด.54 เดือน {thaiYm(month)}</strong>
        {filed ? <Tag kind="success">ยื่นแล้ว</Tag> : pnd54.rows.length ? <Tag kind="warning">ยังไม่ยื่น</Tag> : <Tag kind="neutral">ไม่มีรายการ</Tag>}
        {pnd54.pendingAuditor && <Tag kind="warning">อัตรารอยืนยัน (ผู้สอบบัญชี)</Tag>}
      </div>
      <Summary items={[['เงินได้ที่จ่าย', money(pnd54.base)], ['ภาษีหัก ณ ที่จ่าย', money(pnd54.tax), `${pnd54.certs} ใบ (50 ทวิ)`]]} />
      <div style={css(S.tableBox)}>
        <table style={css(`${S.table}; min-width: 1100px`)}>
          <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>เลขที่ 50 ทวิ</th><th style={css(S.th)}>วันที่จ่าย</th><th style={css(S.th)}>ผู้รับเงิน</th><th style={css(S.th)}>ประเทศ</th><th style={css(S.th)}>ประเภทเงินได้</th>
            <th style={css(`${S.th}; text-align: right`)}>เงินได้</th><th style={css(`${S.th}; text-align: right`)}>อัตรา</th><th style={css(`${S.th}; text-align: right`)}>ภาษี</th><th style={css(S.th)}>เงื่อนไข</th><th style={css(S.th)}>เอกสารจ่าย</th></tr></thead>
          <tbody>
            {pnd54.rows.length === 0 && <tr style={css(S.tr)}><td colSpan={10} style={css('height: 40px; padding: 0 12px; color: #525252')}>ไม่มีการหักภาษี ภ.ง.ด.54 ในเดือนนี้</td></tr>}
            {pnd54.rows.map((r) => (
              <tr key={r.cert_no} style={css(S.tr)}>
                <td style={css('height: 40px; padding: 0 12px')}>{r.cert_no}</td>
                <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.pay_date)}</td>
                <td style={css(S.td)}>{r.name}</td>
                <td style={css(S.td)}>{r.country ?? '—'}</td>
                <td style={css(S.td)}>{label(r.income_type)}{r.income_section ? ` ม.${r.income_section}` : ''}</td>
                <td style={css(S.num)}>{money(r.base)}</td><td style={css(S.num)}>{pct(r.rate)}</td><td style={css(S.num)}>{money(r.amount)}</td>
                <td style={css(S.td)}>{[r.treaty ? 'อนุสัญญา' : 'อัตราตามประมวล', r.gross_up ? 'ผู้จ่ายออกแทน' : null, r.pending_auditor ? 'รอยืนยัน' : null].filter(Boolean).join(' · ')}</td>
                <td style={css(S.td)}>{r.doc_no ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          {pnd54.rows.length > 0 && <tfoot><tr style={css(S.tfoot)}><td colSpan={5} style={css('height: 40px; padding: 0 12px')}>รวม {pnd54.rows.length} รายการ</td><td style={css(S.num)}>{money(pnd54.base)}</td><td></td><td style={css(S.num)}>{money(pnd54.tax)}</td><td colSpan={2}></td></tr></tfoot>}
        </table>
      </div>
      <Filings rows={pnd54.filings} />
      <section aria-labelledby="h-pnd54-file" style={css(ST.box)}>
        <h2 id="h-pnd54-file" style={css(ST.h2)}>บันทึกยื่น ภ.ง.ด.54 แล้ว</h2>
        <span style={css('font-size: 13px; color: #525252')}>บันทึกการยื่นอย่างเดียว ไม่มี JV — 2150600 ภาษีหัก ณ ที่จ่าย ภ.ง.ด.54 ค้างนำส่ง ล้างตอนจ่ายนำส่ง (เหมือน ภ.ง.ด.3/53)</span>
        <Msg msg={msg} />
        <div style={css('display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap')}>
          <label style={css(ST.label)}>วันที่ยื่น<input type="date" min={min} value={f.filedAt} onChange={(e) => setF({ ...f, filedAt: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
          <label style={css(ST.label)}>เลขอ้างอิงการยื่น<input value={f.referenceNo} onChange={(e) => setF({ ...f, referenceNo: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
          <Button kind="primary" size={36} disabled={busy || pnd54.rows.length === 0} onClick={() => void file()}>{filed ? 'บันทึกยื่นเพิ่มเติม' : 'บันทึกยื่นแล้ว'}</Button>
        </div>
      </section>
      <section aria-labelledby="h-types" style={css('display: flex; flex-direction: column; gap: 12px')}>
        <h2 id="h-types" style={css(ST.h2)}>ประเภทเงินได้ ภ.ง.ด.54 (อัตราตามประมวล · รอยืนยัน)</h2>
        <div style={css(S.tableBox)}>
          <table style={css(S.table)}>
            <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>รหัส</th><th style={css(S.th)}>ประเภทเงินได้</th><th style={css(S.th)}>มาตรา</th><th style={css(`${S.th}; text-align: right`)}>อัตรา</th></tr></thead>
            <tbody>{types.map((t) => (
              <tr key={t.key} style={css(S.tr)}><td style={css('height: 36px; padding: 0 12px; font-size: 13px; color: #525252')}>{t.key}</td><td style={css(S.td)}>{t.label}</td><td style={css(S.td)}>{t.section}</td><td style={css(S.num)}>{pct(t.rate)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <span style={css('font-size: 13px; color: #525252')}>อัตราตามอนุสัญญาภาษีซ้อนต่อประเทศตั้งที่ค่าตั้ง tax.pnd54.treaty_rates (ว่าง = อัตราตามประมวล) · ผู้จ่ายออกภาษีแทน = tax.pnd54.gross_up — ทั้งหมดรอผู้สอบบัญชียืนยัน</span>
      </section>
    </>
  );
}

function ContactsTab({ contacts }: { contacts: ForeignContact[] }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(contacts.map((c) => [c.id, c.country ?? ''])));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<M>(null);
  async function save(c: ForeignContact) {
    setBusy(c.id); setMsg(null);
    const v = (vals[c.id] ?? '').trim().toUpperCase();
    const r = await call<{ ok: true }>(`contacts/${c.id}/country`, 'PUT', { country: v || null });
    setBusy(null);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `บันทึกประเทศของ ${c.code} ${c.name} = ${v || '(ไม่ระบุ)'} แล้ว` });
    router.refresh();
  }
  return (
    <>
      <span style={css('font-size: 13px; color: #525252')}>ผู้ติดต่อประเภท “ต่างประเทศ” (ตั้งที่ ข้อมูลหลัก → ผู้ติดต่อ) · ประเทศเป็นรหัส ISO 3166-1 สองตัวอักษร (เช่น SG, US, JP) ใช้เลือกอัตราตามอนุสัญญาภาษีซ้อน</span>
      <Msg msg={msg} />
      <div style={css(S.tableBox)}>
        <table style={css(S.table)}>
          <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>รหัส</th><th style={css(S.th)}>ชื่อ</th><th style={css(S.th)}>เลขผู้เสียภาษี</th><th style={css(S.th)}>ประเทศ (ISO)</th><th style={css(S.th)}></th></tr></thead>
          <tbody>
            {contacts.length === 0 && <tr style={css(S.tr)}><td colSpan={5} style={css('height: 40px; padding: 0 12px; color: #525252')}>ยังไม่มีผู้ติดต่อประเภทต่างประเทศ — เพิ่มที่ <a href="/master/contacts" style={css('text-decoration: none')}>ข้อมูลหลัก → ผู้ติดต่อ</a></td></tr>}
            {contacts.map((c) => (
              <tr key={c.id} style={css(S.tr)}>
                <td style={css('height: 44px; padding: 0 12px')}>{c.code}</td>
                <td style={css(S.td)}>{c.name}</td>
                <td style={css(S.td)}>{c.tax_id ?? '—'}</td>
                <td style={css('padding: 0 12px; width: 120px')}><input aria-label={`ประเทศของ ${c.code}`} maxLength={2} value={vals[c.id] ?? ''} onChange={(e) => setVals({ ...vals, [c.id]: e.target.value.toUpperCase() })} style={css(`${ST.cell}; width: 80px; text-transform: uppercase`)} /></td>
                <td style={css(S.td)}><Button kind="secondary" size={32} disabled={busy === c.id || (vals[c.id] ?? '') === (c.country ?? '')} onClick={() => void save(c)}>บันทึกประเทศ</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
