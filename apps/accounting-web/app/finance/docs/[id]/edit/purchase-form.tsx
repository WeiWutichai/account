'use client';
// แก้ไขบิลซื้อ/ค่าใช้จ่ายที่ผ่านรายการแล้ว — design/project/ScreenDocEdit.dc.html (ตัวอย่างในแบบร่างคือ AP2611-0079)
// PUT /v1/documents/:id/purchase-edit {partyTaxId, vendorRef, vendorInvoiceDate, projectCode, lines[{lineId, accountCode}], reason}
// ย้ายบัญชีค่าใช้จ่าย = JV โอนย้าย Dr บัญชีใหม่ / Cr บัญชีเดิม (ผูกเอกสาร) · ยอด/VAT/หัก ณ ที่จ่าย/ผู้ขาย แก้ไม่ได้
// TODO(Wei) ScreenDocEdit.dc.html: แบบร่างมีแถว "บัญชีค่าใช้จ่ายของบรรทัด" แถวเดียว — เอกสารหลายบรรทัดแสดง 1 แถวต่อบรรทัด (ต่อท้ายชื่อด้วยลำดับบรรทัด)
// TODO(backend): ทะเบียนมิติ/โครงการยังไม่มี → "มิติ / โครงการ" เป็นช่องข้อความ (แบบร่างเป็นตัวเลือก PRJ-07 [ลูกค้า A] …) · ไฟล์แนบยังไม่มีระบบ
import { Button, ButtonLink, css, href, money, parseThaiDate, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { docVoidHref } from '../../../_shared/types';

export interface PurchaseEditProps {
  doc: { id: string; docNo: string; status: string; title: string; contact: string; total: string; taxNote: string; state: string;
    taxId: string | null; vendorRef: string | null; vendorInvoiceDate: string | null; projectCode: string | null };
  lines: { id: string; no: number; description: string; account: string; amount: string }[];
  accounts: { code: string; name: string }[];
  nav: { list: string; listLabel: string; view: string };
  month: string; pp30: string | null;
  period: { label: string; value: string; tone: 'ok' | 'bad' } | null;
  history: { when: string; what: string; who: string }[];
}
const TONE = { ok: 'color: #0e6027', bad: 'color: #a2191f', muted: 'color: #525252' };
const IN = 'width: 180px; height: 32px; padding: 0 12px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';
const TH = 'height: 40px; padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';

export function PurchaseEditForm({ doc, lines, accounts, nav, month, pp30, period, history }: PurchaseEditProps) {
  const router = useRouter();
  const name = (c: string) => accounts.find((a) => a.code === c)?.name ?? '';
  const [taxId, setTaxId] = useState(doc.taxId ?? '');
  const [ref, setRef] = useState(doc.vendorRef ?? '');
  const [invDate, setInvDate] = useState(doc.vendorInvoiceDate ? thaiDate(doc.vendorInvoiceDate) : '');
  const [project, setProject] = useState(doc.projectCode ?? '');
  const [acct, setAcct] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.account])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const voided = doc.status === 'voided';

  const taxChanged = taxId.trim() !== (doc.taxId ?? '');
  const refChanged = ref.trim() !== (doc.vendorRef ?? '');
  const dateChanged = invDate.trim() !== (doc.vendorInvoiceDate ? thaiDate(doc.vendorInvoiceDate) : '');
  const projChanged = project.trim() !== (doc.projectCode ?? '');
  const moves = lines.filter((l) => acct[l.id] && acct[l.id] !== l.account);
  const changedCount = [taxChanged, refChanged, dateChanged, projChanged].filter(Boolean).length + moves.length;

  async function save() {
    setMsg(null);
    if (!changedCount) return;
    if (!reason.trim()) { setMsg({ kind: 'err', text: 'ต้องระบุเหตุผลการแก้ไข' }); return; }
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (taxChanged) body.partyTaxId = taxId.trim() || null;
    if (refChanged) body.vendorRef = ref.trim() || null;
    if (dateChanged) {
      const d = invDate.trim() ? parseThaiDate(invDate.trim()) : null;
      if (invDate.trim() && !d) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
      body.vendorInvoiceDate = d;
    }
    if (projChanged) body.projectCode = project.trim() || null;
    if (moves.length) body.lines = moves.map((l) => ({ lineId: l.id, accountCode: acct[l.id] }));
    setBusy(true);
    const res = await fetch(`/api/proxy/documents/${doc.id}/purchase-edit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = (await res.json()) as { changed?: number; journalNo?: string | null; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: `บันทึกการแก้ไขแล้ว (${r.changed ?? changedCount} ช่อง)${r.journalNo ? ` · ${r.journalNo}` : ''}` });
    setReason('');
    router.refresh();
  }

  const taxNote = (v: string | null) => (v ? `${v}${/^\d{13}$/u.test(v) ? '' : ` (${v.length} หลัก)`}` : '—');
  return (
    <>
      <header style={css(S.topbar)}><span style={css(S.crumb)}><a href={nav.list} style={css('text-decoration: none')}>{nav.listLabel}</a> / <a href={nav.view} style={css('text-decoration: none')}>{doc.docNo}</a> / แก้ไข</span>
        {voided ? <Tag kind="error">ยกเลิกแล้ว</Tag> : <Tag kind="success">ผ่านรายการแล้ว</Tag>}</header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css(S.h1)}>แก้ไข {doc.docNo}</h1><span style={css(S.sub)}>แก้ได้เฉพาะข้อมูลอ้างอิงและการจัดประเภท — ยอดเงินและภาษีของเอกสารที่ผ่านรายการแล้วแก้ไม่ได้ เพื่อให้เลขที่และรายงานภาษีคงความต่อเนื่อง</span></div>
        <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 24px; font-size: 14px')}>
          <div><span style={css('font-size: 13px; color: #525252')}>เอกสาร</span><div style={css('font-weight: 600')}>{doc.title}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>ผู้ขาย</span><div>{doc.contact}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>ยอดรวม</span><div style={css('font-variant-numeric: tabular-nums')}>{money(doc.total)}{doc.taxNote}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>สถานะ / งวด</span><div>{doc.state}</div></div>
        </section>
        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
              <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>สิ่งที่แก้ไขได้ในเอกสารที่ผ่านรายการแล้ว</strong><span style={css('font-size: 13px; color: #525252')}>ช่องที่กระทบยอด/ภาษี ต้องยกเลิกแล้วออกใหม่</span></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css(S.theadRow)}><th style={css(TH)}>ช่อง</th><th style={css(TH)}>ค่าปัจจุบัน</th><th style={css(TH)}>ค่าใหม่</th><th style={css(TH)}>ผล</th></tr></thead>
                <tbody>
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 40px; ${TD}`)}>เลขประจำตัวผู้เสียภาษีของผู้ขาย</td><td style={css(`${TD}; font-variant-numeric: tabular-nums`)}>{taxNote(doc.taxId)}</td>
                    <td style={css(TD)}><input aria-label="เลขประจำตัวผู้เสียภาษีของผู้ขาย ค่าใหม่" disabled={voided} value={taxId} onChange={(e) => setTaxId(e.target.value)} style={css(`${IN}; font-variant-numeric: tabular-nums`)} /></td><td style={css(TD)}>แก้ได้ · อัปเดตรายงานภาษีซื้อ</td></tr>
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 40px; ${TD}`)}>เลขที่ใบกำกับของผู้ขาย</td><td style={css(TD)}>{doc.vendorRef ?? '—'}</td>
                    <td style={css(TD)}><input aria-label="เลขที่ใบกำกับของผู้ขาย ค่าใหม่" disabled={voided} value={ref} onChange={(e) => setRef(e.target.value)} style={css(IN)} /></td><td style={css(TD)}>แก้ได้</td></tr>
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 40px; ${TD}`)}>วันที่ในใบกำกับของผู้ขาย</td><td style={css(`${TD}; font-variant-numeric: tabular-nums`)}>{doc.vendorInvoiceDate ? thaiDate(doc.vendorInvoiceDate) : '—'}</td>
                    <td style={css(TD)}><input aria-label="วันที่ในใบกำกับของผู้ขาย ค่าใหม่" disabled={voided} value={invDate} placeholder="วว/ดด/ปปปป" onChange={(e) => setInvDate(e.target.value)} style={css(`${IN}; font-variant-numeric: tabular-nums`)} /></td><td style={css(TD)}>แก้ได้ภายในงวดเดียวกัน</td></tr>
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 40px; ${TD}`)}>มิติ / โครงการ / หมายเหตุ / ไฟล์แนบ</td><td style={css(TD)}>{doc.projectCode ?? '—'}</td>
                    <td style={css(TD)}><input aria-label="มิติ / โครงการ ค่าใหม่" disabled={voided} value={project} onChange={(e) => setProject(e.target.value)} style={css(IN)} /></td><td style={css(TD)}>แก้ได้ · ไม่กระทบ GL</td></tr>
                  {lines.map((l) => (
                    <tr key={l.id} style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 40px; ${TD}`)}>บัญชีค่าใช้จ่ายของบรรทัด{lines.length > 1 ? ` ${l.no}` : ''}</td><td style={css(TD)}>{l.account}</td>
                      <td style={css(TD)}><select aria-label={`บัญชีค่าใช้จ่ายของบรรทัด ${l.no} ค่าใหม่`} disabled={voided} value={acct[l.id]} onChange={(e) => setAcct({ ...acct, [l.id]: e.target.value })} style={css(IN)}>
                        {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td><td style={css(TD)}>แก้ได้ · สร้าง JV โอนย้ายบัญชี</td></tr>
                  ))}
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 40px; ${TD}`)}>จำนวนเงิน / VAT / อัตราหัก ณ ที่จ่าย / ผู้ขาย</td><td style={css(`${TD}; font-variant-numeric: tabular-nums`)}>{money(doc.total)}</td><td style={css(TD)}>—</td>
                    <td style={css(TD)}><a href={docVoidHref(doc.id)} style={css('text-decoration: none; color: #da1e28')}>แก้ไม่ได้ · ยกเลิกและออกใหม่</a> หรือ <a href={`${href('purchasecn')}/new?ref=${doc.id}`} style={css('text-decoration: none')}>ใบลดหนี้/เพิ่มหนี้</a></td></tr>
                </tbody>
              </table>
            </section>
            <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css('grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>เหตุผลการแก้ไข (บังคับ)<input disabled={voided} value={reason} onChange={(e) => setReason(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616')} /></label>
            </section>
            <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}><div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>รายการบัญชีที่จะเกิด</strong><span style={css('font-size: 13px; color: #525252')}>เฉพาะเมื่อย้ายบัญชีค่าใช้จ่าย · ไม่มีถ้าแก้แค่ข้อมูลอ้างอิง</span></div>
              {moves.length > 0 && <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}><tbody>
                {moves.flatMap((l) => [
                  <tr key={`${l.id}-dr`}><td style={css(`height: 32px; ${TD}`)}>Dr {acct[l.id]} {name(acct[l.id]!)}</td><td style={css(`${TD}; text-align: right; font-variant-numeric: tabular-nums`)}>{money(l.amount)}</td></tr>,
                  <tr key={`${l.id}-cr`} style={css('border-top: 1px solid #e0e0e0')}><td style={css(`height: 32px; ${TD}; padding-left: 32px`)}>Cr {l.account} {name(l.account)}</td><td style={css(`${TD}; text-align: right; font-variant-numeric: tabular-nums`)}>{money(l.amount)}</td></tr>,
                ])}
              </tbody></table>}
            </section>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>ผลกระทบของการแก้ไขครั้งนี้</strong>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>รายงานภาษีซื้อ {month}</span><span style={css(TONE.ok)}>{taxChanged ? `แก้เลขผู้เสียภาษีในบรรทัด ${doc.vendorRef ?? doc.docNo} · ยอดไม่เปลี่ยน` : 'ยอดไม่เปลี่ยน'}</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>ภ.พ.30 {month} (ร่าง)</span><span style={css(TONE.muted)}>ไม่เปลี่ยน{pp30 ? ` · ${money(pp30)}` : ''}</span></div>
              {period && <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>{period.label}</span><span style={css(TONE[period.tone])}>{period.value}</span></div>}
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>สิทธิ์ที่ต้องใช้</span><span style={css(TONE.muted)}>ผู้จัดการบัญชี</span></div>
            </section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>ประวัติการแก้ไขเอกสารนี้</strong>
              {history.map((h, i) => <div key={i} style={css('display: flex; justify-content: space-between; gap: 8px; color: #525252')}><span>{h.when} {h.what}</span><span>{h.who}</span></div>)}
              <span style={css('font-size: 13px; color: #525252')}>ทุกการแก้ไขเก็บค่าเดิม → ค่าใหม่ ใน <a href={href('audit')} style={css('text-decoration: none')}>Audit log</a></span></section>
            <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; padding: 12px 16px; font-size: 13px; color: #525252')}>ถ้างวดปิดอ่อนแล้ว ผู้จัดการบัญชียังแก้ข้อมูลอ้างอิงได้ · ถ้าปิดแข็ง แก้ไม่ได้ทุกช่อง ต้องเปิดงวดคืนพร้อมเหตุผล (<a href={href('close')} style={css('text-decoration: none')}>ปิดงวด</a>)</section>
          </aside>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}><span style={css('font-size: 13px; color: #525252')}>เปลี่ยน {changedCount} ช่อง · สร้าง {moves.length ? 1 : 0} รายการบัญชี</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <ButtonLink href={nav.view}>ยกเลิก</ButtonLink>
          {!voided && <ButtonLink href={docVoidHref(doc.id)} kind="danger">ยกเลิกเอกสารแทน</ButtonLink>}
          <Button kind="primary" disabled={busy || voided || !changedCount} onClick={() => void save()}>บันทึกการแก้ไข</Button>
        </div></div>
    </>
  );
}
