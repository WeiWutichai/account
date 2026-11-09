'use client';
// P0 ใบขอซื้อ / ใบสั่งซื้อ — design/project/ScreenPurchaseOrder.dc.html (Sidebar active="po") · PR/PO ไม่ลงบัญชี (packages/db/src/purchase.ts NON_POSTING)
import { Button, ButtonLink, css, money, parseThaiDate, shortDate, thaiDate } from '@innovera/ui';
import { bangkok } from '../../sales/_lib/doc.ts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Msg } from '../../sales/_lib/ui';
import { blankPLine, netLines, pLinePayload, type PLineRow, pRowFromLine, usePTotals, validP } from './lines.ts';
import { docAction, P, PHeader, Pending, Seg } from './ui';
import { type Account, pct, pDocNo, type PContact, type PDetail, pndOf, pStatusTag, type WhtTypeDef } from './types.ts';
import { expectedWht, sumWht } from './wht.ts';
import { call } from '../../sales/_lib/client.ts';
import { toCents } from '../../sales/_lib/num.ts';

type Kind = 'PR' | 'PO';
// TODO(backend): วงเงินสายอนุมัติ PO ไม่มีใน API — ใช้ fixtures PO2611-0018.approval_limit_l2 (300,000) ตามแบบร่าง · backend ยังไม่บังคับระดับกรรมการ
const L2_LIMIT = '300000.00';
// TODO(backend): เงื่อนไขชำระไม่มีฟิลด์ใน PurchaseDraftInput — เก็บใน notes
const TERMS = ['เครดิต 30 วันหลังรับบิล', 'มัดจำ 30% + ที่เหลือเมื่อส่งมอบ', 'จ่ายทันที'] as const;
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const LABEL2 = 'grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const ddmm = (ts: string | null | undefined) => (ts ? shortDate(bangkok(ts).date) : '');

