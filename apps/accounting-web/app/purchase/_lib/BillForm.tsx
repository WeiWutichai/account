'use client';
// P2 บิลซื้อ (AP) — design/project/ScreenPurchaseBill.dc.html (Sidebar active="purchase")
// WHT ต่อบรรทัด = ประเภทเงินได้ "หักตอนจ่าย" (CLAUDE.md: หัก ณ ที่จ่ายรับรู้ตอนจ่ายเงินจริง) · ยอดตั้งหนี้ไม่หัก WHT
import { Button, ButtonLink, css, money, parseThaiDate, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '../../sales/_lib/client.ts';
import { addDays, bangkok } from '../../sales/_lib/doc.ts';
import { fromCents, subMoney, toCents } from '../../sales/_lib/num.ts';
import { F, Msg } from '../../sales/_lib/ui';
import { accCode, blankPLine, netLines, pLinePayload, type PLineRow, pRowFromLine, usePTotals, validP } from './lines.ts';
import { PJournal } from './PJournal';
import {
  type Account, defaultWhtKeys, defaultWhtText, EVENT_TEXT, monthBE, outstandingOf, type Payable, pct, pDocNo, type PContact, type PDetail, pHref, pndOf, personText, pStatusTag, type WhtTypeDef, whtOptionText,
} from './types.ts';
import { docAction, P, PHeader, Pending } from './ui';
import { useVendorRefs } from './vendorRefs.ts';
import { expectedWht, sumWht } from './wht.ts';

type Tab = 'doc' | 'acct' | 'files';
export interface PeriodLite { fiscal_year: number; period_no: number; status: string }
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const LABEL2 = 'grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const CELL = `${'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px'}; padding: 0 8px; box-sizing: border-box`;

export function BillForm({ detail, po, poReceived, vendors, accounts, whtTypes, names, today, payable, periods }: {
  detail: PDetail | null; po: PDetail | null; poReceived: string[]; vendors: PContact[]; accounts: Account[]; whtTypes: Record<string, WhtTypeDef>; names: Record<string, string>;
  today: string; payable: Payable | null; periods: PeriodLite[];
}) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const tms = d?.external_source === 'tms';
  const label = (c: PContact) => `${c.code} · ${c.name}`;
  const src = detail ?? po;
  const initialVendor = src?.contact ?? null;
  // AP จาก PO: เติมบรรทัดที่ยังรับบิลไม่ครบ (บัญชี/VAT/ประเภทเงินได้จาก PO)
  const poRows = (): PLineRow[] => (po?.lines.filter((l) => l.line_type === 'item') ?? []).map((l, i) => ({ l, i }))
    .filter(({ l, i }) => toCents(poReceived[i]) < toCents(l.amount)).map(({ l }) => pRowFromLine(l));

  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [tab, setTab] = useState<Tab>('doc');
  const [vendorText, setVendorText] = useState(initialVendor ? label(initialVendor) : '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [due, setDue] = useState(d?.due_date ? thaiDate(d.due_date) : po?.contact?.credit_days ? thaiDate(addDays(today, po.contact.credit_days)) : '');
  const [vendorRef, setVendorRef] = useState(d?.vendor_ref ?? '');
  // เดือนที่ใช้ภาษีซื้อ = จำนวนเดือนที่เลื่อนจากเดือนตามบิล (0–6)
  const [claimMonth, setClaimMonth] = useState(d?.vat_claim_month ? (Number(d.vat_claim_month.slice(0, 4)) * 12 + Number(d.vat_claim_month.slice(5, 7))) - (Number(d.issue_date.slice(0, 4)) * 12 + Number(d.issue_date.slice(5, 7))) : 0);
  const [rows, setRows] = useState<PLineRow[]>(detail ? detail.lines.filter((l) => l.line_type === 'item').map(pRowFromLine) : po ? poRows() : [blankPLine()]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { totals, idx, err } = usePTotals(rows, d?.price_incl_vat ?? false);
  const vendor = vendors.find((c) => vendorText === label(c) || vendorText.startsWith(`${c.code} `)) ?? null;
  const vInfo = vendor && detail?.contact?.id === vendor.id ? detail.contact : vendor && po?.contact?.id === vendor.id ? po.contact : vendor;
  const refs = useVendorRefs(vendor?.id ?? null);
  const dup = vendorRef.trim() ? (refs ?? []).find((r) => r.id !== id && r.ref.toLowerCase() === vendorRef.trim().toLowerCase()) ?? null : null;
  // ข้อมูลผู้ขายจากทะเบียน (GET /v1/contacts) — เอกสารเดิมใช้ข้อมูลในเอกสาร ถ้าเลือกผู้ขายใหม่ใช้ทะเบียน
  const vReg = vendor ? vendors.find((c) => c.id === vendor.id) ?? null : null;
  const whtDefault = defaultWhtText(vReg, whtTypes);
  /** เลือกผู้ขาย → บรรทัดที่ยังไม่ระบุ WHT ใช้ประเภทเงินได้ตั้งต้นของผู้ขาย */
  function pickVendor(text: string) {
    setVendorText(text);
    const v = vendors.find((c) => text === label(c));
    const k = defaultWhtKeys(v)[0];
    if (k && editable && !tms) setRows((rs) => rs.map((r) => (r.wht ? r : { ...r, wht: k })));
  }
  const expense = accounts.filter((a) => a.type === 'expense' && a.active);
  const iso = parseThaiDate(date);
  const net = netLines(rows, totals, idx);

  // ภาษีหัก ณ ที่จ่าย "ตอนจ่าย": ค้างจ่าย → ตาม backend (whtForBill · หักฐานใบลดหนี้แล้ว) · จ่ายแล้ว → ตามใบสำคัญจ่าย · ร่าง → คาดไว้
  const out = detail ? outstandingOf(detail) : null;
  const paidPV = (detail?.settlementsIn ?? []).filter((s) => s.doc_type === 'PV' && !s.voided);
  const cnr = (detail?.settlementsIn ?? []).filter((s) => s.doc_type === 'CNR' && !s.voided);
  const wht = payable ? payable.wht : expectedWht(net, whtTypes);
  const whtAmount = d?.status === 'posted' && !payable && paidPV.length ? paidPV.reduce((s, x) => s + toCents(x.wht), 0n) : toCents(sumWht(wht));
  const whtText = fromCents(whtAmount);
  const grand = totals?.grandTotal ?? d?.grand_total ?? null;
  const base = payable ? payable.outstanding : d?.status === 'posted' && paidPV.length ? fromCents(paidPV.reduce((s, x) => s + toCents(x.applied) + toCents(x.wht), 0n)) : grand;
  const rateText = [...new Set((wht.length ? wht : []).map((w) => `${pct(w.rate)}%`))].join(' + ');

  const payload = () => ({
    docType: 'AP' as const, contactId: vendor?.id ?? '', issueDate: iso ?? '', dueDate: due ? parseThaiDate(due) : null, vendorRef: vendorRef.trim() || null,
    priceInclVat: d?.price_incl_vat ?? false, refDocumentId: d?.ref_document_id ?? po?.doc.id ?? null, notes: d?.notes ?? null, reference: d?.reference ?? null,
    vatClaimMonth: iso && claimMonth > 0 ? (() => { const t = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + claimMonth; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; })() : null,
    lines: rows.filter(validP).map(pLinePayload),
  });
  async function save(quiet = false): Promise<string | null> {
    if (!editable) return id;
    if (!vendor) { setMsg({ kind: 'err', text: 'เลือกผู้ขายจากรายการ' }); return null; }
    if (!iso || (due && !parseThaiDate(due))) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    if (rows.some((r) => r.item.trim() && !validP(r))) { setMsg({ kind: 'err', text: 'กรอกจำนวน ราคา ของทุกบรรทัดให้ถูกต้อง' }); return null; }
    const r = await call<{ id: string }>(id ? `purchases/${id}` : 'purchases', id ? 'PUT' : 'POST', payload());
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    if (!quiet) setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    if (!id) { setId(r.data.id); router.replace(`/purchase/bills/${r.data.id}`); } else router.refresh();
    return r.data.id;
  }
  async function act(action: 'submit' | 'approve' | 'reject', body?: unknown) {
    const docId = action === 'reject' ? id : await save(true);
    if (!docId) return;
    const r = await docAction<{ docNo?: string; journalNo?: string }>(docId, action, body);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: action === 'approve' ? `อนุมัติแล้ว ${r.data.docNo ?? ''}${r.data.journalNo ? ` · ลงบัญชี ${r.data.journalNo}` : ''}` : action === 'submit' ? 'ส่งขออนุมัติแล้ว' : 'ปฏิเสธแล้ว — เอกสารกลับเป็นร่าง' });
    if (!id) router.replace(`/purchase/bills/${docId}`); else router.refresh();
  }
  function reject() {
    // TODO(Wei): แบบร่างไม่มีหน้าต่างกรอกเหตุผล "ส่งกลับ TMS แก้ไข" (ScreenPurchaseBill.dc.html) — ใช้ prompt ของเบราว์เซอร์
    // TODO(backend): ส่งกลับ TMS = ปฏิเสธในระบบบัญชีเท่านั้น ยังไม่มี webhook แจ้ง TMS (M7)
    const reason = window.prompt('เหตุผล');
    if (reason !== null) void act('reject', { reason });
  }
  const set = (i: number, k: keyof PLineRow, v: string | boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const no = d ? pDocNo(d) : 'ใหม่';
  const tag = d ? pStatusTag(d, today, out, !!dup) : dup ? { kind: 'error' as const, text: 'เลขใบกำกับซ้ำ' } : { kind: 'info' as const, text: 'ร่าง' };
  const created = d ? bangkok(d.created_at) : null;
  const sub = tms && created ? `รับเข้าจาก TMS ${Number(created.date.slice(8, 10))} ${thaiMonth(Number(created.date.slice(5, 7)))} ${created.time} · ยอดแก้ได้ที่ TMS เท่านั้น แก้ได้เฉพาะบัญชี/ภาษี/มิติ`
    : detail?.ref ? `สร้างจากใบสั่งซื้อ ${pDocNo(detail.ref)}` : po ? `สร้างจากใบสั่งซื้อ ${pDocNo(po.doc)}` : '';
  // เดือนที่ใช้ภาษีซื้อ: เดือนตามบิล + เลื่อนได้ไม่เกิน 6 เดือน
  const months = iso ? Array.from({ length: 7 }, (_, k) => { const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)) - 1 + k; return `${String((m % 12) + 1).padStart(2, '0')}/${y + Math.floor(m / 12) + 543}`; }) : [];
  const period = iso ? periods.find((p) => p.fiscal_year === Number(iso.slice(0, 4)) + 543 && p.period_no === Number(iso.slice(5, 7))) : undefined;
  const pnd = vInfo?.tax_id ? pndOf(vInfo.tax_id) : null;
  const amountsLocked = tms || !editable;
  const IN = css(P.input);

  const journal = (
    <PJournal note={`สูตร ${d?.rule_code ?? 'Credit[AP]'}${detail?.journal[0] ? ` · ${detail.journal[0].journal_no}` : ''}`} names={names}
      posted={detail?.journal.length ? detail.journal : null}
      source={{ rule: 'Credit[AP]', docType: 'AP', amounts: totals ? { grand_total: totals.grandTotal, vat: totals.vat } : null, lines: net.map((l) => ({ amount: l.amount, account: l.account })) }} />
  );

  return (
    <>
      <PHeader crumb={<><a href="/purchase/bills" style={css('text-decoration: none')}>บิลซื้อ</a> / {no}{tms ? ` · จาก TMS Settlement ${d?.external_ref ?? ''}` : ''}</>} tag={tag} />
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>บิลซื้อ {no}</h1><span style={css('font-size: 13px; color: #525252')}>{sub}</span></div>
          <div role="tablist" aria-label="มุมมอง" style={css('display: flex; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
            <button role="tab" aria-selected={tab === 'doc'} onClick={() => setTab('doc')} style={css(tab === 'doc' ? F.tabOn : F.tabOff)}>เอกสาร</button>
            <button role="tab" aria-selected={tab === 'acct'} onClick={() => setTab('acct')} style={css(tab === 'acct' ? F.tabOn : F.tabOff)}>สำหรับนักบัญชี</button>
            {/* TODO(backend): ไฟล์แนบเอกสาร (รูปบิล/OCR) ยังไม่มี API */}
            <button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')} style={css(tab === 'files' ? F.tabOn : F.tabOff)}>ไฟล์แนบ 0</button>
          </div>
        </div>

        {tab === 'doc' && <>
          <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
            <datalist id="ap-vendors">{vendors.map((c) => <option key={c.id} value={label(c)} />)}</datalist>
            <label style={css(LABEL2)}>ผู้ขาย<input list="ap-vendors" readOnly={!editable || tms} value={vendorText} onChange={(e) => pickVendor(e.target.value)} style={IN} />
              <span style={css('font-size: 13px; color: #525252')}>{pnd ? [`${personText(vInfo?.tax_id)} · ภ.ง.ด.${pnd}`, whtDefault].filter(Boolean).join(' · ') : '—'}</span></label>
            <label style={css(LABEL)}>วันที่บิล<input readOnly={amountsLocked} value={date} onChange={(e) => setDate(e.target.value)} style={css(P.inputNum)} /></label>
            <label style={css(LABEL)}>ครบกำหนด<input readOnly={!editable} value={due} onChange={(e) => setDue(e.target.value)} style={css(P.inputNum)} /></label>
            <label style={css(LABEL)}>เลขใบกำกับของผู้ขาย<input readOnly={amountsLocked} value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} style={IN} />
              {vendorRef.trim() && refs && (dup
                ? <span style={css('font-size: 13px; color: #a2191f')}>เลขใบกำกับซ้ำ · <a href={pHref({ id: dup.id, doc_type: 'AP' })}>{pDocNo({ doc_no: dup.docNo })}</a></span>
                : <span style={css('font-size: 13px; color: #0e6027')}>ไม่ซ้ำกับบิลเดิมของผู้ขายรายนี้</span>)}</label>
            {/* เดือนที่ใช้ภาษีซื้อ (ม.82/3 เลื่อนได้ ≤ 6 เดือน) → PurchaseDraftInput.vatClaimMonth */}
            <label style={css(LABEL)}>เดือนที่ใช้ภาษีซื้อ<select disabled={!editable} value={claimMonth} onChange={(e) => setClaimMonth(Number(e.target.value))} style={IN}>{months.map((m, k) => <option key={m} value={k}>{m}{k === 0 ? ' (ตามบิล)' : ''}</option>)}</select><span style={css('font-size: 13px; color: #525252')}>เลื่อนได้ไม่เกิน 6 เดือน</span></label>
            {/* TODO(backend): สูตร Cash[AP] ซื้อสด ยังไม่มี — savePurchaseDraft ใช้ Credit[AP] กับ AP เสมอ */}
            <label style={css(LABEL)}>สูตรลงบัญชี<select disabled={!editable} value="Credit[AP]" onChange={() => undefined} style={IN}><option value="Credit[AP]">Credit[AP] ซื้อเชื่อ</option><option value="Cash[AP]" disabled>Cash[AP] ซื้อสด</option></select></label>
            {/* TODO(Wei): ตัวเลือก "ตั้งหนี้" ขัดกับ CLAUDE.md (หัก ณ ที่จ่ายรับรู้ตอนจ่ายเงินจริง — ล็อกแล้ว) → ปิดไว้ */}
            <label style={css(LABEL)}>รับรู้ WHT เมื่อ<select disabled={!editable} value="pay" onChange={() => undefined} style={IN}><option value="pay">จ่ายเงิน (นโยบายบริษัท)</option><option value="bill" disabled>ตั้งหนี้</option></select></label>
          </section>

          <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
            <datalist id="ap-expense">{expense.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
            <table style={css('width: 100%; min-width: 860px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รายการ</th><th style={css('padding: 0 12px; font-weight: 400')}>บัญชี</th><th style={css('padding: 0 12px; font-weight: 400')}>มิติ</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>จำนวน</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ราคา</th><th style={css('padding: 0 12px; font-weight: 400')}>ภาษีซื้อ</th><th style={css('padding: 0 12px; font-weight: 400')}>WHT</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>จำนวนเงิน</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const k = idx[i] ?? -1;
                  const amount = k >= 0 && totals ? totals.lines[k]?.gross ?? '' : '';
                  const acc = accCode(r.account) ?? '';
                  const accText = acc ? `${acc} ${names[acc] ?? ''}`.trim() : '';
                  const t = r.wht ? whtTypes[r.wht] : undefined;
                  return (
                    <tr key={i} style={css('border-top: 1px solid #e0e0e0')}>
                      <td style={css('height: 48px; padding: 4px 12px')}>{editable && !tms ? <input aria-label={`รายการ บรรทัด ${i + 1}`} value={r.item} onChange={(e) => set(i, 'item', e.target.value)} style={css(`${CELL}; width: 100%; min-width: 240px`)} /> : r.item}</td>
                      <td style={css('padding: 0 12px')}>{editable ? <input aria-label={`บัญชี บรรทัด ${i + 1}`} list="ap-expense" value={r.account.length > 7 ? r.account : accText || r.account} onChange={(e) => set(i, 'account', e.target.value)} style={css(`${CELL}; width: 100%; min-width: 200px`)} /> : accText}</td>
                      {/* TODO(backend): มิติ (โครงการ) ต่อบรรทัดยังไม่มีในเอกสาร */}
                      <td style={css('padding: 0 12px; color: #525252')}>—</td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{editable && !tms ? <input aria-label={`จำนวน บรรทัด ${i + 1}`} value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} style={css(`${CELL}; width: 64px; text-align: right; font-variant-numeric: tabular-nums`)} /> : r.qty}</td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{editable && !tms ? <input aria-label={`ราคา บรรทัด ${i + 1}`} value={r.price} onChange={(e) => set(i, 'price', e.target.value)} style={css(`${CELL}; width: 110px; text-align: right; font-variant-numeric: tabular-nums`)} /> : r.price}</td>
                      <td style={css('padding: 0 12px')}>{editable ? <select aria-label={`ภาษีซื้อ บรรทัด ${i + 1}`} value={r.vat ? '1' : '0'} onChange={(e) => set(i, 'vat', e.target.value === '1')} style={css(P.cellSel)}><option value="1">7%</option><option value="0">ยกเว้น</option></select> : r.vat ? '7%' : 'ยกเว้น'}</td>
                      <td style={css('padding: 0 12px')}>{editable
                        ? <select aria-label={`WHT บรรทัด ${i + 1}`} value={r.wht} onChange={(e) => set(i, 'wht', e.target.value)} style={css(`${P.cellSel}; width: 150px`)}><option value="">ไม่หัก</option>{Object.values(whtTypes).map((w) => <option key={w.key} value={w.key}>{whtOptionText(w)}{w.status === 'PENDING_AUDITOR' ? ' · รอยืนยัน' : ''}</option>)}</select>
                        : t ? `${pct(t.rate)}%` : 'ไม่หัก'}{t?.status === 'PENDING_AUDITOR' && <> <Pending /></>}</td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(amount)}</td>
                    </tr>
                  );
                })}
                {/* TODO(Wei): แบบร่างบิลซื้อ (จาก TMS) ไม่มีปุ่มเพิ่มบรรทัด — บิลที่กรอกเองใช้ "+ เพิ่มรายการ" จาก ScreenPurchaseOrder/ScreenExpense */}
                {editable && !tms && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={8} style={css('padding: 0 12px')}><Button kind="ghost" size={32} onClick={() => setRows([...rows, { ...blankPLine(), wht: defaultWhtKeys(vReg)[0] ?? '' }])}>+ เพิ่มรายการ</Button></td></tr>}
              </tbody>
            </table>
          </section>

          <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; justify-content: space-between')}>
            <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 6px')}>
              <strong>สิ่งที่ระบบตรวจแล้ว</strong>
              {vendorRef.trim() && refs && (dup ? <span style={css('color: #a2191f')}>เลขใบกำกับซ้ำ ({pDocNo({ doc_no: dup.docNo })})</span> : <span style={css('color: #0e6027')}>เลขใบกำกับผู้ขายไม่ซ้ำ ✓</span>)}
              {/* TODO(Wei): ข้อความเมื่องวดปิดแข็งแล้ว ไม่มีในแบบร่าง */}
              {iso && period && (period.status === 'hard_closed'
                ? <span style={css('color: #a2191f')}>งวด {monthBE(iso)} ปิดแล้ว</span>
                : <span style={css('color: #0e6027')}>งวด {monthBE(iso)} ยังเปิด{period.status === 'soft_closed' ? ' (soft close)' : ''} ✓</span>)}
              {pnd && <span style={css('color: #0e6027')}>ผู้ขาย{personText(vInfo?.tax_id)} → ภ.ง.ด.{pnd} ✓</span>}
              {/* TODO(Wei): ข้อความเมื่อผู้ขายมีบัญชีธนาคารแล้ว ไม่มีในแบบร่าง → ไม่แสดง */}
              {vendor && !vReg?.bank_account && <span style={css('color: #684e00')}>ผู้ขายยังไม่มีบัญชีธนาคารสำหรับโอน — <a href={`/master/contacts?id=${vendor.id}`}>เพิ่ม</a></span>}
            </section>
            <table style={css('flex: 0 1 340px; border-collapse: collapse; font-size: 15px')}><tbody>
              <tr><td style={css(P.sumTd)}>มูลค่าก่อนภาษี</td><td style={css(P.sumNum)}>{money(totals?.net ?? d?.subtotal)}</td></tr>
              <tr><td style={css(P.sumTd)}>ภาษีซื้อ</td><td style={css(P.sumNum)}>{money(totals?.vat ?? d?.vat, { blankZero: true })}</td></tr>
              <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css(P.sumTotal)}>ยอดตั้งหนี้</td><td style={css(P.sumTotalNum)}>{money(grand)}</td></tr>
              {cnr.length > 0 && <tr><td style={css('height: 28px; font-size: 13px; color: #525252')}>หัก ใบลดหนี้ {cnr.map((c) => c.doc_no).join(', ')}</td><td style={css('text-align: right; font-size: 13px; color: #525252; font-variant-numeric: tabular-nums')}>{money(fromCents(-cnr.reduce((s, c) => s + toCents(c.applied), 0n)), { paren: true })}</td></tr>}
              <tr><td style={css('height: 28px; font-size: 13px; color: #525252')}>หัก ณ ที่จ่าย {rateText || '—'} ตอนจ่าย{wht.some((w) => w.pendingAuditor) && <> <Pending /></>}</td><td style={css('text-align: right; font-size: 13px; color: #525252; font-variant-numeric: tabular-nums')}>{money(fromCents(-whtAmount), { paren: true })}</td></tr>
              <tr><td style={css('height: 28px; font-size: 13px; color: #525252')}>จ่ายจริง</td><td style={css('text-align: right; font-size: 13px; color: #525252; font-variant-numeric: tabular-nums')}>{money(base ? subMoney(base, whtText) : null)}</td></tr>
            </tbody></table>
          </div>
          {err && <Msg msg={{ kind: 'err', text: err }} />}
          {journal}
        </>}

        {/* TODO(Wei): แท็บ "สำหรับนักบัญชี" ไม่มีเนื้อหาในแบบร่าง (ScreenPurchaseBill.dc.html) — แสดงรายการบัญชี/ยอดค้าง/การตัดชำระ/ประวัติ เหมือนหน้าขาย */}
        {tab === 'acct' && <>
          <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px; font-size: 14px')}>
            <div style={css(F.label)}>สูตรลงบัญชี<span style={css('font-size: 15px; color: #161616')}>{d?.rule_code ?? 'Credit[AP]'}</span></div>
            <div style={css(F.label)}>รายการบัญชี<span style={css('font-size: 15px; color: #161616')}>{detail?.journal[0] ? <a href={`/gl/journal?no=${encodeURIComponent(detail.journal[0].journal_no)}`}>{detail.journal[0].journal_no}</a> : '—'}</span></div>
            <div style={css(F.label)}>ยอดค้างจ่าย<span style={css('font-size: 15px; color: #161616; font-variant-numeric: tabular-nums')}>{out ? money(out) : '—'}</span></div>
            <div style={css(F.label)}>ใบสั่งซื้ออ้างอิง<span style={css('font-size: 15px; color: #161616')}>{detail?.ref ? <a href={pHref(detail.ref)}>{pDocNo(detail.ref)}</a> : '—'}</span></div>
          </section>
          {journal}
          {!!detail?.settlementsIn.length && (
            <section style={css('border: 1px solid #e0e0e0; overflow-x: auto; max-width: 720px')}>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เลขที่</th><th style={css(F.th)}>วันที่</th><th style={css(F.thNum)}>ยอดตัด</th><th style={css(F.thNum)}>หัก ณ ที่จ่าย</th></tr></thead>
                <tbody>{detail.settlementsIn.map((s) => (
                  <tr key={s.id} style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px')}><a href={pHref(s)}>{s.doc_no ?? '(ร่าง)'}</a>{s.voided ? ' (รออนุมัติ/ยกเลิก)' : ''}</td><td style={css(F.td)}>{thaiDate(s.issue_date)}</td><td style={css(F.num)}>{money(s.applied)}</td><td style={css(F.num)}>{money(s.wht, { blankZero: true })}</td></tr>
                ))}</tbody>
              </table>
            </section>
          )}
          <section style={css('border: 1px solid #e0e0e0; overflow-x: auto; max-width: 720px')}>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เวลา</th><th style={css(F.th)}>รายการ</th><th style={css(F.th)}>รายละเอียด</th></tr></thead>
              <tbody>{(detail?.events ?? []).map((e, i) => {
                const t = bangkok(e.at);
                const det = e.detail as { reason?: string; docNo?: string; journalNo?: string };
                return <tr key={i} style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{thaiDate(t.date)} {t.time}</td><td style={css(F.td)}>{EVENT_TEXT[e.event] ?? e.event}</td><td style={css('padding: 0 12px; color: #525252')}>{[det.docNo, det.journalNo, det.reason].filter(Boolean).join(' · ')}</td></tr>;
              })}</tbody>
            </table>
          </section>
        </>}
        {tab === 'files' && <p style={css('margin: 0; font-size: 14px; color: #525252')}>—</p>}
        <Msg msg={msg} />
      </div>

      <div style={css(P.footerBetween)}>
        <span style={css('font-size: 13px; color: #525252')}>{tms ? 'อนุมัติแล้ว TMS จะเห็นสถานะ "ตั้งหนี้แล้ว" ทันที' : detail?.journal[0] ? `ลงบัญชีแล้ว ${detail.journal[0].journal_no}` : ''}</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {d?.status === 'pending_approval' && <Button kind="danger" onClick={reject}>{tms ? 'ส่งกลับ TMS แก้ไข' : 'ปฏิเสธ'}</Button>}
          {/* TODO(Wei): ปุ่มของบิลที่ลงบัญชีแล้วไม่มีในแบบร่าง — ใช้ชื่อจาก ScreenDocVoid / ScreenPurchaseCreditNote / ScreenPayment */}
          {d?.status === 'posted' && <ButtonLink kind="danger" href={`/finance/docs/${d.id}/void`}>ยกเลิกเอกสาร</ButtonLink>}
          {d?.status === 'posted' && out && toCents(out) > 0n && <ButtonLink href={`/purchase/credit-notes/new?ref=${d.id}`}>ใบลดหนี้ (CNR)</ButtonLink>}
          {editable && <Button onClick={() => void save()}>บันทึกร่าง</Button>}
          {editable && d?.status !== 'pending_approval' && <Button onClick={() => void act('submit')}>ส่งขออนุมัติ</Button>}
          {editable && <Button kind="primary" onClick={() => void act('approve')}>อนุมัติและตั้งหนี้</Button>}
          {d?.status === 'posted' && out && toCents(out) > 0n && d.contact_id && <ButtonLink kind="primary" href={`/finance/payments/new?contact=${d.contact_id}&bill=${d.id}`}>ทำใบสำคัญจ่าย</ButtonLink>}
        </div>
      </div>
    </>
  );
}
