'use client';
// P4 ใบลดหนี้ / ใบเพิ่มหนี้ที่ได้รับจากผู้ขาย (CNR/DNR) — design/project/ScreenPurchaseCreditNote.dc.html (Sidebar active="purchasecn")
// อ้างบิลซื้อเดิมเสมอ · ระบุ "มูลค่าที่ถูกต้อง" ต่อบรรทัด → ผลต่างเป็นบรรทัดของ CNR (บัญชี/VAT ตามบิลเดิม) · สูตร CNR (ลดเจ้าหนี้ + กลับภาษีซื้อ) / DNR
import { Button, ButtonLink, css, money, parseThaiDate, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { call } from '../../sales/_lib/client.ts';
import { fromCents, parseDec, subMoney, sumMoney, toCents } from '../../sales/_lib/num.ts';
import { Msg } from '../../sales/_lib/ui';
import { netLines, type PLineRow, usePTotals } from './lines.ts';
import { PJournal } from './PJournal';
import { monthNameBE, outstandingOf, pct, pDocNo, type PContact, type PDetail, type PLine, pStatusTag, type WhtTypeDef } from './types.ts';
import { docAction, P, PHeader, Pending, Seg } from './ui';
import { expectedWht, sumWht } from './wht.ts';

type Kind = 'CNR' | 'DNR';
export interface BillOption { id: string; doc_no: string | null; issue_date: string; vendor_ref: string | null; grand_total: string; outstanding: string; contact_id: string | null }
const REASONS = ['ลดราคาเนื่องจากบริการผิดข้อตกลง', 'คำนวณราคาผิดพลาดสูงกว่าที่เป็นจริง', 'ยกเลิกบริการบางส่วน', 'คืนสินค้า/ส่งคืน'] as const;
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const LABEL2 = 'grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
interface Row { line: PLine; corrected: string }

const billText = (b: BillOption) => [pDocNo(b), thaiDate(b.issue_date), b.vendor_ref ? `ใบกำกับผู้ขาย ${b.vendor_ref}` : null, money(b.grand_total), toCents(b.outstanding) > 0n ? `ค้างจ่าย ${money(b.outstanding)}` : 'จ่ายแล้ว'].filter(Boolean).join(' · ');
const items = (d: PDetail | null) => d?.lines.filter((l) => l.line_type === 'item') ?? [];

export function CreditNoteForm({ detail, refDetail, bills, vendors, whtTypes, names, today, initialKind }: {
  detail: PDetail | null; refDetail: PDetail | null; bills: BillOption[]; vendors: PContact[]; whtTypes: Record<string, WhtTypeDef>; names: Record<string, string>; today: string; initialKind: Kind;
}) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const label = (c: PContact) => `${c.code} · ${c.name}`;

  // มูลค่าที่ถูกต้อง = มูลค่าเดิม ∓ บรรทัดของใบนี้ที่ตรงบรรทัดเดิม (รายการ + บัญชี · ไม่พบ → บรรทัดแรกที่บัญชีเดียวกัน เช่น CNR2611-0003 ใน dev seed ใช้เหตุผลเป็นรายการ)
  const fromRef = (r: PDetail | null, own: PDetail | null, k: Kind): Row[] => {
    const lines = items(r);
    const adj = new Map<string, bigint>();
    for (const m of items(own)) {
      const hit = lines.find((l) => l.description === m.description && l.account_code === m.account_code) ?? lines.find((l) => l.account_code === m.account_code);
      if (hit) adj.set(hit.id, (adj.get(hit.id) ?? 0n) + toCents(m.amount));
    }
    return lines.map((l) => ({ line: l, corrected: money(fromCents(toCents(l.amount) + (k === 'DNR' ? 1n : -1n) * (adj.get(l.id) ?? 0n))) }));
  };
  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [kind, setKind] = useState<Kind>((d?.doc_type as Kind | undefined) ?? initialKind);
  const [ref, setRef] = useState<PDetail | null>(refDetail);
  const [vendorText, setVendorText] = useState(refDetail?.contact ? label(refDetail.contact) : detail?.contact ? label(detail.contact) : '');
  const [vendorRef, setVendorRef] = useState(d?.vendor_ref ?? '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [reason, setReason] = useState<string>(d?.reference ?? REASONS[0]);
  const [rows, setRows] = useState<Row[]>(fromRef(refDetail, detail, (d?.doc_type as Kind | undefined) ?? initialKind));
  const [attach, setAttach] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => { if (!d) setRows(fromRef(ref, null, kind)); }, [ref]);

  const vendor = vendors.find((c) => vendorText === label(c) || vendorText.startsWith(`${c.code} `)) ?? null;
  const options = bills.filter((b) => !vendor || b.contact_id === vendor.id);
  async function pickRef(billId: string) {
    if (!billId) { setRef(null); return; }
    const r = await call<PDetail>(`documents/${billId}`);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setRef(r.data);
    if (r.data.contact) setVendorText(label(r.data.contact));
  }

  // ผลต่างต่อบรรทัด → บรรทัดของ CNR/DNR
  const diffOf = (r: Row): bigint => { const c = parseDec(r.corrected, 2); if (c === null) return 0n; const x = kind === 'DNR' ? c - toCents(r.line.amount) : toCents(r.line.amount) - c; return x > 0n ? x : 0n; };
  const diffRows: PLineRow[] = rows.filter((r) => diffOf(r) > 0n).map((r) => ({ item: r.line.description, account: r.line.account_code ?? '', qty: '1', price: fromCents(diffOf(r)), vat: r.line.vat_rate !== null, wht: '' }));
  const { totals, idx, err } = usePTotals(diffRows, ref?.doc.price_incl_vat ?? false);
  const net = netLines(diffRows, totals, idx);
  const diffNet = totals?.net ?? (d ? subMoney(d.subtotal, d.discount) : '0.00');
  const diffVat = totals?.vat ?? d?.vat ?? '0.00';
  const diffTotal = totals?.grandTotal ?? d?.grand_total ?? '0.00';
  const sign = (a: string, b: string) => (kind === 'DNR' ? sumMoney([a, b]) : subMoney(a, b));
  const origNet = ref ? subMoney(ref.doc.subtotal, ref.doc.discount) : '0.00';
  const origVat = ref?.doc.vat ?? '0.00';
  const origTotal = ref?.doc.grand_total ?? '0.00';

  const iso = parseThaiDate(date);
  // ยอดค้างจ่ายก่อน/หลังใบนี้: ร่าง = ยอดค้างปัจจุบัน · ลงบัญชีแล้ว = ณ วันที่ในใบนี้ (ไม่นับการจ่าย/ลดหนี้ที่เกิดหลังจากนั้น)
  const refSettle = (ref?.settlementsIn ?? []).filter((s) => !s.voided && s.id !== d?.id);
  const before = !ref ? null : d?.status === 'posted'
    ? fromCents(toCents(ref.doc.grand_total) - refSettle.filter((s) => s.issue_date <= d.issue_date).reduce((s, x) => s + toCents(x.applied) + toCents(x.wht), 0n))
    : outstandingOf(ref);
  const after = before ? sign(before, diffTotal) : null;
  // สูตร: ลดหนี้เกินยอดค้าง (บิลเดิมจ่ายแล้ว) → CNR[Credit] ส่วนเกินเป็นเครดิตคงเหลือกับผู้ขาย — API เลือกเองตอนผ่านรายการ (approvePurchase)
  const rule = kind === 'DNR' ? 'DNR' : d?.status === 'posted' ? (d.rule_code ?? 'CNR') : before !== null && toCents(diffTotal) > toCents(before) ? 'CNR[Credit]' : 'CNR';
  // หัก ณ ที่จ่ายเมื่อจ่าย: ฐาน = บรรทัดที่มีประเภทเงินได้ − ใบลดหนี้ซื้อของบิลนี้ (ตรงกับ whtForBill)
  const otherCnr = (ref?.settlementsIn ?? []).filter((s) => s.doc_type === 'CNR' && !s.voided && s.id !== d?.id);
  const refWhtLines = items(ref).map((l) => ({ amount: l.amount, account: l.account_code, whtType: l.wht_type }));
  // TODO(backend): บรรทัดของใบลดหนี้ใบอื่นของบิลเดียวกันไม่มีใน GET documents/:id ของบิล → ฐานหักเฉพาะใบนี้ (ถ้ามีใบอื่น ยอดนี้สูงกว่าจริง)
  const wht = otherCnr.length ? [] : kind === 'CNR' ? expectedWht(refWhtLines, whtTypes, net.map((l) => ({ amount: l.amount, account: l.account }))) : expectedWht(refWhtLines, whtTypes);
  const pv = (ref?.settlementsIn ?? []).filter((s) => s.doc_type === 'PV' && !s.voided && iso && s.issue_date >= iso).sort((a, b) => a.issue_date.localeCompare(b.issue_date))[0];

  const payload = () => ({
    docType: kind, contactId: ref?.doc.contact_id ?? vendor?.id ?? '', issueDate: iso ?? '', vendorRef: vendorRef.trim() || null, priceInclVat: ref?.doc.price_incl_vat ?? false,
    refDocumentId: ref?.doc.id ?? null, reference: reason || null, notes: d?.notes ?? null,
    lines: diffRows.map((r) => ({ lineType: 'item' as const, productCode: null, description: r.item, qty: '1', unitPrice: r.price, discount: '0.00', vat: r.vat, accountCode: r.account || null, whtType: null })),
  });
  async function save(quiet = false): Promise<string | null> {
    if (!editable) return id;
    if (!ref) { setMsg({ kind: 'err', text: 'ใบลดหนี้/เพิ่มหนี้ซื้อต้องอ้างบิลซื้อ' }); return null; }
    if (!iso) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    const r = await call<{ id: string }>(id ? `purchases/${id}` : 'purchases', id ? 'PUT' : 'POST', payload());
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    if (!quiet) setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    if (!id) { setId(r.data.id); router.replace(`/purchase/credit-notes/${r.data.id}`); } else router.refresh();
    return r.data.id;
  }
  async function approve() {
    const docId = await save(true);
    if (!docId) return;
    const r = await docAction<{ docNo: string; journalNo?: string }>(docId, 'approve');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); if (!id) router.replace(`/purchase/credit-notes/${docId}`); return; }
    setMsg({ kind: 'ok', text: `ผ่านรายการแล้ว ${r.data.docNo}${r.data.journalNo ? ` · ลงบัญชี ${r.data.journalNo}` : ''}` });
    if (!id) router.replace(`/purchase/credit-notes/${docId}`); else router.refresh();
  }

  const no = d ? pDocNo(d) : 'ใหม่';
  const name = kind === 'DNR' ? 'ใบเพิ่มหนี้ที่ได้รับจากผู้ขาย' : 'ใบลดหนี้ที่ได้รับจากผู้ขาย';
  const tag = d ? pStatusTag(d, today, null) : { kind: 'info' as const, text: 'ร่าง' };
  const refNo = ref ? pDocNo(ref.doc) : '—';
  const IN = css(P.input);
  const rateText = [...new Set(wht.map((w) => `${pct(w.rate)}%`))].join(' + ');
  const whtBase = sumMoney(wht.map((w) => w.base));

  return (
    <>
      {/* TODO(Wei): แบบร่างมีแต่ CNR — ชื่อ/ข้อความของ DNR (crumb, หัวเรื่อง, "ผลต่าง (เพิ่มหนี้)", "เพิ่มภาษีซื้อ") ใช้คำตรงข้ามของ CNR */}
      <PHeader crumb={`ซื้อ / ${kind === 'DNR' ? 'ใบเพิ่มหนี้ (รับจากผู้ขาย)' : 'ใบลดหนี้ (รับจากผู้ขาย)'} / ${no}`} tag={tag}
        toggle={<Seg label="ประเภท" value={kind} disabled={!editable} onChange={(k) => { setKind(k); if (!d) setRows(fromRef(ref, null, k)); }} options={[['CNR', 'ใบลดหนี้ (CNR)'], ['DNR', 'ใบเพิ่มหนี้ (DNR)']]} />} />
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>{name} {no}</h1><span style={css('font-size: 13px; color: #525252')}>{kind === 'DNR' ? 'บันทึกตามใบเพิ่มหนี้ที่ผู้ขายออก · ต้องอ้างอิงบิลซื้อเดิม · ภาษีซื้อเพิ่มและเข้ารายงานภาษีซื้อเดือนที่ได้รับ' : 'บันทึกตามใบลดหนี้ที่ผู้ขายออก · ต้องอ้างอิงบิลซื้อเดิม · ภาษีซื้อกลับรายการและเข้ารายงานภาษีซื้อเดือนที่ได้รับ'}</span></div>

        <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <datalist id="cnr-vendors">{vendors.map((c) => <option key={c.id} value={label(c)} />)}</datalist>
          <label style={css(LABEL2)}>ผู้ขาย<input list="cnr-vendors" readOnly={!editable} value={vendorText} onChange={(e) => setVendorText(e.target.value)} style={IN} /></label>
          <label style={css(LABEL)}>{kind === 'DNR' ? 'เลขที่ใบเพิ่มหนี้ของผู้ขาย' : 'เลขที่ใบลดหนี้ของผู้ขาย'}<input readOnly={!editable} value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} style={IN} /></label>
          <label style={css(LABEL)}>{kind === 'DNR' ? 'วันที่ในใบเพิ่มหนี้' : 'วันที่ในใบลดหนี้'}<input readOnly={!editable} value={date} onChange={(e) => setDate(e.target.value)} style={css(P.inputNum)} /></label>
          <label style={css(LABEL2)}>อ้างอิงบิลซื้อเดิม<select disabled={!editable} value={ref?.doc.id ?? ''} onChange={(e) => void pickRef(e.target.value)} style={IN}>
            {!ref && <option value="">—</option>}
            {ref && !options.some((b) => b.id === ref.doc.id) && <option value={ref.doc.id}>{billText({ ...ref.doc, outstanding: outstandingOf(ref) ?? '0.00' })}</option>}
            {options.map((b) => <option key={b.id} value={b.id}>{billText(b)}</option>)}</select>
            <span style={css('font-size: 13px; color: #525252')}>ยอดลดหนี้ต้องไม่เกินมูลค่าบิลเดิม · ถ้าบิลเดิมจ่ายแล้ว ระบบตั้งเป็นเครดิตคงเหลือกับผู้ขาย</span></label>
          {/* TODO(backend): เหตุผลตาม ม.82/10 ไม่มีฟิลด์ใน PurchaseDraftInput — เก็บใน reference */}
          <label style={css(LABEL)}>เหตุผล (ตาม ม.82/10)<select disabled={!editable} value={reason} onChange={(e) => setReason(e.target.value)} style={IN}>{[...new Set([...REASONS, reason])].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          {/* TODO(Wei): ชื่อสูตรในแบบร่าง CNR[AP] = รหัสสูตร CNR ในระบบ · สูตรเลือกตามยอดค้างของบิลเดิม (ไม่ให้เลือกเอง) */}
          <label style={css(LABEL)}>สูตรลงบัญชี<select disabled={!editable} value={rule} onChange={() => undefined} style={IN}>
            {kind === 'CNR' ? <><option value="CNR" disabled={rule !== 'CNR'}>CNR[AP] ลดเจ้าหนี้ + กลับภาษีซื้อ</option><option value="CNR[Credit]" disabled={rule !== 'CNR[Credit]'}>CNR[Credit] ตั้งเครดิตผู้ขาย</option></> : <option value="DNR">DNR ใบเพิ่มหนี้ซื้อ (ภาษีซื้อเพิ่ม)</option>}</select></label>
        </section>

        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <div style={css('padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; display: flex; justify-content: space-between')}><span>รายการในบิลเดิม — ระบุมูลค่าที่ถูกต้อง ระบบคำนวณผลต่างให้</span><span style={css('color: #525252')}>ปรับได้ทั้งราคา/หน่วย หรือจำนวน</span></div>
          <table style={css('width: 100%; min-width: 900px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รายการ (จาก {refNo})</th><th style={css('padding: 0 12px; font-weight: 400')}>บัญชี</th><th style={css('padding: 0 12px; font-weight: 400')}>VAT</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>มูลค่าเดิม</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>มูลค่าที่ถูกต้อง</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>{kind === 'DNR' ? 'ผลต่าง (เพิ่มหนี้)' : 'ผลต่าง (ลดหนี้)'}</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const diff = diffOf(r);
                return (
                  <tr key={r.line.id} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}>{r.line.description}</td>
                    <td style={css('padding: 0 12px')}>{r.line.account_code} {names[r.line.account_code ?? ''] ?? ''}</td>
                    <td style={css('padding: 0 12px')}>{r.line.vat_rate !== null ? '7%' : 'ยกเว้น'}</td>
                    <td style={css(NUM)}>{money(r.line.amount)}</td>
                    <td style={css('padding: 0 12px; text-align: right')}>{editable
                      ? <input aria-label={`มูลค่าที่ถูกต้อง บรรทัด ${i + 1}`} value={r.corrected} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, corrected: e.target.value } : x)))} onBlur={() => { const c = parseDec(r.corrected, 2); if (c !== null) setRows(rows.map((x, j) => (j === i ? { ...x, corrected: money(fromCents(c)) } : x))); }} style={css('width: 130px; height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; font-variant-numeric: tabular-nums')} />
                      : <span style={css('font-variant-numeric: tabular-nums')}>{r.corrected}</span>}</td>
                    <td style={css(diff > 0n ? `${NUM}; font-weight: 500` : `${NUM}; color: #525252`)}>{money(fromCents(diff))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={css('border-top: 1px solid #8d8d8d')}><td colSpan={3} style={css('height: 36px; padding: 0 12px; color: #525252')}>มูลค่าก่อนภาษี</td><td style={css(NUM)}>{money(origNet)}</td><td style={css(NUM)}>{money(sign(origNet, diffNet))}</td><td style={css(NUM)}>{money(diffNet)}</td></tr>
              <tr><td colSpan={3} style={css('height: 36px; padding: 0 12px; color: #525252')}>ภาษีมูลค่าเพิ่ม 7%</td><td style={css(NUM)}>{money(origVat)}</td><td style={css(NUM)}>{money(sign(origVat, diffVat))}</td><td style={css(NUM)}>{money(diffVat)}</td></tr>
              <tr style={css('font-weight: 600')}><td colSpan={3} style={css('height: 40px; padding: 0 12px')}>รวม</td><td style={css(NUM)}>{money(origTotal)}</td><td style={css(NUM)}>{money(sign(origTotal, diffTotal))}</td><td style={css(`${NUM}; font-size: 16px`)}>{money(diffTotal)}</td></tr>
            </tfoot>
          </table>
        </section>
        {err && <Msg msg={{ kind: 'err', text: err }} />}

        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <PJournal extra="flex: 1 1 400px" note={kind === 'DNR' ? 'สูตร DNR' : rule === 'CNR[Credit]' ? 'สูตร CNR[Credit]' : 'สูตร CNR[AP]'} names={names} posted={detail?.journal.length ? detail.journal : null} suffixCr={kind === 'CNR' ? '(กลับรายการ)' : undefined}
            source={{ rule, docType: kind, amounts: totals ? { grand_total: totals.grandTotal, vat: totals.vat } : null, lines: net.map((l) => ({ amount: l.amount, account: l.account })) }}
            footer={kind === 'CNR' ? <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>ถ้าบิลเดิมเป็นค่าใช้จ่ายงวดที่ปิดแล้ว ระบบยังกลับที่บัญชีเดิมในงวดปัจจุบัน (ไม่เปิดงวด) · หัก ณ ที่จ่ายไม่กระทบ เพราะยังไม่ได้จ่ายเงิน</div> : null} />
          <section style={css('flex: 1 1 320px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
            <strong>ผลต่อเอกสารและภาษี</strong>
            <div style={css('display: flex; justify-content: space-between')}><span>{refNo} ค้างจ่าย</span><span style={css('font-variant-numeric: tabular-nums')}>{money(before)} → <strong>{money(after)}</strong></span></div>
            <div style={css('display: flex; justify-content: space-between')}><span>รายงานภาษีซื้อ</span><span>{iso ? monthNameBE(iso) : '—'} · {kind === 'DNR' ? 'เพิ่มภาษีซื้อ' : 'ลดภาษีซื้อ'} {money(diffVat)}</span></div>
            {wht.length > 0 && <div style={css('display: flex; justify-content: space-between')}><span>หัก ณ ที่จ่ายเมื่อจ่าย ({rateText}){wht.some((w) => w.pendingAuditor) && <> <Pending /></>}</span><span style={css('font-variant-numeric: tabular-nums')}>{money(sumWht(wht))} (จากฐานใหม่ {money(whtBase)})</span></div>}
            {/* TODO(backend): ใบสำคัญจ่ายที่สร้างก่อนใบลดหนี้ (รออนุมัติ) ยังไม่ถูกปรับยอดอัตโนมัติ — แสดงเฉพาะรอบจ่ายที่เกิดหลังวันที่ในใบนี้ */}
            {pv && <div style={css('display: flex; justify-content: space-between')}><span>รอบจ่าย {Number(pv.issue_date.slice(8, 10))} {thaiMonth(Number(pv.issue_date.slice(5, 7)))}</span><span style={css('color: #0e6027')}>ปรับยอดให้อัตโนมัติ</span></div>}
            {/* TODO(backend): ไฟล์แนบใบลดหนี้ต้นฉบับยังไม่มี API */}
            <label style={css('display: flex; gap: 8px; align-items: center; margin-top: 4px')}><input type="checkbox" checked={attach} disabled={!editable} onChange={(e) => setAttach(e.target.checked)} /> แนบไฟล์ใบลดหนี้ต้นฉบับจากผู้ขาย (บังคับสำหรับใช้สิทธิ์ภาษีซื้อ)</label>
          </section>
        </div>
        <Msg msg={msg} />
      </div>

      <div style={css(P.footerEnd)}><div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
        {/* TODO(Wei): ปุ่มของใบที่ผ่านรายการแล้วไม่มีในแบบร่าง — ใช้ "ยกเลิกเอกสาร" (ScreenDocVoid) */}
        {d?.status === 'posted' && <ButtonLink kind="danger" href={`/finance/docs/${d.id}/void`}>ยกเลิกเอกสาร</ButtonLink>}
        {editable && <Button onClick={() => void save()}>บันทึกร่าง</Button>}
        {editable && <Button kind="primary" onClick={() => void approve()}>บันทึกและผ่านรายการ</Button>}
      </div></div>
    </>
  );
}
