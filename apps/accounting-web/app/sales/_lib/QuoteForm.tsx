'use client';
// S4 ใบเสนอราคา / ใบสั่งขาย — design/project/ScreenQuote.dc.html (QO/SO ไม่ลงบัญชี · แปลง QO → SO → IV / QO → DP)
// ส่วนลดบรรทัดกรอกได้ทั้ง "10% + 5%" และจำนวนเงิน — เก็บเป็นจำนวนเงินต่อบรรทัด (SalesLineInput.discount)
import { Button, ButtonLink, css, money, parseThaiDate, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client.ts';
import { addDays, type Contact, daysBetween, docNo, type DocDetail, printHref, statusTag } from './doc.ts';
import { blankLine, linePayload, type LineRow, rowFromLine, useTotals, validRow } from './lines.ts';
import { percentOf, subMoney } from './num.ts';
import { DocHeader, F, Msg } from './ui';

const TERMS = ['มัดจำ 30% · ส่วนที่เหลือ 30 วัน', 'เครดิต 30 วัน'] as const;

export function QuoteForm({ detail, contacts, today, docType, presetContact }: { detail: DocDetail | null; contacts: Contact[]; today: string; docType: 'QO' | 'SO'; presetContact?: string }) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const approved = d?.status === 'approved';
  const label = (c: Contact) => `${c.code} · ${c.name}`;
  const init = detail?.contact ?? contacts.find((c) => c.id === presetContact) ?? null;

  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [contactText, setContactText] = useState(init ? label(init) : '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [days, setDays] = useState(d?.due_date ? String(daysBetween(d.issue_date, d.due_date)) : '');
  // TODO(backend): พนักงานขาย · โครงการ (มิติ) · เงื่อนไขชำระ · ระดับราคา ยังไม่มีฟิลด์ใน acct.document (fixtures QO2611-0014 มี salesperson/dimension/payment_terms/price_level)
  const [term, setTerm] = useState<string>(TERMS[0]);
  const [rows, setRows] = useState<LineRow[]>(detail?.lines.filter((l) => l.line_type === 'item').map(rowFromLine) ?? [blankLine()]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const { totals, idx, err } = useTotals(rows, d?.price_incl_vat ?? false, d?.bill_discount ?? '');

  const contact = contacts.find((c) => contactText.startsWith(`${c.code} `) || contactText === c.code) ?? null;
  const set = (i: number, k: keyof LineRow, v: string | boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const iso = parseThaiDate(date);
  const validUntil = iso && /^\d+$/u.test(days.trim()) ? addDays(iso, Number(days)) : null;

  const payload = () => ({
    docType: d?.doc_type ?? docType, contactId: contact?.id ?? '', issueDate: iso ?? '', dueDate: validUntil, priceInclVat: d?.price_incl_vat ?? false, billDiscount: d?.bill_discount ?? '0.00',
    address: d?.address ?? null, notes: d?.notes ?? null, reference: d?.reference ?? null, refDocumentId: d?.ref_document_id ?? null, creditDays: d?.credit_days ?? null,
    lines: rows.filter(validRow).map(linePayload),
  });
  // บันทึกล่าสุด — อนุมัติโดยไม่บันทึกซ้ำถ้าไม่มีการแก้
  const [saved, setSaved] = useState<string | null>(d ? JSON.stringify(payload()) : null);
  async function save(): Promise<string | null> {
    if (!editable) return id;
    if (!contact) { setMsg({ kind: 'err', text: 'เลือกลูกค้าจากรายการ' }); return null; }
    if (!iso) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    if (rows.some((r) => r.item.trim() && !validRow(r))) { setMsg({ kind: 'err', text: 'กรอกจำนวน ราคา/หน่วย และส่วนลด (เช่น 10% + 5%) ของทุกบรรทัดให้ถูกต้อง' }); return null; }
    const r = await call<{ id: string }>(id ? `documents/${id}` : 'documents', id ? 'PUT' : 'POST', payload());
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    setMsg({ kind: 'ok', text: 'บันทึกแล้ว' });
    setSaved(JSON.stringify(payload()));
    if (!id) { setId(r.data.id); router.replace(`/sales/quotes/${r.data.id}`); } else router.refresh();
    return r.data.id;
  }
  async function approve() {
    const docId = id && saved === JSON.stringify(payload()) ? id : await save();
    if (!docId) return;
    const r = await call<{ docNo: string }>(`documents/${docId}/approve`, 'POST');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `อนุมัติแล้ว ${r.data.docNo}` });
    router.refresh();
  }
  async function convert(to: 'SO' | 'IV' | 'DP') {
    if (!d) return;
    if (to === 'DP') {
      // ใบแจ้งหนี้มัดจำ 30% ของมูลค่าก่อนภาษี (VAT คิดที่ server) — ScreenQuote.dc.html "มัดจำ 30% เมื่อสั่ง" · อ้างใบเสนอราคา (ref_document_id)
      // TODO(backend): convert {to:'DP'} คัดลอกทุกบรรทัดเต็มยอด — ยังไม่รองรับมัดจำเป็น % จึงสร้างร่าง DP ตรง (ประวัติ QO ไม่มี "แปลงเอกสาร")
      const base = percentOf(subMoney(d.subtotal, d.discount), '30');
      const dp = await call<{ id: string }>('documents', 'POST', {
        docType: 'DP', contactId: d.contact_id, issueDate: today, priceInclVat: false, ruleCode: 'Deposit[DP]', reference: d.doc_no, refDocumentId: d.id, receiveAccount: '1100100',
        lines: [{ lineType: 'item', description: `เงินมัดจำ ${d.doc_no ?? ''} 30%`, qty: '1', unitPrice: base, vat: true }],
      });
      if (!dp.ok) { setMsg({ kind: 'err', text: dp.error }); return; }
      router.push(`/sales/deposits/${dp.data.id}`);
      return;
    }
    const r = await call<{ id: string }>(`documents/${d.id}/convert`, 'POST', { to });
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    router.push(to === 'IV' ? `/sales/invoices/${r.data.id}` : `/sales/quotes/${r.data.id}`);
  }
  async function share() {
    if (!id) return;
    const r = await call<{ token: string }>(`documents/${id}/share`, 'POST');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    const url = `${window.location.origin}/d/${r.data.token}`;
    setMsg({ kind: 'ok', text: `ลิงก์สำหรับลูกค้า: ${url}` });
    window.open(url, '_blank', 'noopener');
  }

  const type = d?.doc_type === 'SO' ? 'SO' : docType;
  const typeName = type === 'SO' ? 'ใบสั่งขาย' : 'ใบเสนอราคา';
  const no = d ? docNo(d) : 'ใหม่';
  // TODO(Wei)/backend: สถานะ "ลูกค้ายอมรับแล้ว" + เวลาที่กดยอมรับผ่านลิงก์ (ScreenQuote.dc.html) — backend ยังไม่มีการยอมรับใบเสนอราคา · ใช้สถานะอนุมัติแทน
  const tag = d ? statusTag({ ...d, outstanding: null }, today) : { kind: 'info' as const, text: 'ร่าง' };
  const deposit = term === TERMS[0] && totals ? percentOf(totals.grandTotal, '30') : null;
  const step = (s: string) => (s === type ? <strong style={css('color: #161616')}>{s}</strong> : s);

  return (
    <>
      <DocHeader crumb={<>ขาย / <a href="/sales/quotes" style={css('text-decoration: none')}>{typeName}</a> / {no}</>} tag={tag} />
      <div style={css(F.page)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css(F.h1)}>{typeName} {no}</h1><span style={css(F.hint)}>{[validUntil ? `ยืนราคาถึง ${thaiDate(validUntil)}` : null, detail?.ref ? `แปลงจาก ${docNo(detail.ref)}` : null].filter(Boolean).join(' · ')}</span></div>
          <div style={css('display: flex; font-size: 14px; color: #525252; gap: 8px; align-items: center')}>วงจร: {step('QO')} → {step('SO')} → IV → RV</div>
        </div>
        <section style={css(F.grid)}>
          <datalist id="qo-contacts">{contacts.map((c) => <option key={c.id} value={label(c)} />)}</datalist>
          <label style={css(F.label2)}>ลูกค้า<input list="qo-contacts" readOnly={!editable} value={contactText} onChange={(e) => setContactText(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px')} /></label>
          <label style={css(F.label)}>วันที่<input readOnly={!editable} value={date} onChange={(e) => setDate(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616; font-variant-numeric: tabular-nums')} /></label>
          <label style={css(F.label)}>ยืนราคา (วัน)<input readOnly={!editable} value={days} onChange={(e) => setDays(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616; font-variant-numeric: tabular-nums')} /></label>
          <label style={css(F.label)}>พนักงานขาย<select style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616')}><option>—</option></select></label>
          <label style={css(F.label)}>โครงการ (มิติ)<select style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616')}><option>—</option></select></label>
          <label style={css(F.label)}>เงื่อนไขชำระ<select value={term} onChange={(e) => setTerm(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616')}>{TERMS.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label style={css(F.label)}>ระดับราคา<select style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616')}><option>ราคา 1 (ปกติ)</option></select></label>
        </section>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 860px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; width: 32px; padding: 0 12px; font-weight: 400')}>#</th><th style={css(F.th)}>รายการ</th><th style={css(F.thNum)}>จำนวน</th><th style={css(F.thNum)}>ราคา/หน่วย</th><th style={css(F.thNum)}>ส่วนลด</th><th style={css(F.thNum)}>ต้นทุนประมาณ</th><th style={css(F.thNum)}>กำไรขั้นต้น</th><th style={css(F.thNum)}>จำนวนเงิน</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const k = idx[i] ?? -1;
                const amount = k >= 0 && totals ? totals.lines[k]?.gross ?? '' : '';
                const free = /^0*(\.0*)?$/u.test(r.price.replace(/,/gu, '')) && r.price !== '';
                const desc = free ? r.item.replace(/\s*ของแถม$/u, '') : r.item;
                return (
                  <tr key={i} style={css('border-top: 1px solid #e0e0e0')} onKeyDown={(e) => { if (editable && e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); setRows([...rows, blankLine()]); } }}>
                    <td style={css('height: 40px; padding: 0 12px; color: #525252')}>{i + 1}</td>
                    <td style={css(F.td)}>{editable ? <input aria-label={`รายการ บรรทัด ${i + 1}`} value={r.item} onChange={(e) => set(i, 'item', e.target.value)} style={css(F.cell)} /> : desc}
                      {free && !editable && <> <span style={css('font-size: 12px; padding: 1px 6px; border-radius: 4px; background: #e0e0e0')}>ของแถม</span></>}</td>
                    <td style={css(F.num)}>{editable ? <input aria-label={`จำนวน บรรทัด ${i + 1}`} value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} style={css(`${F.cellNum}; width: 72px`)} /> : r.qty}</td>
                    <td style={css(F.num)}>{editable ? <input aria-label={`ราคา/หน่วย บรรทัด ${i + 1}`} value={r.price} onChange={(e) => set(i, 'price', e.target.value)} style={css(`${F.cellNum}; width: 110px`)} /> : r.price}</td>
                    <td style={css(F.num)}>{editable ? <input aria-label={`ส่วนลด บรรทัด ${i + 1}`} placeholder="10% + 5%" value={r.disc} onChange={(e) => set(i, 'disc', e.target.value)} style={css(`${F.cellNum}; width: 110px`)} /> : (r.disc.includes('%') ? r.disc : money(r.disc, { blankZero: true }))}</td>
                    {/* TODO(backend): ต้นทุนประมาณ/กำไรขั้นต้น/"ต่ำกว่าทุน" ต้องมี est_cost ของสินค้า (fixtures products S-0001 est_cost) — ยังไม่มี API สินค้า */}
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; color: #525252')}>—</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; color: #525252')}>—</td>
                    <td style={css(F.num)}>{money(amount)}</td>
                  </tr>
                );
              })}
              {editable && (
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px; color: #525252')}>{rows.length + 1}</td>
                  <td style={css(F.td)} colSpan={7}><Button kind="ghost" size={32} onClick={() => setRows([...rows, blankLine()])}>+ เพิ่มบรรทัด (Enter)</Button></td></tr>
              )}
            </tbody>
            <tfoot><tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}><td colSpan={5} style={css('height: 40px; padding: 0 12px')}>รวมก่อนภาษี · กำไรขั้นต้นรวม —</td><td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 400; color: #525252')}>—</td><td></td><td style={css(F.num)}>{money(totals?.subtotal)}</td></tr></tfoot>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
            <strong>แปลงเอกสาร</strong>
            <span style={css('color: #525252')}>ยอมรับแล้ว แปลงได้ทั้งใบหรือบางบรรทัด ระบบติดตามยอดค้างแปลง</span>
            <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
              {/* TODO(Wei): ไม่มีแบบร่างของใบสั่งขาย (SO) — ปุ่มแปลง SO → IV ใช้ชื่อแบบเดียวกัน */}
              {type === 'QO'
                ? <Button size={36} disabled={!approved} onClick={() => void convert('SO')}>→ ใบสั่งขาย (SO)</Button>
                : <Button size={36} disabled={!approved} onClick={() => void convert('IV')}>→ ใบแจ้งหนี้ (IV)</Button>}
              <Button size={36} disabled={!approved} onClick={() => void convert('DP')}>→ ใบแจ้งหนี้มัดจำ 30%</Button>
              {/* TODO(backend): แปลงบางบรรทัด / ยกเลิกยอดค้างแปลง ยังไม่มี API (convertDocument แปลงทั้งใบ) */}
              <Button kind="ghost" size={36} disabled={!approved}>ยกเลิกยอดค้าง…</Button>
            </div>
          </section>
          <table style={css('flex: 0 1 340px; border-collapse: collapse; font-size: 15px')}><tbody>
            <tr><td style={css('height: 32px')}>มูลค่าก่อนภาษี</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(totals?.net)}</td></tr>
            <tr><td style={css('height: 32px')}>ภาษีมูลค่าเพิ่ม 7%</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(totals?.vat)}</td></tr>
            <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css('height: 40px; font-weight: 600; font-size: 16px')}>ยอดรวม</td><td style={css('text-align: right; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums')}>{money(totals?.grandTotal)}</td></tr>
            {deposit && <tr><td style={css('height: 28px; font-size: 13px; color: #525252')}>มัดจำ 30% เมื่อสั่ง</td><td style={css('text-align: right; font-size: 13px; color: #525252; font-variant-numeric: tabular-nums')}>{money(deposit)}</td></tr>}
          </tbody></table>
        </div>
        {err && <Msg msg={{ kind: 'err', text: err }} />}
        <Msg msg={msg} />
      </div>
      <div style={css(F.sticky)}>
        <span style={css('font-size: 13px; color: #525252')}>ใบเสนอราคาไม่ลงบัญชี · ลิงก์ลูกค้า: ดู/ยอมรับ/ดาวน์โหลด PDF</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {id && d ? <ButtonLink href={printHref({ id, doc_type: type })}>ดูตัวอย่างพิมพ์</ButtonLink> : <Button disabled>ดูตัวอย่างพิมพ์</Button>}
          <Button disabled={!approved} onClick={() => void share()}>ส่งลิงก์ให้ลูกค้า</Button>
          <Button disabled={!editable} onClick={() => void save()}>บันทึก</Button>
          {/* TODO(Wei): แบบร่างไม่มีปุ่มอนุมัติใบเสนอราคา (ออกเลขที่ตอนอนุมัติ · technical-plan-M4 §3) → ปุ่มหลักเป็น "อนุมัติ" จนกว่าจะอนุมัติ */}
          {approved
            ? <Button kind="primary" onClick={() => void convert(type === 'QO' ? 'SO' : 'IV')}>{type === 'QO' ? 'แปลงเป็นใบสั่งขาย' : 'แปลงเป็นใบแจ้งหนี้'}</Button>
            : <Button kind="primary" disabled={!editable} onClick={() => void approve()}>อนุมัติ</Button>}
        </div>
      </div>
    </>
  );
}
