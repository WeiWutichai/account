'use client';
// ยกเลิก / กลับรายการเอกสาร — design/project/ScreenDocVoid.dc.html
// API รับเหตุผลเป็นข้อความเดียว: รวม "เหตุผล · เอกสารที่ออกแทน · รายละเอียดเพิ่มเติม" ไว้ใน reason (บันทึกใน audit/ประวัติเอกสาร)
// TODO(Wei): "ระบบจะเชื่อมโยงสองฉบับเข้าด้วยกัน" — API ยังไม่มีช่องเชื่อมเอกสารที่ออกแทน (เก็บเป็นข้อความในเหตุผลก่อน)
import { buttonStyle, ButtonLink, css, money, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cents } from '../../../_shared/num';
import type { JournalRow } from '../../../_shared/types';

export interface VoidCheck { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; money?: boolean }
interface Props {
  doc: { id: string; docNo: string; docType: string; typeName: string; status: string; voidReason: string | null; contact: string; total: string; issue: string; period: string };
  nav: { list: string; listLabel: string; view: string };
  checks: VoidCheck[];
  journal: JournalRow[];
  today: string;
  canCredit: boolean;
  creditHref: string;
}
const TONE: Record<VoidCheck['tone'], string> = { ok: 'color: #0e6027', warn: 'color: #684e00', bad: 'color: #a2191f', muted: 'color: #525252' };
const REASONS = ['ออกซ้ำกับเอกสารอื่น', 'ข้อมูลลูกค้า/ยอดผิด ออกใหม่', 'ลูกค้ายกเลิกงานก่อนเริ่ม', 'อื่น ๆ (ระบุ)'];
const FIELD = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const NUMC = 'width: 120px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums';

