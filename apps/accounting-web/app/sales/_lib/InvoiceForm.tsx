'use client';
// S3 ฟอร์มใบกำกับภาษี — design/project/ScreenInvoice.dc.html (แท็บ เอกสาร / สำหรับนักบัญชี / ประวัติ)
// ใช้กับใบแจ้งหนี้มัดจำ (DP) ด้วย — TODO(Wei): ไม่มีแบบร่างฟอร์ม DP (ScreenDeposit.dc.html มีแต่รายการ + ตัดมัดจำ) → ใช้รูปแบบ ScreenInvoice
import { Button, ButtonLink, css, money, parseThaiDate, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './client.ts';
import { addDays, bangkok, branchText, type Account, type Contact, docNo, type DocDetail, EVENT_TEXT, printHref, type Rule, statusTag, whenText } from './doc.ts';
import { JournalPreview } from './JournalPreview';
import { blankLine, linePayload, type LineRow, rowFromLine, useTotals, validRow } from './lines.ts';
import { fromCents, lineDiscount, parseDec, toCents } from './num.ts';
import { DocHeader, F, Msg } from './ui';

type Mode = 'IV' | 'DP';
type Tab = 'doc' | 'acct' | 'history';

export function InvoiceForm({ mode, detail, contacts, accounts, rules, names, today, presetContact }: {
  mode: Mode; detail: DocDetail | null; contacts: Contact[]; accounts: Account[]; rules: Rule[]; names: Record<string, string>; today: string; presetContact?: string;
}) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const contactLabel = (c: Contact) => `${c.code} · ${c.name}`;
  const initialContact = detail?.contact ?? contacts.find((c) => c.id === presetContact) ?? null;

  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [tab, setTab] = useState<Tab>('doc');
  const [contactText, setContactText] = useState(initialContact ? `${contactLabel(initialContact)}${detail?.contact ? ` (${branchText(detail.contact.branch_code)})` : ''}` : '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [due, setDue] = useState(d?.due_date ? thaiDate(d.due_date) : '');
  const [address, setAddress] = useState(d?.address ?? '');
  const [incl, setIncl] = useState(d?.price_incl_vat ?? false);
  const [taxMode, setTaxMode] = useState<'on_payment' | 'immediate'>(d?.tax_mode ?? 'on_payment');
  const docRules = rules.filter((r) => r.docType === mode);
  const [rule, setRule] = useState(d?.rule_code ?? (mode === 'DP' ? 'Deposit[DP]' : 'Service[IV]'));
  const [receive, setReceive] = useState(d?.receive_account ?? '1100100');
  const [notes, setNotes] = useState(d?.notes ?? '');
  const [billDisc, setBillDisc] = useState(d && d.bill_discount !== '0.00' ? d.bill_discount : '');
  const [rows, setRows] = useState<LineRow[]>(detail?.lines.filter((l) => l.line_type === 'item').map(rowFromLine) ?? [blankLine()]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(d ? bangkok(d.updated_at).time : null);
  const [dirty, setDirty] = useState(false);
  const busy = useRef(false);

  const { totals, idx, err } = useTotals(rows, incl, billDisc);
  const contact = contacts.find((c) => contactText.startsWith(`${c.code} `) || contactText === c.code) ?? null;
  // เครดิตของเอกสาร: ตามเอกสาร ถ้าไม่มีใช้ของลูกค้าในทะเบียน
  const creditDays = d?.credit_days ?? contact?.credit_days ?? null;
  const deposits = (detail?.settlementsIn ?? []).filter((s) => s.doc_type === 'DP').map((s) => ({ documentId: s.id, amount: s.applied }));
  const depositTotal = deposits.reduce((s, x) => s + toCents(x.amount), 0n);
  const revenue = accounts.filter((a) => a.type === 'revenue' && a.active);
  const cashAccounts = accounts.filter((a) => /^1(0|100|150)/u.test(a.code) && a.active && !a.is_control);
  const touch = <T,>(f: (v: T) => void) => (v: T) => { f(v); setDirty(true); };

  const payload = () => ({
    docType: mode, contactId: contact?.id ?? '', issueDate: parseThaiDate(date) ?? '', dueDate: due ? parseThaiDate(due) : null, priceInclVat: incl,
    billDiscount: billDisc ? (lineDiscount(billDisc, '1', '0') ?? '0.00') : '0.00', ...(mode === 'IV' ? { taxMode } : {}), ruleCode: rule,
    address: address || null, notes: notes || null, reference: d?.reference ?? null, refDocumentId: d?.ref_document_id ?? null, creditDays,
    receiveAccount: mode === 'DP' ? receive : (d?.receive_account ?? null), deposits, lines: rows.filter(validRow).map(linePayload),
  });

  const save = useCallback(async (quiet = false): Promise<string | null> => {
    if (!editable || busy.current) return id;
    if (!contact) { setMsg({ kind: 'err', text: 'เลือกลูกค้าจากรายการ' }); return null; }
    if (!parseThaiDate(date) || (due && !parseThaiDate(due))) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    if (rows.some((r) => r.item.trim() && !validRow(r))) { setMsg({ kind: 'err', text: 'กรอกจำนวน ราคา/หน่วย และส่วนลดของทุกบรรทัดให้ถูกต้อง' }); return null; }
    busy.current = true;
    const r = await call<{ id: string }>(id ? `documents/${id}` : 'documents', id ? 'PUT' : 'POST', payload());
    busy.current = false;
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    setDirty(false);
    setSavedAt(bangkok(new Date().toISOString()).time);
    if (!quiet) setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    if (!id) { setId(r.data.id); router.replace(`${mode === 'DP' ? '/sales/deposits' : '/sales/invoices'}/${r.data.id}`); }
    return r.data.id;
  }, [editable, id, contact, date, due, rows, incl, billDisc, taxMode, rule, receive, address, notes]);

  // บันทึกร่างอัตโนมัติ (ScreenInvoice.dc.html "บันทึกร่างอัตโนมัติ 09:41") — เฉพาะเอกสารที่บันทึกแล้ว
  useEffect(() => {
    if (!dirty || !id || !editable) return;
    const t = setTimeout(() => void save(true), 5000);
    return () => clearTimeout(t);
  }, [dirty, id, editable, save]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  async function act(path: string, body?: unknown, ok?: (data: Record<string, string>) => string) {
    const docId = editable ? (dirty || !id ? await save(true) : id) : id;
    if (!docId) return;
    const r = await call<Record<string, string>>(`documents/${docId}/${path}`, 'POST', body);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: ok ? ok(r.data) : 'บันทึกแล้ว' });
    router.refresh();
  }
  const approve = () => act('approve', undefined, (x) => `อนุมัติแล้ว ${x.docNo}${x.journalNo ? ` · ลงบัญชี ${x.journalNo}` : ''}`);
  const submit = () => act('submit', undefined, () => 'ส่งขออนุมัติแล้ว');
  function reject() {
    // TODO(Wei): แบบร่างไม่มีหน้าต่างกรอกเหตุผลปฏิเสธ (ScreenInvoice.dc.html) — ใช้ prompt ของเบราว์เซอร์
    const reason = window.prompt('เหตุผลที่ปฏิเสธ');
    if (reason !== null) void act('reject', { reason }, () => 'ปฏิเสธแล้ว — เอกสารกลับเป็นร่าง');
  }
  async function share() {
    if (!id) return;
    const r = await call<{ token: string }>(`documents/${id}/share`, 'POST');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    const url = `${window.location.origin}/d/${r.data.token}`;
    setMsg({ kind: 'ok', text: `ลิงก์สำหรับลูกค้า: ${url}` });
    window.open(url, '_blank', 'noopener');
  }

  const set = (i: number, k: keyof LineRow, v: string | boolean) => { setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };
  const status = d ? statusTag({ ...d, outstanding: detail?.outstanding ?? null }, today) : { kind: 'info' as const, text: 'ร่าง' };
  const title = mode === 'DP' ? 'ใบแจ้งหนี้มัดจำ' : taxMode === 'immediate' ? 'ใบแจ้งหนี้/ใบกำกับภาษี' : 'ใบแจ้งหนี้';
  const no = d ? docNo(d) : 'ใหม่';
  const listHref = mode === 'DP' ? '/sales/deposits' : '/sales/invoices';

  // บรรทัดย่อยใต้หัวเรื่อง: แปลงจาก · สร้างโดย · ส่งขออนุมัติ
  const ev = detail?.events ?? [];
  const created = ev.find((e) => e.event === 'created');
  const submitted = [...ev].reverse().find((e) => e.event === 'submitted');
  const posted = [...ev].reverse().find((e) => e.event === 'posted' || e.event === 'approved');
  // TODO(backend): ชื่อผู้ทำรายการ — document_event.actor เป็น user id ยังไม่มีชื่อจาก Innovera ID
  const subParts = [
    detail?.ref ? `แปลงจาก ${docNo(detail.ref)}` : null,
    created ? `สร้างโดย — ${bangkok(created.at).date.slice(8, 10)}/${bangkok(created.at).date.slice(5, 7)}` : null,
    submitted && d?.status === 'pending_approval' ? `ส่งขออนุมัติ${/^\d/u.test(whenText(submitted.at, today)) ? ' ' : ''}${whenText(submitted.at, today)}` : null,
    posted && detail?.journal[0] ? `ลงบัญชี ${detail.journal[0].journal_no}` : null,
  ].filter(Boolean);

  const shown = totals && !(depositTotal > 0n && !dirty && d)
    ? { subtotal: totals.subtotal, discount: totals.discount, vat: totals.vat, grand: totals.grandTotal, text: totals.amountText }
    : d ? { subtotal: d.subtotal, discount: d.discount, vat: d.vat, grand: d.grand_total, text: detail!.amountText } : null;

  const journal = (
    <JournalPreview title="ตัวอย่างการลงบัญชี" note={detail?.journal.length ? `สูตร ${rule} · ${detail.journal[0]!.journal_no}` : `สูตร ${rule} · ลงจริงเมื่ออนุมัติ`}
      source={{ rule, docType: mode, totals, lineAccounts: rows.filter(validRow).map((r) => r.account.trim().slice(0, 7) || null), deposit: fromCents(depositTotal), receiveAccount: mode === 'DP' ? receive : null,
        ...(depositTotal > 0n && d && !dirty ? { grandTotal: d.grand_total } : {}) }}
      posted={detail?.journal.length ? detail.journal : null} names={names} />
  );
  const IN = (extra = '') => css(`${F.input}${extra}`);

  return (
    <>
      <DocHeader crumb={<><a href={listHref} style={css('text-decoration: none')}>{mode === 'DP' ? 'เงินมัดจำ' : 'ใบกำกับภาษี'}</a> / {no}</>} tag={status} />
      <div style={css(F.page)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css(F.h1)}>{title} {no}</h1><span style={css(F.hint)}>{subParts.join(' · ')}</span></div>
          <div role="tablist" aria-label="มุมมอง" style={css('display: flex; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
            <button role="tab" aria-selected={tab === 'doc'} onClick={() => setTab('doc')} style={css(tab === 'doc' ? F.tabOn : F.tabOff)}>เอกสาร</button>
            <button role="tab" aria-selected={tab === 'acct'} onClick={() => setTab('acct')} style={css(tab === 'acct' ? F.tabOn : F.tabOff)}>สำหรับนักบัญชี</button>
            <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} style={css(tab === 'history' ? F.tabOn : F.tabOff)}>ประวัติ {ev.length}</button>
          </div>
        </div>

        {tab === 'doc' && <>
          <section style={css(F.grid)}>
            <datalist id="iv-contacts">{contacts.map((c) => <option key={c.id} value={contactLabel(c)} />)}</datalist>
            <label style={css(F.label2)}>ลูกค้า<input list="iv-contacts" readOnly={!editable} value={contactText} onChange={(e) => touch(setContactText)(e.target.value)} style={IN()} />
              {/* วงเงินคงเหลือ = วงเงิน − ลูกหนี้คงค้าง (GET /v1/contacts) · TODO(Wei) T4: fixtures C0012 credit_limit_remaining 452,920 ไม่ตรงกับสูตรนี้ (PROGRESS T4) */}
              <span style={css(F.hint)}>เลขผู้เสียภาษี {(detail?.contact?.id === contact?.id ? detail?.contact?.tax_id : contact?.tax_id) ?? '—'} · เครดิต {creditDays ?? '—'} วัน · วงเงินคงเหลือ {contact?.credit_remaining ? money(contact.credit_remaining, { paren: true }) : '—'}</span></label>
            <label style={css(F.label)}>วันที่เอกสาร<input readOnly={!editable} value={date} onChange={(e) => touch(setDate)(e.target.value)} style={css(F.inputNum)} /></label>
            <label style={css(F.label)}>ครบกำหนด<input readOnly={!editable} value={due} placeholder={creditDays && parseThaiDate(date) ? thaiDate(addDays(parseThaiDate(date)!, creditDays)) : undefined} onChange={(e) => touch(setDue)(e.target.value)} style={css(F.inputNum)} /></label>
            <label style={css(F.label2)}>ที่อยู่บนเอกสาร<input readOnly={!editable} value={address} placeholder={editable ? '[ที่อยู่ลูกค้า] — บันทึกลงเอกสาร แก้ทะเบียนภายหลังไม่กระทบ' : undefined} onChange={(e) => touch(setAddress)(e.target.value)} style={IN()} /></label>
            <label style={css(F.label)}>ราคา<select disabled={!editable} value={incl ? '1' : '0'} onChange={(e) => touch(setIncl)(e.target.value === '1')} style={IN()}><option value="0">ไม่รวม VAT</option><option value="1">รวม VAT</option></select></label>
            {mode === 'IV'
              ? <label style={css(F.label2)}>เอกสารที่ออก<select disabled={!editable} value={taxMode} onChange={(e) => touch(setTaxMode)(e.target.value as 'on_payment' | 'immediate')} style={IN()}><option value="on_payment">ใบแจ้งหนี้ — บริการ: ออกใบกำกับภาษีเมื่อรับชำระ (ม.78/1)</option><option value="immediate">ใบแจ้งหนี้/ใบกำกับภาษี — ออกใบกำกับทันที (จุดภาษีเกิดวันนี้)</option></select><span style={css(F.hint)}>ตั้งค่าบริษัท: จุดภาษีของบริการ = เมื่อรับชำระ</span></label>
              // TODO(Wei): DP ไม่มีแบบร่าง — backend ลงบัญชี DP ตอนอนุมัติเป็น "รับเงินมัดจำ" ต้องมีบัญชีที่รับเงิน แต่ ScreenDeposit.dc.html ① บอกว่าแจ้งหนี้มัดจำไม่ลงบัญชี
              : <label style={css(F.label2)}>บัญชีที่รับเงิน<select disabled={!editable} value={receive} onChange={(e) => touch(setReceive)(e.target.value)} style={IN()}>{cashAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></label>}
            <label style={css(F.label)}>สูตรลงบัญชี<select disabled={!editable} value={rule} onChange={(e) => touch(setRule)(e.target.value)} style={IN()}>{docRules.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}</select></label>
          </section>

          <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
            <datalist id="iv-revenue">{revenue.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
            <table style={css('width: 100%; min-width: 820px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; width: 32px; padding: 0 12px; font-weight: 400')}>#</th><th style={css(F.th)}>สินค้า / บริการ</th><th style={css(F.th)}>บัญชีรายได้</th><th style={css(F.thNum)}>จำนวน</th><th style={css(F.thNum)}>ราคา/หน่วย</th><th style={css(F.thNum)}>ส่วนลด</th><th style={css(F.th)}>ภาษี</th><th style={css(F.thNum)}>จำนวนเงิน</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const k = idx[i] ?? -1;
                  const amount = k >= 0 && totals ? totals.lines[k]?.gross ?? '' : '';
                  return (
                    <tr key={i} style={css('border-top: 1px solid #e0e0e0')} onKeyDown={(e) => { if (editable && e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); setRows([...rows, blankLine()]); } }}>
                      <td style={css('height: 40px; padding: 0 12px; color: #525252')}>{i + 1}</td>
                      <td style={css(F.td)}>{editable ? <input aria-label={`สินค้า / บริการ บรรทัด ${i + 1}`} value={r.item} onChange={(e) => set(i, 'item', e.target.value)} style={css(F.cell)} /> : r.item}</td>
                      <td style={css('padding: 0 12px; color: #525252')}>{editable ? <input aria-label={`บัญชีรายได้ บรรทัด ${i + 1}`} list="iv-revenue" value={r.account} onChange={(e) => set(i, 'account', e.target.value)} style={css(`${F.cell}; width: 96px`)} /> : r.account}</td>
                      <td style={css(F.num)}>{editable ? <input aria-label={`จำนวน บรรทัด ${i + 1}`} value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} style={css(`${F.cellNum}; width: 72px`)} /> : r.qty}</td>
                      <td style={css(F.num)}>{editable ? <input aria-label={`ราคา/หน่วย บรรทัด ${i + 1}`} value={r.price} onChange={(e) => set(i, 'price', e.target.value)} onBlur={() => { if (parseDec(r.price, 4) !== null && !r.price.includes('.')) set(i, 'price', `${r.price.trim()}.00`); }} style={css(`${F.cellNum}; width: 110px`)} /> : r.price}</td>
                      <td style={css(F.num)}>{editable ? <input aria-label={`ส่วนลด บรรทัด ${i + 1}`} value={r.disc} onChange={(e) => set(i, 'disc', e.target.value)} style={css(`${F.cellNum}; width: 96px`)} /> : money(r.disc, { blankZero: true })}</td>
                      {/* TODO(Wei): ภาษีบรรทัด — แบบร่างแสดงแค่ "VAT 7%" · เพิ่ม "ไม่มี VAT" สำหรับค่าขนส่ง/ค่าเช่า (ม.81) */}
                      <td style={css(F.td)}>{editable ? <select aria-label={`ภาษี บรรทัด ${i + 1}`} value={r.vat ? '1' : '0'} onChange={(e) => set(i, 'vat', e.target.value === '1')} style={css(`${F.cell}; width: 96px`)}><option value="1">VAT 7%</option><option value="0">ไม่มี VAT</option></select> : r.vat ? 'VAT 7%' : 'ไม่มี VAT'}</td>
                      <td style={css(F.num)}>{money(amount)}</td>
                    </tr>
                  );
                })}
                {editable && (
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px; color: #525252')}>{rows.length + 1}</td>
                    <td style={css(F.td)} colSpan={7}><Button kind="ghost" size={32} onClick={() => setRows([...rows, blankLine()])}>+ เพิ่มบรรทัด (Enter)</Button></td></tr>
                )}
              </tbody>
            </table>
          </section>

          <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
            <label style={css('flex: 1 1 360px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>หมายเหตุบนเอกสาร<textarea readOnly={!editable} value={notes} placeholder={editable ? 'กรุณาชำระภายในกำหนด · โอนเข้าบัญชีที่ระบุท้ายเอกสาร' : undefined} onChange={(e) => touch(setNotes)(e.target.value)} style={css('height: 88px; padding: 12px 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616; resize: vertical')} /></label>
            <table style={css('flex: 0 1 360px; border-collapse: collapse; font-size: 15px')}>
              <tbody>
                <tr><td style={css('height: 32px; padding: 0 16px 0 0')}>มูลค่าก่อนภาษี</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(shown?.subtotal)}</td></tr>
                <tr><td style={css('height: 32px; padding: 0 16px 0 0')}>ส่วนลดท้ายบิล</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{editable
                  ? <input aria-label="ส่วนลดท้ายบิล" value={billDisc} onChange={(e) => touch(setBillDisc)(e.target.value)} style={css('width: 120px; height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; font-variant-numeric: tabular-nums')} />
                  : money(shown?.discount, { blankZero: true })}</td></tr>
                {/* TODO(Wei): แถว "หักเงินมัดจำ" ไม่มีใน ScreenInvoice.dc.html — แสดงเมื่อใบนี้ตัดมัดจำ (ScreenDeposit.dc.html) */}
                {depositTotal > 0n && <tr><td style={css('height: 32px; padding: 0 16px 0 0')}>หัก เงินมัดจำ</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(fromCents(-depositTotal), { paren: true })}</td></tr>}
                <tr><td style={css('height: 32px; padding: 0 16px 0 0')}>ภาษีมูลค่าเพิ่ม 7%</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(shown?.vat)}</td></tr>
                <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css('height: 40px; padding: 0 16px 0 0; font-weight: 600; font-size: 16px')}>ยอดรวมทั้งสิ้น</td><td style={css('text-align: right; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums')}>{money(shown?.grand)}</td></tr>
                <tr><td colSpan={2} style={css('font-size: 13px; color: #525252; text-align: right')}>{shown ? `(${shown.text})` : ''}</td></tr>
              </tbody>
            </table>
          </div>
          {err && <Msg msg={{ kind: 'err', text: err }} />}
          {journal}
        </>}

        {/* TODO(Wei): แท็บ "สำหรับนักบัญชี" ไม่มีเนื้อหาในแบบร่าง (ScreenInvoice.dc.html) — แสดงสูตร/จุดภาษี/รายการบัญชี */}
        {tab === 'acct' && <>
          <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px; font-size: 14px')}>
            <div style={css(F.label)}>สูตรลงบัญชี<span style={css('font-size: 15px; color: #161616')}>{rule}</span></div>
            {mode === 'IV' && <div style={css(F.label)}>เอกสารที่ออก<span style={css('font-size: 15px; color: #161616')}>{taxMode === 'on_payment' ? 'ออกใบกำกับภาษีเมื่อรับชำระ (ม.78/1)' : 'ออกใบกำกับทันที'}</span></div>}
            <div style={css(F.label)}>รายการบัญชี<span style={css('font-size: 15px; color: #161616')}>{detail?.journal[0] ? <a href={`/gl/journal?no=${encodeURIComponent(detail.journal[0].journal_no)}`}>{detail.journal[0].journal_no}</a> : '—'}</span></div>
            <div style={css(F.label)}>ยอดค้างชำระ<span style={css('font-size: 15px; color: #161616; font-variant-numeric: tabular-nums')}>{detail?.outstanding ? money(detail.outstanding) : '—'}</span></div>
          </section>
          {journal}
          {!!detail?.settlementsIn.length && (
            <section style={css('border: 1px solid #e0e0e0; overflow-x: auto; max-width: 720px')}>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เลขที่</th><th style={css(F.th)}>วันที่</th><th style={css(F.thNum)}>ยอดตัด</th><th style={css(F.thNum)}>ภาษีถูกหัก ณ ที่จ่าย</th><th style={css(F.thNum)}>ภาษีขายที่โอน</th></tr></thead>
                <tbody>{detail.settlementsIn.map((s) => (
                  <tr key={s.id} style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px')}>{s.doc_no ?? '—'}{s.voided ? ' (ยกเลิก)' : ''}</td><td style={css(F.td)}>{thaiDate(s.issue_date)}</td><td style={css(F.num)}>{money(s.applied)}</td><td style={css(F.num)}>{money(s.wht, { blankZero: true })}</td><td style={css(F.num)}>{money(s.vat_due, { blankZero: true })}</td></tr>
                ))}</tbody>
              </table>
            </section>
          )}
        </>}

        {tab === 'history' && (
          <section style={css('border: 1px solid #e0e0e0; overflow-x: auto; max-width: 720px')}>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เวลา</th><th style={css(F.th)}>รายการ</th><th style={css(F.th)}>รายละเอียด</th></tr></thead>
              <tbody>{ev.map((e, i) => {
                const t = bangkok(e.at);
                const det = e.detail as { reason?: string; docNo?: string; journalNo?: string; reversal?: string };
                return (
                  <tr key={i} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{thaiDate(t.date)} {t.time}</td>
                    <td style={css(F.td)}>{EVENT_TEXT[e.event] ?? e.event}</td>
                    <td style={css('padding: 0 12px; color: #525252')}>{[det.docNo, det.journalNo, det.reversal, det.reason].filter(Boolean).join(' · ')}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </section>
        )}
        <Msg msg={msg} />
      </div>

      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}>
        <span style={css('font-size: 13px; color: #525252')}>{editable ? `บันทึกร่างอัตโนมัติ ${savedAt ?? '—'} · Ctrl/⌘+S บันทึก` : detail?.journal[0] ? `ลงบัญชีแล้ว ${detail.journal[0].journal_no}` : ''}</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {d?.status === 'pending_approval' && <Button kind="danger" onClick={reject}>ปฏิเสธ</Button>}
          {/* TODO(Wei): ปุ่มของเอกสารที่ลงบัญชีแล้ว ไม่มีในแบบร่าง ScreenInvoice.dc.html (มีแต่สถานะรออนุมัติ) — ใช้ชื่อปุ่มจาก ScreenDocEdit/ScreenDocVoid/ScreenQuote */}
          {d?.status === 'posted' && <ButtonLink kind="danger" href={`/finance/docs/${d.id}/void`}>ยกเลิกเอกสาร</ButtonLink>}
          {d?.status === 'posted' && <ButtonLink href={`/finance/docs/${d.id}/edit`}>แก้ไข</ButtonLink>}
          {id && d ? <ButtonLink href={printHref({ id, doc_type: mode })}>ดูตัวอย่างพิมพ์</ButtonLink> : <Button disabled>ดูตัวอย่างพิมพ์</Button>}
          {d && (d.status === 'posted' || d.status === 'approved') && <Button onClick={() => void share()}>ส่งลิงก์ให้ลูกค้า</Button>}
          {editable && <Button onClick={() => void save()}>บันทึกร่าง</Button>}
          {editable && d?.status !== 'pending_approval' && <Button onClick={() => void submit()}>ส่งขออนุมัติ</Button>}
          {editable && <Button kind="primary" onClick={() => void approve()}>อนุมัติและลงบัญชี</Button>}
          {d?.status === 'posted' && mode === 'IV' && detail?.outstanding && toCents(detail.outstanding) > 0n && d.contact_id &&
            <ButtonLink kind="primary" href={`/finance/receipts/new?contact=${d.contact_id}`}>รับชำระ</ButtonLink>}
        </div>
      </div>
    </>
  );
}
