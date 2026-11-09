'use client';
// F5 เงินสดย่อย (imprest) — design/project/ScreenPettyCash.dc.html
// รายการย่อย (PC) ไม่ลง GL จนเบิกชดเชย → 1 journal (Dr ค่าใช้จ่าย · Dr ภาษีซื้อเฉพาะใบกำกับเต็มรูป · Cr ธนาคาร · Cr 2150300 ถ้ามีหัก ณ ที่จ่าย) + 50 ทวิ ของรายการที่หัก
// TODO(backend): หลายกองเงินสดย่อย (ตัวเลือก "กองคลังสินค้า · วงเงิน 10,000" / "+ ตั้งกองใหม่") · ชื่อกอง/ผู้ถือกอง · การตรวจนับ ("นับเงิน / ตรวจกอง", "ตรวจนับล่าสุด")
//   · แนบรูปบิล ("ถ่ายบิลเพิ่ม") ยังไม่มีใน API — ชื่อกอง/ผู้ถือแสดงตามข้อความแบบร่าง · ปุ่มที่ยังไม่มี API เป็นสถานะ "ใช้ไม่ได้"
// TODO(Wei) ScreenPettyCash.dc.html: แบบฟอร์ม "+ บันทึกจ่าย" ไม่มีในไฟล์ — ใช้ชื่อช่องตามหัวตาราง (วันที่ · รายการ · บัญชีค่าใช้จ่าย · ผู้เบิก · ภาษีซื้อ · จำนวนเงิน · หลักฐาน) + หัก ณ ที่จ่าย/ผู้รับเงิน
// TODO(Wei) ScreenPettyCash.dc.html: "เบิกชดเชย … → สร้าง PV" — API ลง journal 1 ใบ (สมุด PV) ไม่ได้สร้างเอกสารใบสำคัญจ่าย · จ่ายจาก 1100100 ตามตัวอย่างการลงบัญชีในแบบร่าง (ยังไม่มีช่องเลือกบัญชี)
import { Button, css, money, parseThaiDate, S, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cents, fromCents, norm, roundDiv } from '../_shared/num';

export interface PettyItem {
  id: string; doc_no: string; issue_date: string; grand_total: string; vat: string; evidence: string | null; paid_by: string | null; vat_mode: string | null;
  batch_ref: string | null; description: string; account_code: string | null; wht_type: string | null; payee: string | null; individual: boolean | null;
}
export interface PettySummary { account: string; imprest: string; spentPending: string; onHand: string; inputVatPending: string; items: PettyItem[] }
interface Props {
  today: string; summary: PettySummary; lastReimbursed: string | null;
  accounts: { code: string; name: string }[]; accountNames: Record<string, string>;
  contacts: { id: string; code: string; name: string }[]; whtTypes: { key: string; label: string; rate: string }[];
}

const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const SHOWN = 5; // แบบร่างแสดง 5 รายการ + แถว "… อีก N รายการ"
const VAT_MODE: [string, string][] = [['none', 'ไม่มี'], ['abbreviated_no_claim', 'ใบกำกับอย่างย่อ · ไม่ขอคืน'], ['full_invoice', 'ใบกำกับเต็มรูป']];
const EVIDENCE = ['ใบเสร็จ', 'ใบกำกับ', 'ใบรับรองแทนใบเสร็จ'];

/** '0.03' → 300 (ร้อยละ × 100) */
const rateBp = (r: string): bigint => { const [i = '0', f = ''] = r.split('.'); return BigInt(i || '0') * 10000n + BigInt((f + '0000').slice(0, 4)); };
const pctText = (bp: bigint): string => { const frac = (bp % 100n).toString().padStart(2, '0').replace(/0+$/u, ''); return `${bp / 100n}${frac ? `.${frac}` : ''}`; };
const imprestShort = (v: string) => money(v).replace(/\.00$/u, '');