export function OrderForm({ detail, pr, vendors, accounts, whtTypes, today, received, initialKind }: {
  detail: PDetail | null; pr: PDetail | null; vendors: PContact[]; accounts: Account[]; whtTypes: Record<string, WhtTypeDef>; today: string; received: string[]; initialKind: Kind;
}) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const label = (c: PContact) => `${c.code} · ${c.name}`;
  const src = detail ?? pr;
  const initialVendor = src?.contact ?? null;

  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [kind, setKind] = useState<Kind>((d?.doc_type as Kind | undefined) ?? initialKind);
  const [vendorText, setVendorText] = useState(initialVendor ? label(initialVendor) : '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [due, setDue] = useState(src?.doc.due_date ? thaiDate(src.doc.due_date) : '');
  const [requester, setRequester] = useState(src?.doc.reference ?? '');
  const [terms, setTerms] = useState<string>(src?.doc.notes ?? TERMS[0]);
  const [rows, setRows] = useState<PLineRow[]>(src?.lines.filter((l) => l.line_type === 'item').map(pRowFromLine) ?? [blankPLine()]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { totals, idx, err } = usePTotals(rows);
  const vendor = vendors.find((c) => vendorText === label(c) || vendorText.startsWith(`${c.code} `)) ?? null;
  const vendorInfo = vendor && src?.contact?.id === vendor.id ? src.contact : vendor;
  const expense = accounts.filter((a) => a.type === 'expense' && a.active);
  const wht = expectedWht(netLines(rows, totals, idx), whtTypes);
  const rates = [...new Set(wht.map((w) => `${pct(w.rate)}%`))];

  const payload = () => ({
    docType: kind, contactId: vendor?.id ?? '', issueDate: parseThaiDate(date) ?? '', dueDate: due ? parseThaiDate(due) : null, priceInclVat: false,
    refDocumentId: d?.ref_document_id ?? pr?.doc.id ?? null, reference: requester || null, notes: terms || null, lines: rows.filter(validP).map(pLinePayload),
  });
  async function save(quiet = false): Promise<string | null> {
    if (!editable) return id;
    if (!vendor) { setMsg({ kind: 'err', text: 'เลือกผู้ขายจากรายการ' }); return null; }
    if (!parseThaiDate(date) || (due && !parseThaiDate(due))) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    if (rows.some((r) => r.item.trim() && !validP(r))) { setMsg({ kind: 'err', text: 'กรอกจำนวน ราคา/หน่วย ของทุกบรรทัดให้ถูกต้อง' }); return null; }
    const r = await call<{ id: string }>(id ? `purchases/${id}` : 'purchases', id ? 'PUT' : 'POST', payload());
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    if (!quiet) setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    if (!id) { setId(r.data.id); router.replace(`/purchase/orders/${r.data.id}`); } else router.refresh();
    return r.data.id;
  }
  async function act(action: 'submit' | 'approve' | 'reject', body?: unknown) {
    const docId = action === 'reject' ? id : await save(true);
    if (!docId) return;
    const r = await docAction<{ docNo?: string }>(docId, action, body);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: action === 'approve' ? `อนุมัติแล้ว ${r.data.docNo ?? ''}` : action === 'submit' ? 'ส่งขออนุมัติแล้ว' : 'ปฏิเสธแล้ว — เอกสารกลับเป็นร่าง' });
    if (!id) router.replace(`/purchase/orders/${docId}`); else router.refresh();
  }
  function reject() {
    // TODO(Wei): แบบร่างไม่มีปุ่ม/หน้าต่างปฏิเสธ (ScreenPurchaseOrder.dc.html) — ใช้ prompt ของเบราว์เซอร์แบบหน้าขาย
    const reason = window.prompt('เหตุผลที่ปฏิเสธ');
    if (reason !== null) void act('reject', { reason });
  }
  const set = (i: number, k: keyof PLineRow, v: string | boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const no = d ? pDocNo(d) : 'ใหม่';
  const name = kind === 'PR' ? 'ใบขอซื้อ' : 'ใบสั่งซื้อ';
  const tag = d ? pStatusTag(d, today, null) : { kind: 'info' as const, text: 'ร่าง' };
  const refPr = detail?.ref ?? (pr ? { id: pr.doc.id, doc_no: pr.doc.doc_no } : null);
  const sub = [refPr ? `สร้างจากใบขอซื้อ ${pDocNo(refPr)}${pr?.doc.status === 'approved' || detail?.ref ? ' (อนุมัติแล้ว)' : ''}` : null, 'ไม่ลงบัญชี', 'ใช้ควบคุมงบและเทียบกับบิลซื้อที่เข้ามา'].filter(Boolean).join(' · ');
  const grand = totals?.grandTotal ?? d?.grand_total ?? null;
  const over = toCents(grand) > toCents(L2_LIMIT);
  const approvedAt = d?.status === 'approved' ? ddmm(d.approved_at) : '';
  const step = (ok: string, wait: boolean) => (ok ? <span style={css('color: #0e6027')}>อนุมัติ · {ok}</span> : wait ? <span style={css('color: #684e00')}>รอ</span> : <span style={css('color: #525252')}>—</span>);
  const IN = css(P.input);

  return (
    <>
      <PHeader crumb={`ซื้อ / ${name} / ${no}`} tag={tag}
        toggle={<Seg label="ประเภท" value={kind} disabled={!editable} onChange={setKind} options={[['PR', 'ใบขอซื้อ (PR)'], ['PO', 'ใบสั่งซื้อ (PO)']]} />} />
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>{name} {no}</h1><span style={css('font-size: 13px; color: #525252')}>{sub}</span></div>
          <div style={css('display: flex; gap: 8px')}>
            {refPr && <a href={`/purchase/orders/${refPr.id}`} style={css('height: 40px; display: inline-flex; align-items: center; padding: 0 16px; border: 1px solid #0f62fe; color: #0f62fe; text-decoration: none; font-size: 14px')}>ดู {pDocNo(refPr)}</a>}
            {id ? <ButtonLink href={`/print/purchase-order/${id}`}>ดูตัวอย่างพิมพ์</ButtonLink> : <Button disabled>ดูตัวอย่างพิมพ์</Button>}
            {/* TODO(M7): ส่งอีเมลจริง — ตอนนี้เปิดแบบพิมพ์ (PDF) ให้ส่งเอง */}
            <Button size={36} disabled={!id} onClick={() => { if (id) window.open(`/print/purchase-order/${id}`, '_blank', 'noopener'); }}>ส่ง PO ให้ผู้ขาย (อีเมล/PDF)</Button>
          </div>
        </div>

        <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <datalist id="po-vendors">{vendors.map((c) => <option key={c.id} value={label(c)} />)}</datalist>
          {/* TODO(backend): ผู้ติดต่อ/อีเมล/เลขผู้เสียภาษีของผู้ขายที่เพิ่งเลือก — GET /v1/contacts ส่งแค่ id/code/name/kind */}
          <label style={css(LABEL2)}>ผู้ขาย<input list="po-vendors" readOnly={!editable} value={vendorText} onChange={(e) => setVendorText(e.target.value)} style={IN} />
            <span style={css('font-size: 13px; color: #525252')}>เครดิต {vendorInfo?.credit_days ?? '—'} วัน · ภ.ง.ด.{vendorInfo?.tax_id ? pndOf(vendorInfo.tax_id) : '—'} · ผู้ติดต่อ {[vendorInfo?.contact_person ?? '—', vendorInfo?.email].filter(Boolean).join(' ')}</span></label>
          <label style={css(LABEL)}>วันที่สั่งซื้อ<input readOnly={!editable} value={date} onChange={(e) => setDate(e.target.value)} style={css(P.inputNum)} /></label>
          <label style={css(LABEL)}>กำหนดส่งมอบ / เริ่มบริการ<input readOnly={!editable} value={due} onChange={(e) => setDue(e.target.value)} style={css(P.inputNum)} /></label>
          {/* TODO(backend): ผู้ขอซื้อ/แผนกไม่มีฟิลด์ใน PurchaseDraftInput — เก็บใน reference */}
          <label style={css(LABEL)}>ผู้ขอซื้อ / แผนก<input readOnly={!editable} value={requester} onChange={(e) => setRequester(e.target.value)} style={IN} /></label>
          {/* TODO(backend): มิติโครงการ (fixtures dimension.project) ยังไม่มีทะเบียน/ฟิลด์ในเอกสาร — แสดงแค่ "ส่วนกลาง" */}
          <label style={css(LABEL)}>โครงการ (มิติ)<select disabled={!editable} style={IN}><option>ส่วนกลาง</option></select></label>
          {/* TODO(backend): งบประมาณ (ใช้แล้ว % ของงบ) ยังไม่มี API — แสดงบัญชีของบรรทัดแรก */}
          <label style={css(LABEL)}>งบประมาณที่ใช้<select disabled={!editable} style={IN}>{rows[0]?.account ? <option>{rows[0].account.slice(0, 7)} {accounts.find((a) => a.code === rows[0]!.account.slice(0, 7))?.name ?? ''}</option> : <option>—</option>}</select></label>
          <label style={css(LABEL)}>เงื่อนไขชำระ<select disabled={!editable} value={terms} onChange={(e) => setTerms(e.target.value)} style={IN}>{[...new Set([...TERMS, terms])].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        </section>

        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <datalist id="po-expense">{expense.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
          <table style={css('width: 100%; min-width: 900px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รายการ</th><th style={css('padding: 0 12px; font-weight: 400')}>บัญชีค่าใช้จ่าย (ตั้งต้นให้ AP)</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>จำนวน</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ราคา/หน่วย</th><th style={css('padding: 0 12px; font-weight: 400')}>VAT</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>จำนวนเงิน</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>รับบิลแล้ว</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const k = idx[i] ?? -1;
                const amount = k >= 0 && totals ? totals.lines[k]?.gross ?? '' : '';
                const acc = r.account.slice(0, 7);
                const accText = acc ? `${acc} ${accounts.find((a) => a.code === acc)?.name ?? ''}` : '';
                return (
                  <tr key={i} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}>{editable ? <input aria-label={`รายการ บรรทัด ${i + 1}`} value={r.item} onChange={(e) => set(i, 'item', e.target.value)} style={css(`${P.cellSel}; width: 100%; padding: 0 8px; box-sizing: border-box`)} /> : r.item}</td>
                    <td style={css('padding: 0 12px')}>{editable ? <input aria-label={`บัญชีค่าใช้จ่าย บรรทัด ${i + 1}`} list="po-expense" value={r.account.length > 7 ? r.account : accText.trim() || r.account} onChange={(e) => set(i, 'account', e.target.value)} style={css(`${P.cellSel}; width: 100%; padding: 0 8px; box-sizing: border-box`)} /> : accText}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{editable ? <input aria-label={`จำนวน บรรทัด ${i + 1}`} value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} style={css(`${P.cellSel}; width: 64px; padding: 0 8px; text-align: right; font-variant-numeric: tabular-nums`)} /> : r.qty}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{editable ? <input aria-label={`ราคา/หน่วย บรรทัด ${i + 1}`} value={r.price} onChange={(e) => set(i, 'price', e.target.value)} style={css(`${P.cellSel}; width: 110px; padding: 0 8px; text-align: right; font-variant-numeric: tabular-nums`)} /> : r.price}</td>
                    <td style={css('padding: 0 12px')}>{editable ? <select aria-label={`VAT บรรทัด ${i + 1}`} value={r.vat ? '1' : '0'} onChange={(e) => set(i, 'vat', e.target.value === '1')} style={css(P.cellSel)}><option value="1">7%</option><option value="0">ไม่มี</option></select> : r.vat ? '7%' : 'ไม่มี'}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(amount)}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; color: #525252')}>{money(received[i] ?? '0.00')}</td>
                  </tr>
                );
              })}
              {editable && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={7} style={css('padding: 0 12px')}><Button kind="ghost" size={32} onClick={() => setRows([...rows, blankPLine()])}>+ เพิ่มรายการ</Button></td></tr>}
            </tbody>
          </table>
        </section>

        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; justify-content: space-between')}>
          <section style={css('flex: 1 1 400px; display: flex; flex-direction: column; gap: 16px')}>
            <div style={css(`${P.box}; gap: 8px`)}><strong>สายอนุมัติ (ตามวงเงิน PO)</strong>
              <div style={css('display: flex; justify-content: space-between')}><span>1. หัวหน้าแผนก (PR)</span>{refPr ? step(pr?.doc.status === 'approved' ? ddmm(pr.doc.approved_at) : '', !!pr && pr.doc.status === 'pending_approval') : kind === 'PR' ? step(approvedAt, d?.status === 'pending_approval') : <span style={css('color: #525252')}>ไม่ต้อง</span>}</div>
              <div style={css('display: flex; justify-content: space-between')}><span>2. ผู้จัดการบัญชี (PO ≤ 300,000)</span>{kind === 'PO' ? step(approvedAt, d?.status === 'pending_approval') : <span style={css('color: #525252')}>—</span>}</div>
              <div style={css(over ? 'display: flex; justify-content: space-between' : 'display: flex; justify-content: space-between; color: #525252')}><span>3. กรรมการ (PO &gt; 300,000)</span>{over && kind === 'PO' ? step(approvedAt, d?.status === 'pending_approval') : <span>ไม่ต้อง</span>}</div>
              {/* TODO(backend): "เตือน: งบ … Q4 จะใช้ถึง N% หลังอนุมัติ PO นี้" — ยังไม่มีข้อมูลงบประมาณ */}
            </div>
            {/* TODO(backend): "ถ้ายอด AP เกิน PO มากกว่า 5% ต้องให้ผู้อนุมัติ PO ยืนยัน" และ "PO ปิดอัตโนมัติ" ยังไม่บังคับใน approvePurchase */}
            <div style={css(`${P.box}; gap: 6px`)}><strong>เมื่อบิลซื้อเข้ามา</strong><span style={css('color: #525252')}>· สร้าง AP จาก PO นี้ได้บางส่วน (ยอดค้างรับแสดงในคอลัมน์ &quot;รับบิลแล้ว&quot;) · บัญชี/VAT/มิติ ถูกเติมให้จาก PO · ถ้ายอด AP เกิน PO มากกว่า 5% ต้องให้ผู้อนุมัติ PO ยืนยัน · PO ปิดอัตโนมัติเมื่อรับบิลครบหรือกดปิดเอง</span></div>
          </section>
          <table style={css('flex: 0 1 340px; border-collapse: collapse; font-size: 15px')}><tbody>
            <tr><td style={css(P.sumTd)}>รวมก่อนภาษี</td><td style={css(P.sumNum)}>{money(totals?.net ?? d?.subtotal)}</td></tr>
            <tr><td style={css(P.sumTd)}>ภาษีมูลค่าเพิ่ม 7%</td><td style={css(P.sumNum)}>{money(totals?.vat ?? d?.vat)}</td></tr>
            <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css(P.sumTotal)}>มูลค่าสั่งซื้อ</td><td style={css(P.sumTotalNum)}>{money(grand)}</td></tr>
            {/* TODO(backend): PO ไม่มีคอลัมน์ประเภทเงินได้ในแบบร่าง และผู้ขายยังไม่มีประเภทเงินได้ตั้งต้น → ยอดคาดไว้คิดจาก wht_type ของบรรทัดเท่านั้น (PO2611-0018 ใน dev seed ไม่มี → 0.00 ไม่ใช่ 6,300.00 ตาม fixtures) */}
            <tr style={css('color: #525252; font-size: 13px')}><td style={css('height: 28px')}>หัก ณ ที่จ่ายที่คาดไว้ ({rates.join(' + ') || '—'}){wht.some((w) => w.pendingAuditor) ? <> <Pending /></> : null} — รับรู้ตอนจ่ายจริง</td><td style={css(P.sumNum)}>{money(sumWht(wht))}</td></tr>
          </tbody></table>
        </div>
        {err && <Msg msg={{ kind: 'err', text: err }} />}
        <Msg msg={msg} />
      </div>

      <div style={css(P.footerEnd)}><div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
        {d?.status === 'pending_approval' && <Button kind="danger" onClick={reject}>ปฏิเสธ</Button>}
        {editable && <Button onClick={() => void save()}>บันทึกร่าง</Button>}
        {editable && d?.status !== 'pending_approval' && <Button kind="primary" onClick={() => void act('submit')}>ส่งขออนุมัติ</Button>}
        {/* TODO(Wei): แบบร่างไม่มีปุ่มอนุมัติ PR/PO และปุ่มสร้างเอกสารถัดไป — ใช้ชื่อจากข้อความในแบบร่าง ("สร้าง AP จาก PO นี้") */}
        {d?.status === 'pending_approval' && <Button kind="primary" onClick={() => void act('approve')}>อนุมัติ</Button>}
        {d?.status === 'approved' && kind === 'PR' && <ButtonLink kind="primary" href={`/purchase/orders/new?pr=${d.id}`}>สร้าง PO จาก PR นี้</ButtonLink>}
        {d?.status === 'approved' && kind === 'PO' && <ButtonLink kind="primary" href={`/purchase/bills/new?po=${d.id}`}>สร้าง AP จาก PO นี้</ButtonLink>}
      </div></div>
    </>
  );
}
