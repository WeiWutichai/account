'use client';
// แก้ไขเอกสารที่ผ่านรายการแล้ว — design/project/ScreenDocEdit.dc.html
// หลังผ่านรายการแก้ได้เฉพาะข้อมูลอ้างอิง (CLAUDE.md) — ยอด/ภาษี/บัญชีแก้ไม่ได้ ต้องยกเลิกแล้วออกใหม่ หรือออกใบลดหนี้/เพิ่มหนี้
// "เหตุผลการแก้ไข (บังคับ)" ส่งเป็น reason → เก็บใน document_event (reference_edited)
import { ButtonLink, Button, css, href, money, parseThaiDate, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { docVoidHref } from '../../../_shared/types';

type Key = 'address' | 'reference' | 'due_date' | 'notes';
interface Props {
  doc: { id: string; docNo: string; status: string; title: string; contact: string; total: string; taxNote: string; state: string; fields: Record<Key, string | null> };
  nav: { list: string; listLabel: string; view: string };
  impacts: { label: string; value: string; tone: 'ok' | 'bad' | 'muted' }[];
  history: { when: string; what: string; who: string }[];
}
const ROWS: { key: Key; label: string; result: string; date?: boolean }[] = [
  { key: 'address', label: 'ที่อยู่ลูกค้าบนเอกสาร', result: 'แก้ได้' },
  { key: 'reference', label: 'เลขที่อ้างอิง', result: 'แก้ได้' },
  { key: 'due_date', label: 'วันครบกำหนด', result: 'แก้ได้ · ไม่กระทบ GL', date: true },
  { key: 'notes', label: 'หมายเหตุ', result: 'แก้ได้ · ไม่กระทบ GL' },
];
const TONE = { ok: 'color: #0e6027', bad: 'color: #a2191f', muted: 'color: #525252' };
const IN = 'width: 180px; height: 32px; padding: 0 12px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';
const TH = 'height: 40px; padding: 0 12px; font-weight: 400';

export function EditForm({ doc, nav, impacts, history }: Props) {
  const router = useRouter();
  const shown = (k: Key, v: string | null) => (v ? (k === 'due_date' ? thaiDate(v) : v) : '');
  const [vals, setVals] = useState<Record<Key, string>>(() => Object.fromEntries(ROWS.map((r) => [r.key, shown(r.key, doc.fields[r.key])])) as Record<Key, string>);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const voided = doc.status === 'voided';
  const changed = ROWS.filter((r) => vals[r.key].trim() !== shown(r.key, doc.fields[r.key]));

  async function save() {
    setMsg(null);
    if (!changed.length) return;
    if (!reason.trim()) { setMsg({ kind: 'err', text: 'ต้องระบุเหตุผลการแก้ไข' }); return; }
    const patch: Partial<Record<Key, string | null>> = {};
    for (const r of changed) {
      const v = vals[r.key].trim();
      if (r.date && v && !parseThaiDate(v)) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
      patch[r.key] = v ? (r.date ? parseThaiDate(v) : v) : null;
    }
    setBusy(true);
    const res = await fetch(`/api/proxy/documents/${doc.id}/reference`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...patch, reason: reason.trim() }) });
    const r = (await res.json()) as { ok?: boolean; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: `บันทึกการแก้ไขแล้ว (${changed.length} ช่อง)` });
    setReason('');
    router.refresh();
  }

  return (
    <>
      <header style={css(S.topbar)}><span style={css(S.crumb)}><a href={nav.list} style={css('text-decoration: none')}>{nav.listLabel}</a> / <a href={nav.view} style={css('text-decoration: none')}>{doc.docNo}</a> / แก้ไข</span>
        {voided ? <Tag kind="error">ยกเลิกแล้ว</Tag> : <Tag kind="success">ผ่านรายการแล้ว</Tag>}</header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css(S.h1)}>แก้ไข {doc.docNo}</h1><span style={css(S.sub)}>แก้ได้เฉพาะข้อมูลอ้างอิงและการจัดประเภท — ยอดเงินและภาษีของเอกสารที่ผ่านรายการแล้วแก้ไม่ได้ เพื่อให้เลขที่และรายงานภาษีคงความต่อเนื่อง</span></div>
        <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 24px; font-size: 14px')}>
          <div><span style={css('font-size: 13px; color: #525252')}>เอกสาร</span><div style={css('font-weight: 600')}>{doc.title}</div></div>
          <div><span style={css('font-size: 13px; color: #525252')}>ลูกค้า</span><div>{doc.contact}</div></div>
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
                  {ROWS.map((r) => (
                    <tr key={r.key} style={css('border-top: 1px solid #e0e0e0')}>
                      <td style={css('height: 40px; padding: 0 12px')}>{r.label}</td>
                      <td style={css('padding: 0 12px')}>{shown(r.key, doc.fields[r.key]) || '—'}</td>
                      <td style={css('padding: 0 12px')}><input aria-label={`${r.label} ค่าใหม่`} disabled={voided} value={vals[r.key]} placeholder={r.date ? 'วว/ดด/ปปปป' : undefined} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} style={css(r.date ? `${IN}; font-variant-numeric: tabular-nums` : IN)} /></td>
                      <td style={css('padding: 0 12px')}>{r.result}</td>
                    </tr>
                  ))}
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px')}>จำนวนเงิน / VAT / อัตราหัก ณ ที่จ่าย / ลูกค้า</td><td style={css('padding: 0 12px')}>{money(doc.total)}</td><td style={css('padding: 0 12px')}>—</td>
                    <td style={css('padding: 0 12px')}><a href={docVoidHref(doc.id)} style={css('text-decoration: none; color: #da1e28')}>แก้ไม่ได้ · ยกเลิกและออกใหม่</a> หรือ <a href={`${href('creditnote')}/new?ref=${doc.id}`} style={css('text-decoration: none')}>ใบลดหนี้/เพิ่มหนี้</a></td></tr>
                </tbody>
              </table>
            </section>
            <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css('grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>เหตุผลการแก้ไข (บังคับ)<input disabled={voided} value={reason} onChange={(e) => setReason(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616')} /></label>
            </section>
            <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}><div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>รายการบัญชีที่จะเกิด</strong><span style={css('font-size: 13px; color: #525252')}>เฉพาะเมื่อย้ายบัญชีค่าใช้จ่าย · ไม่มีถ้าแก้แค่ข้อมูลอ้างอิง</span></div></section>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>ผลกระทบของการแก้ไขครั้งนี้</strong>
              {impacts.map((x) => <div key={x.label} style={css('display: flex; justify-content: space-between; gap: 8px')}><span>{x.label}</span><span style={css(TONE[x.tone])}>{x.value}</span></div>)}
            </section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>ประวัติการแก้ไขเอกสารนี้</strong>
              {history.map((h, i) => <div key={i} style={css('display: flex; justify-content: space-between; gap: 8px; color: #525252')}><span>{h.when} {h.what}</span><span>{h.who}</span></div>)}
              <span style={css('font-size: 13px; color: #525252')}>ทุกการแก้ไขเก็บค่าเดิม → ค่าใหม่ ใน <a href={href('audit')} style={css('text-decoration: none')}>Audit log</a></span></section>
            <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; padding: 12px 16px; font-size: 13px; color: #525252')}>ถ้างวดปิดอ่อนแล้ว ผู้จัดการบัญชียังแก้ข้อมูลอ้างอิงได้ · ถ้าปิดแข็ง แก้ไม่ได้ทุกช่อง ต้องเปิดงวดคืนพร้อมเหตุผล (<a href={href('close')} style={css('text-decoration: none')}>ปิดงวด</a>)</section>
          </aside>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}><span style={css('font-size: 13px; color: #525252')}>เปลี่ยน {changed.length} ช่อง · สร้าง 0 รายการบัญชี</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <ButtonLink href={nav.view}>ยกเลิก</ButtonLink>
          {!voided && <ButtonLink href={docVoidHref(doc.id)} kind="danger">ยกเลิกเอกสารแทน</ButtonLink>}
          <Button kind="primary" disabled={busy || voided || !changed.length} onClick={() => void save()}>บันทึกการแก้ไข</Button>
        </div></div>
    </>
  );
}