export function PettyCashScreen({ today, summary, lastReimbursed, accounts, accountNames, contacts, whtTypes }: Props) {
  const router = useRouter();
  const pending = summary.items.filter((i) => !i.batch_ref);
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [f, setF] = useState({ date: thaiDate(today), description: '', accountCode: accounts[0]?.code ?? '', amount: '', vatMode: 'none', inputVat: '', whtType: '', contact: '', evidence: EVIDENCE[0]!, paidBy: '' });

  const typeOf = (k: string | null) => whtTypes.find((t) => t.key === k);
  const whtOf = (i: PettyItem): bigint => { const t = typeOf(i.wht_type); return t ? roundDiv((cents(i.grand_total) - cents(i.vat)) * rateBp(t.rate), 10000n) : 0n; };
  const spent = cents(summary.spentPending);
  const vat = cents(summary.inputVatPending);
  const wht = pending.reduce((s, i) => s + whtOf(i), 0n);
  const imprest = cents(summary.imprest);
  const low = imprest > 0n && cents(summary.onHand) * 4n < imprest;
  const shown = all ? pending : pending.slice(0, SHOWN);
  const rest = pending.slice(shown.length);

  async function reimburse() {
    if (!pending.length) return;
    if (!window.confirm(`เบิกชดเชย ${money(summary.spentPending)} · ${pending.length} รายการ`)) return;
    setBusy(true); setMsg(null);
    const res = await fetch('/api/proxy/petty-cash/reimburse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: today, payFrom: '1100100' }) });
    const r = (await res.json()) as { journalNo?: string; paid?: string; certificates?: { certNo: string }[]; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'เบิกชดเชยไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: `${r.journalNo ?? ''} · ${money(r.paid)}${r.certificates?.length ? ` · 50 ทวิ ${r.certificates.map((c) => c.certNo).join(', ')}` : ''}` });
    router.refresh();
  }

  async function save() {
    setMsg(null);
    const date = parseThaiDate(f.date);
    if (!date) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    const amount = norm(f.amount);
    if (!amount || cents(amount) <= 0n) { setMsg({ kind: 'err', text: 'จำนวนเงินไม่ถูกต้อง' }); return; }
    const c = contacts.find((x) => `${x.code} · ${x.name}` === f.contact);
    setBusy(true);
    const res = await fetch('/api/proxy/petty-cash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      date, description: f.description.trim(), accountCode: f.accountCode, amount, vatMode: f.vatMode, inputVat: f.vatMode === 'full_invoice' ? (norm(f.inputVat) || '0.00') : null,
      whtType: f.whtType || null, contactId: c?.id ?? null, evidence: f.evidence, paidBy: f.paidBy.trim(),
    }) });
    const r = (await res.json()) as { id?: string; docNo?: string; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: `บันทึก ${r.docNo ?? ''} แล้ว` });
    setAdding(false);
    setF({ ...f, description: '', amount: '', inputVat: '', whtType: '', contact: '' });
    router.refresh();
  }

  function exportCsv() {
    const q = (v: string) => `"${v.replace(/"/gu, '""')}"`;
    const lines = [['วันที่', 'เลขที่', 'รายการ', 'บัญชีค่าใช้จ่าย', 'ผู้เบิก', 'ภาษีซื้อ', 'จำนวนเงิน', 'หลักฐาน'].map(q).join(','),
      ...pending.map((i) => [thaiDate(i.issue_date), i.doc_no, i.description, `${i.account_code ?? ''} ${accountNames[i.account_code ?? ''] ?? ''}`, i.paid_by ?? '', vatText(i).text, i.grand_total, i.evidence ?? ''].map(q).join(','))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `petty-cash-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function vatText(i: PettyItem): { text: string; tone: 'muted' | 'bad' | null } {
    const t = typeOf(i.wht_type);
    if (t) return { text: `${i.individual ? 'บุคคลธรรมดา' : 'นิติบุคคล'} · ต้องหัก ${pctText(rateBp(t.rate))}%?`, tone: 'bad' };
    if (i.vat_mode === 'full_invoice') return { text: `ใบกำกับเต็มรูป · 7% = ${money(i.vat)}`, tone: null };
    if (i.vat_mode === 'abbreviated_no_claim') return { text: 'ใบกำกับอย่างย่อ · ไม่ขอคืน', tone: null };
    return { text: 'ไม่มี', tone: 'muted' };
  }
  const evidenceCell = (e: string | null) => (e ?? '').includes('ใบรับรองแทน')
    ? <span style={css('color: #a2191f')}>ไม่มีบิล · ใบรับรองแทน</span>
    : <span style={css('color: #0e6027')}>{`✓ ${e ?? ''}`}</span>;

  return (
    <>
      <TopBar crumb="การเงิน / เงินสดย่อย / กองสำนักงานใหญ่" right={
        <select aria-label="กองเงินสดย่อย" style={css('height: 32px; padding: 0 12px; border: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 13px')}>
          <option>{`กองสำนักงานใหญ่ · วงเงิน ${imprestShort(summary.imprest)}`}</option>
        </select>} />
      <div style={css(S.content)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css(S.h1)}>เงินสดย่อย — กองสำนักงานใหญ่</h1><span style={css(S.sub)}>{`ระบบ imprest · ผู้ถือ [พนักงานธุรการ] · วงเงิน ${money(summary.imprest)}`}</span></div>
          <div style={css('display: flex; gap: 8px')}>
            <Button size={36} disabled title="ยังไม่มี API การตรวจนับ">นับเงิน / ตรวจกอง</Button>
            <Button size={36} kind="primary" onClick={() => setAdding(!adding)} aria-expanded={adding}>+ บันทึกจ่าย</Button>
          </div>
        </div>
        {adding && (
          <section aria-label="บันทึกจ่าย" style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
            <label style={css(LABEL)}>วันที่<input value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
            <label style={css(`grid-column: span 2; ${LABEL}`)}>รายการ<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>จำนวนเงิน<input value={f.amount} inputMode="decimal" onChange={(e) => setF({ ...f, amount: e.target.value })} onBlur={(e) => setF({ ...f, amount: norm(e.target.value) ? money(norm(e.target.value)) : e.target.value })} style={css(`${INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} /></label>
            <label style={css(`grid-column: span 2; ${LABEL}`)}>บัญชีค่าใช้จ่าย<select value={f.accountCode} onChange={(e) => setF({ ...f, accountCode: e.target.value })} style={css(INPUT)}>{accounts.map((a) => <option key={a.code} value={a.code}>{`${a.code} ${a.name}`}</option>)}</select></label>
            <label style={css(LABEL)}>ผู้เบิก<input value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>หลักฐาน<select value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} style={css(INPUT)}>{EVIDENCE.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label style={css(LABEL)}>ภาษีซื้อ<select value={f.vatMode} onChange={(e) => setF({ ...f, vatMode: e.target.value })} style={css(INPUT)}>{VAT_MODE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            {f.vatMode === 'full_invoice'
              ? <label style={css(LABEL)}>ภาษีซื้อ 7%<input value={f.inputVat} inputMode="decimal" onChange={(e) => setF({ ...f, inputVat: e.target.value })} style={css(`${INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} /></label>
              : <span />}
            <label style={css(LABEL)}>หัก ณ ที่จ่าย<select value={f.whtType} onChange={(e) => setF({ ...f, whtType: e.target.value })} style={css(INPUT)}>
              <option value="">ไม่มี</option>{whtTypes.map((t) => <option key={t.key} value={t.key}>{`${t.label} ${pctText(rateBp(t.rate))}%`}</option>)}
            </select></label>
            {f.whtType
              ? <label style={css(LABEL)}>ผู้รับเงิน<input list="pc-contacts" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} style={css(INPUT)} /><datalist id="pc-contacts">{contacts.map((c) => <option key={c.id} value={`${c.code} · ${c.name}`} />)}</datalist></label>
              : <span />}
            <div style={css('grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end')}>
              <Button onClick={() => setAdding(false)}>ยกเลิก</Button>
              <Button kind="primary" disabled={busy || !f.description.trim() || !f.amount} onClick={() => void save()}>บันทึก</Button>
            </div>
          </section>
        )}
        <div style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap; align-items: flex-end')}>
          <div><span style={css('color: #525252; font-size: 13px')}>วงเงิน</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(summary.imprest)}</div></div>
          <div><span style={css('color: #525252; font-size: 13px')}>จ่ายไปแล้วรอเบิกชดเชย</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(summary.spentPending)}</div><span style={css('color: #525252')}>{`${pending.length} รายการ`}</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>เงินสดคงเหลือในกอง</span><div style={css(`font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums${low ? '; color: #684e00' : ''}`)}>{money(summary.onHand)}</div>{low && <span style={css('color: #684e00')}>ต่ำกว่า 25% ของวงเงิน — ควรเบิกชดเชย</span>}</div>
          <div style={css('margin-left: auto')}><Button size={36} disabled={busy || !pending.length} onClick={() => void reimburse()}>{`เบิกชดเชย ${money(summary.spentPending)} → สร้าง PV`}</Button></div>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
        <section style={css(S.tableBox)}>
          <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
            <span>{`รายการจ่ายรอบปัจจุบัน${lastReimbursed ? ` (ตั้งแต่เบิกชดเชยครั้งล่าสุด ${thaiDate(lastReimbursed)})` : ''}`}</span>
            <div style={css('display: flex; gap: 8px')}><Button size={32} disabled title="ยังไม่มี API แนบรูปบิล">ถ่ายบิลเพิ่ม</Button><Button size={32} disabled={!pending.length} onClick={exportCsv}>ส่งออก</Button></div>
          </div>
          <table style={css(`${S.table}; min-width: 960px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>เลขที่</th><th style={css(S.th)}>รายการ</th><th style={css(S.th)}>บัญชีค่าใช้จ่าย</th><th style={css(S.th)}>ผู้เบิก</th><th style={css(S.th)}>ภาษีซื้อ</th><th style={css(`${S.th}; text-align: right`)}>จำนวนเงิน</th><th style={css(S.th)}>หลักฐาน</th>
            </tr></thead>
            <tbody>
              {shown.map((i) => {
                const v = vatText(i);
                return (
                  <tr key={i.id} style={css(S.tr)}>
                    <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{`${i.issue_date.slice(8, 10)}/${i.issue_date.slice(5, 7)}`}</td>
                    <td style={css('padding: 0 12px; white-space: nowrap')}>{i.doc_no}</td><td style={css(TD)}>{i.description}</td>
                    <td style={css(TD)}>{`${i.account_code ?? ''} ${accountNames[i.account_code ?? ''] ?? ''}`}</td><td style={css(TD)}>{i.paid_by ?? ''}</td>
                    <td style={css(v.tone === 'muted' ? 'padding: 0 12px; color: #525252' : v.tone === 'bad' ? 'padding: 0 12px; color: #a2191f' : TD)}>{v.text}</td>
                    <td style={css(NUM)}>{money(i.grand_total)}</td><td style={css('padding: 0 12px; white-space: nowrap')}>{evidenceCell(i.evidence)}</td>
                  </tr>
                );
              })}
              {rest.length > 0 && (
                <tr style={css('border-top: 1px solid #e0e0e0; color: #525252')}>
                  <td style={css('height: 40px; padding: 0 12px')} colSpan={6}><button type="button" onClick={() => setAll(true)} style={css('padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer')}>{`… อีก ${rest.length} รายการ`}</button></td>
                  <td style={css(NUM)}>{money(fromCents(rest.reduce((s, i) => s + cents(i.grand_total), 0n)))}</td><td style={css(TD)}></td>
                </tr>
              )}
              {!pending.length && <tr style={css(S.tr)}><td colSpan={8} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}><td colSpan={6} style={css('height: 40px; padding: 0 12px')}>{`รวมรอเบิกชดเชย · ${pending.length} รายการ`}</td><td style={css(NUM)}>{money(summary.spentPending)}</td><td></td></tr></tfoot>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section style={css('flex: 1 1 380px; background: #f4f4f4; border: 1px solid #e0e0e0')}>
            <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>เมื่อเบิกชดเชย ระบบลงบัญชีให้</strong><span style={css('font-size: 13px; color: #525252')}>สูตร PC-REIMB</span></div>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}><tbody>
              <tr><td style={css('height: 32px; padding: 0 16px')}>Dr 53xxxxx ค่าใช้จ่ายแต่ละบัญชี (รวม)</td><td style={css('width: 110px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(fromCents(spent - vat))}</td><td style={css('width: 110px')}></td></tr>
              {vat > 0n && <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px')}>Dr 1170100 ภาษีซื้อ</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(fromCents(vat))}</td><td></td></tr>}
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px 0 32px')}>Cr 1100100 เงินฝากธนาคาร</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(fromCents(spent - wht))}</td></tr>
              {/* TODO(Wei): แบบร่าง/fixtures ไม่มีบรรทัดนี้ — API ลงหัก ณ ที่จ่ายของรายการที่มีประเภทเงินได้ (กติกา "หักตอนจ่ายจริง") · ยอดนี้เป็นตัวอย่างตามอัตราในตาราง (ฟรีแลนซ์ = ค่าตั้งรอยืนยัน) */}
              {wht > 0n && <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px 0 32px')}>Cr 2150300 ภาษีหัก ณ ที่จ่ายค้างนำส่ง</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(fromCents(wht))}</td></tr>}
            </tbody></table>
            <div style={css('padding: 8px 16px; font-size: 13px; color: #525252; border-top: 1px solid #e0e0e0')}>{`วงเงินกอง (${summary.account} ${accountNames[summary.account] ?? 'เงินสดย่อย'} ${imprestShort(summary.imprest)}) คงที่ ไม่กระทบจากการจ่ายรายวัน`}</div>
          </section>
          <section style={css('flex: 1 1 320px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>ตรวจนับล่าสุด</strong>
            {/* TODO(backend): ข้อมูลการตรวจนับ (วันที่ · ผู้นับ · ผล · เงินสดนับได้ · ใบสำคัญจ่าย) ยังไม่มีใน API */}
            <div style={css('display: flex; justify-content: space-between')}><span>—</span><span style={css('color: #525252')}>—</span></div>
            <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>เงินสดนับได้</span><span style={css('font-variant-numeric: tabular-nums')}>—</span></div>
            <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>ใบสำคัญจ่าย</span><span style={css('font-variant-numeric: tabular-nums')}>—</span></div>
            <span style={css('color: #525252')}>นับครั้งถัดไปแนะนำ: ก่อนเบิกชดเชย หรือสิ้นเดือน</span>
          </section>
        </div>
      </div>
    </>
  );
}