export function VoidForm({ doc, nav, checks, journal, today, canCredit, creditHref }: Props) {
  const router = useRouter();
  const [how, setHow] = useState<'void' | 'cn'>('void');
  const [reason, setReason] = useState(REASONS[0]!);
  const [replacement, setReplacement] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const voided = doc.status === 'voided';
  const jno = journal[0]?.journal_no ?? null;

  async function confirm() {
    if (how === 'cn') { router.push(creditHref); return; }
    setMsg(null);
    const other = reason === REASONS[3];
    if (other && !detail.trim()) { setMsg({ kind: 'err', text: 'ต้องระบุเหตุผลการยกเลิก' }); return; }
    const text = [other ? detail.trim() : reason, replacement.trim() ? `เอกสารที่ออกแทน ${replacement.trim()}` : '', other ? '' : detail.trim()].filter(Boolean).join(' · ');
    setBusy(true);
    const res = await fetch(`/api/proxy/documents/${doc.id}/void`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: text, date: today }) });
    const r = (await res.json()) as { reversal?: string | null; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'ยกเลิกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: `ยกเลิก ${doc.docNo} แล้ว${r.reversal ? ` · รายการกลับบัญชี ${r.reversal}` : ''}` });
    router.refresh();
  }

  return (
    <>
      <header style={css(S.topbar)}><span style={css(S.crumb)}><a href={nav.list} style={css('text-decoration: none')}>{nav.listLabel}</a> / <a href={nav.view} style={css('text-decoration: none')}>{doc.docNo}</a> / ยกเลิกเอกสาร</span>
        {voided ? <Tag kind="error">ยกเลิกแล้ว</Tag> : <Tag kind="success">ผ่านรายการแล้ว</Tag>}</header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css(S.h1)}>ยกเลิกเอกสาร {doc.docNo}</h1><span style={css(S.sub)}>เอกสารที่ผ่านรายการแล้วไม่ถูกลบ — ระบบสร้างรายการกลับบัญชีและคงเลขที่ไว้เพื่อให้เลขเอกสารต่อเนื่อง</span></div>
        <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 24px; font-size: 14px')}>
          <div><span style={css('font-size: 13px; color: #525252')}>เอกสาร</span><div style={css('font-weight: 600')}>{doc.docNo} {doc.typeName}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>ลูกค้า</span><div>{doc.contact}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>ยอดรวม</span><div style={css('font-variant-numeric: tabular-nums')}>{money(doc.total)}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>สถานะ / งวด</span><div>{voided ? `ยกเลิกแล้ว${doc.voidReason ? ` · ${doc.voidReason}` : ''}` : `ผ่านรายการ ${thaiDate(doc.issue)} · ${doc.period}`}</div></div>
        </section>
        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <fieldset style={css('border: 1px solid #e0e0e0; padding: 16px; margin: 0; display: flex; flex-direction: column; gap: 12px; font-size: 14px')}>
              <legend style={css('padding: 0 6px; font-weight: 600')}>วิธียกเลิก</legend>
              <label style={css('display: flex; gap: 10px; align-items: flex-start')}><input type="radio" name="how" checked={how === 'void'} onChange={() => setHow('void')} style={css('margin-top: 5px')} /><span><strong>ยกเลิกเอกสาร (void)</strong><br /><span style={css('color: #525252')}>เลขที่คงอยู่พร้อมสถานะ “ยกเลิก” · ระบบสร้างรายการกลับบัญชี (reversal) ลงวันที่วันนี้ · ใช้เมื่อเอกสารออกผิด/ซ้ำ และยังไม่ส่งลูกค้า หรือลูกค้าคืนต้นฉบับ</span></span></label>
              <label style={css(`display: flex; gap: 10px; align-items: flex-start${canCredit ? '' : '; color: #6f6f6f'}`)}><input type="radio" name="how" checked={how === 'cn'} disabled={!canCredit} onChange={() => setHow('cn')} style={css('margin-top: 5px')} /><span><strong>ออกใบลดหนี้แทน</strong><br /><span style={canCredit ? css('color: #525252') : undefined}>กรณีลูกค้ารับใบกำกับภาษีไปแล้วหรืออยู่คนละเดือนภาษี — ต้องใช้ใบลดหนี้ตาม ม.86/10 ระบบจะพาไปหน้าใบลดหนี้พร้อมอ้างอิงเอกสารนี้</span></span></label>
              <label style={css('display: flex; gap: 10px; align-items: flex-start; color: #6f6f6f')}><input type="radio" name="how" disabled style={css('margin-top: 5px')} /><span><strong>ลบเอกสาร</strong><br /><span>ทำได้เฉพาะสถานะ “ร่าง” เท่านั้น — เอกสารที่ผ่านรายการแล้วลบไม่ได้</span></span></label>
            </fieldset>
            <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css(LABEL)}>เหตุผล (บังคับ · แสดงใน Audit log)<select value={reason} disabled={voided} onChange={(e) => setReason(e.target.value)} style={css(FIELD)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
              <label style={css(LABEL)}>เอกสารที่ออกแทน (ถ้ามี)<input value={replacement} disabled={voided} onChange={(e) => setReplacement(e.target.value)} style={css(FIELD)} /><span style={css('font-size: 13px; color: #525252')}>ระบบจะเชื่อมโยงสองฉบับเข้าด้วยกัน</span></label>
              <label style={css(`grid-column: span 2; ${LABEL}`)}>รายละเอียดเพิ่มเติม<textarea rows={3} value={detail} disabled={voided} onChange={(e) => setDetail(e.target.value)} style={css('padding: 8px 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616; resize: vertical')} /></label>
            </section>
            {jno && (
              <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}><div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่างรายการกลับบัญชีที่จะสร้าง ({jno}R)</strong><span style={css('font-size: 13px; color: #525252')}>กลับทุกบรรทัดของ {jno} · ลงวันที่ {thaiDate(today)}</span></div>
                <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}><tbody>
                  {[...journal.filter((l) => cents(l.credit) > 0n), ...journal.filter((l) => cents(l.credit) === 0n)].map((l, i) => {
                    const dr = cents(l.credit) > 0n; // กลับรายการ: เครดิตเดิม → เดบิต
                    return (
                      <tr key={l.line_no} style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
                        <td style={css(dr ? 'height: 32px; padding: 0 16px' : 'height: 32px; padding: 0 16px 0 32px')}>{dr ? 'Dr' : 'Cr'} {l.account_code} {l.name}</td>
                        <td style={css(NUMC)}>{dr ? money(l.credit) : ''}</td><td style={css(NUMC)}>{dr ? '' : money(l.debit)}</td>
                      </tr>
                    );
                  })}
                </tbody></table></section>
            )}
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>ตรวจสอบก่อนยกเลิก</strong>
              {checks.map((c) => <div key={c.label} style={css('display: flex; justify-content: space-between; gap: 8px')}><span>{c.label}</span><span style={css(TONE[c.tone])}>{c.money ? c.value.replace(/^(-?\d+\.\d{2})/u, (m) => money(m)) : c.value}</span></div>)}
            </section>
            <section style={css('background: #fff1f1; border: 1px solid #ffb3b8; padding: 12px 16px; font-size: 13px; color: #a2191f')}>การยกเลิกเอกสารที่ผ่านรายการต้องใช้สิทธิ์ผู้จัดการบัญชีขึ้นไป · บันทึกผู้ทำ เหตุผล และรายการกลับบัญชีใน Audit log แบบลบไม่ได้ · ถ้างวดปิดแข็งแล้วจะทำไม่ได้ ต้องใช้ใบลดหนี้ในงวดปัจจุบันแทน</section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 6px')}><strong>ใช้หน้านี้กับเอกสารประเภทใดบ้าง</strong><span style={css('color: #525252')}>IV, RV, CN/DN, AP, EXP, PV, JV — เงื่อนไขต่างกันตามประเภท เช่น RV ที่เช็คผ่านแล้วต้องทำรายการคืนเงินแทน · PV ที่โอนแล้วยกเลิกไม่ได้ ต้องบันทึกรับคืนจากผู้ขาย</span></section>
          </aside>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}><span style={css('font-size: 13px; color: #525252')}>ต้องยืนยันด้วยรหัส 2FA เมื่อกดยกเลิก</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <ButtonLink href={nav.view}>กลับ</ButtonLink>
          {canCredit && <ButtonLink href={creditHref}>ไปออกใบลดหนี้แทน</ButtonLink>}
          <button type="button" disabled={busy || voided} onClick={() => void confirm()} style={buttonStyle('danger', 40, busy || voided, busy || voided ? '' : 'background: #da1e28; color: #ffffff')}>ยืนยันยกเลิกและกลับรายการ</button>
        </div></div>
    </>
  );
}
