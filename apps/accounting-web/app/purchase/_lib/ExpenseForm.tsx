'use client';
// P3 ค่าใช้จ่าย (EXP) — design/project/ScreenExpense.dc.html (Sidebar active="expense")
// จ่ายทันที (Cash[EXP]) = จุดรับรู้ WHT → ออก 50 ทวิ ตอนอนุมัติ · ตั้งค้างจ่าย (Credit[EXP]) = หักตอนจ่ายด้วยใบสำคัญจ่าย
// ฟรีแลนซ์พัฒนาซอฟต์แวร์ = ค่าตั้งบริษัท "รอยืนยัน" (CLAUDE.md) · ถ้าตั้งเป็น progressive backend ปฏิเสธการอนุมัติ — แสดงข้อความตามที่ได้รับ
import { Button, ButtonLink, css, money, parseThaiDate, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '../../sales/_lib/client.ts';
import { addDays } from '../../sales/_lib/doc.ts';
import { fromCents, toCents } from '../../sales/_lib/num.ts';
import { Msg } from '../../sales/_lib/ui';
import { accCode, blankPLine, netLines, pLinePayload, type PLineRow, pRowFromLine, usePTotals, validP } from './lines.ts';
import { PJournal } from './PJournal';
import { type Account, type Cert, certsOf, monthBE, pct, pDocNo, type PContact, type PDetail, pndOf, personText, pStatusTag, type WhtTypeDef, whtOptionText } from './types.ts';
import { docAction, P, PHeader, Pending } from './ui';
import { expectedWht, sumWht, type WhtPreview } from './wht.ts';

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const LABEL2 = 'grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const CELL = 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; padding: 0 8px; box-sizing: border-box';
const CHEQUE = 'cheque';

export function ExpenseForm({ detail, vendors, accounts, whtTypes, names, today }: {
  detail: PDetail | null; vendors: PContact[]; accounts: Account[]; whtTypes: Record<string, WhtTypeDef>; names: Record<string, string>; today: string;
}) {
  const router = useRouter();
  const d = detail?.doc ?? null;
  const editable = !d || d.status === 'draft' || d.status === 'pending_approval';
  const shown = (c: PContact) => `${c.name}${c.tax_id ? ` · ${personText(c.tax_id)}` : ''}`;
  const payAccounts = accounts.filter((a) => /^1(000|100)\d{3}$/u.test(a.code) && a.active && !a.is_control);

  const [id, setId] = useState<string | null>(d?.id ?? null);
  const [payeeText, setPayeeText] = useState(detail?.contact ? shown(detail.contact) : '');
  const [date, setDate] = useState(thaiDate(d?.issue_date ?? today));
  const [payNow, setPayNow] = useState(d ? d.pay_now : true);
  const [payFrom, setPayFrom] = useState(d?.receive_account ?? payAccounts.find((a) => a.code === '1100100')?.code ?? payAccounts[0]?.code ?? '');
  const [vendorRef, setVendorRef] = useState(d?.vendor_ref ?? '');
  const [rows, setRows] = useState<PLineRow[]>(detail?.lines.filter((l) => l.line_type === 'item').map(pRowFromLine) ?? [blankPLine(false)]);
  const [emailCert, setEmailCert] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { totals, idx, err } = usePTotals(rows);
  // จับคู่ชื่อยาวสุดก่อน (ชื่อหนึ่งอาจเป็นคำนำหน้าของอีกชื่อ)
  const payee = [...vendors].sort((a, b) => b.name.length - a.name.length).find((c) => payeeText === c.name || payeeText.startsWith(`${c.name} `) || payeeText === `${c.code} · ${c.name}`) ?? null;
  const pInfo = payee && detail?.contact?.id === payee.id ? detail.contact : payee;
  const expense = accounts.filter((a) => a.type === 'expense' && a.active);
  const iso = parseThaiDate(date);
  const net = netLines(rows, totals, idx);
  const posted = d?.status === 'posted';
  const certs: Cert[] = detail ? certsOf(detail) : [];
  const wht: (WhtPreview | Cert)[] = posted && payNow ? certs : expectedWht(net, whtTypes);
  const whtSum = posted && payNow ? (d?.wht ?? '0.00') : sumWht(wht);
  const grand = totals?.grandTotal ?? d?.grand_total ?? null;
  const rateText = [...new Set(wht.map((w) => `${pct(w.rate)}%`))].join(' + ');
  const pnd = pInfo?.tax_id ? pndOf(pInfo.tax_id) : null;
  // กำหนดยื่น ภ.ง.ด.: วันที่ 7 ของเดือนถัดไป · ยื่นออนไลน์ +8 วัน (วันที่ 15) — ค่าตั้ง tax.filing.online_extension รอผู้สอบบัญชี (ค่าตั้งต้น true)
  // TODO(backend): ไม่มี GET ค่าตั้งบริษัท (company-settings) → ใช้ค่าตั้งต้นชั่วคราว true ตาม CLAUDE.md
  const nextMonth = iso ? addDays(`${iso.slice(0, 8)}01`, 32).slice(0, 8) : null;
  const deadline = nextMonth ? `15 ${thaiMonth(Number(nextMonth.slice(5, 7)))}` : '—';

  const payload = () => ({
    docType: 'EXP' as const, contactId: payee?.id ?? '', issueDate: iso ?? '', dueDate: d?.due_date ?? null, vendorRef: vendorRef.trim() || null, priceInclVat: false,
    payNow, payFrom: payNow ? payFrom : null, notes: d?.notes ?? null, reference: d?.reference ?? null, lines: rows.filter(validP).map(pLinePayload),
  });
  async function save(quiet = false): Promise<string | null> {
    if (!editable) return id;
    if (!payee) { setMsg({ kind: 'err', text: 'เลือกผู้รับเงินจากรายการ' }); return null; }
    if (!iso) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    // TODO(Wei): "จ่ายจาก: เช็ค" (ScreenExpense.dc.html) — EXP จ่ายทันทียังรับเฉพาะบัญชีเงินสด/ธนาคาร (backend ไม่มีข้อมูลเช็คใน PurchaseDraftInput) · ข้อความนี้ไม่มีในแบบร่าง
    if (payNow && payFrom === CHEQUE) { setMsg({ kind: 'err', text: 'จ่ายด้วยเช็คให้ทำผ่านใบสำคัญจ่าย (ตั้งค้างจ่ายก่อน)' }); return null; }
    if (rows.some((r) => r.item.trim() && !validP(r))) { setMsg({ kind: 'err', text: 'กรอกจำนวนเงินของทุกบรรทัดให้ถูกต้อง' }); return null; }
    const r = await call<{ id: string }>(id ? `purchases/${id}` : 'purchases', id ? 'PUT' : 'POST', payload());
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return null; }
    if (!quiet) setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    if (!id) { setId(r.data.id); router.replace(`/purchase/expenses/${r.data.id}`); } else router.refresh();
    return r.data.id;
  }
  async function approve() {
    const docId = await save(true);
    if (!docId) return;
    const r = await docAction<{ docNo: string; journalNo?: string; certificates?: Cert[] }>(docId, 'approve');
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); if (!id) router.replace(`/purchase/expenses/${docId}`); return; }
    const c = r.data.certificates ?? [];
    setMsg({ kind: 'ok', text: `บันทึกแล้ว ${r.data.docNo}${r.data.journalNo ? ` · ลงบัญชี ${r.data.journalNo}` : ''}${c.length ? ` · 50 ทวิ ${c.map((x) => x.certNo).join(', ')}` : ''}` });
    if (!id) router.replace(`/purchase/expenses/${docId}`); else router.refresh();
  }

  // จำนวนเงินต่อบรรทัด: EXP ไม่มีคอลัมน์จำนวน/ราคา (แบบร่าง) → จำนวน 1 × ราคา = จำนวนเงิน
  const set = (i: number, k: keyof PLineRow, v: string | boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v, ...(k === 'price' ? { qty: '1' } : {}) } : r)));
  const no = d ? pDocNo(d) : 'ใหม่';
  const tag = d ? pStatusTag(d, today, d.pay_now ? '0.00' : null) : { kind: 'info' as const, text: 'ร่าง' };
  const IN = css(P.input);

  return (
    <>
      <PHeader crumb={`ซื้อ / ค่าใช้จ่าย / ${no}`} tag={tag} />
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ค่าใช้จ่าย {no}</h1>
            <span style={css('font-size: 13px; color: #525252')}>{payNow ? 'จ่ายทันที · ออกหนังสือรับรองหัก ณ ที่จ่ายอัตโนมัติ' : 'ตั้งค้างจ่าย'}</span></div>
          {/* TODO(backend): อัปโหลดบิล/OCR ยังไม่มี API */}
          <Button size={36} disabled={!editable}>อัปโหลดบิล (OCR เติมให้)</Button>
        </div>

        <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <datalist id="exp-payees">{vendors.map((c) => <option key={c.id} value={c.name}>{c.code}</option>)}</datalist>
          {/* TODO(backend): เลขประจำตัวผู้เสียภาษีของผู้รับเงินที่เพิ่งเลือก — GET /v1/contacts ไม่ส่ง tax_id */}
          <label style={css(LABEL2)}>จ่ายให้<input list="exp-payees" readOnly={!editable} value={payeeText} onChange={(e) => setPayeeText(e.target.value)} style={IN} />
            <span style={css('font-size: 13px; color: #525252')}>ภ.ง.ด.{pnd ?? '—'} · เลขประจำตัว {pInfo?.tax_id ?? '—'}</span></label>
          <label style={css(LABEL)}>วันที่จ่าย<input readOnly={!editable} value={date} onChange={(e) => setDate(e.target.value)} style={css(P.inputNum)} /></label>
          <label style={css(LABEL)}>จ่ายจาก<select disabled={!editable || !payNow} value={payFrom} onChange={(e) => setPayFrom(e.target.value)} style={IN}>
            {payAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}<option value={CHEQUE}>เช็ค</option></select></label>
          <label style={css(LABEL2)}>เอกสารอ้างอิงจากผู้รับเงิน<input readOnly={!editable} value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} style={IN} /></label>
          {/* TODO(backend): มิติโครงการ (fixtures EXP2611-0019.dimension.project = PRJ-07) ยังไม่มีทะเบียน/ฟิลด์ */}
          <label style={css(LABEL)}>โครงการ (มิติ)<select disabled={!editable} style={IN}><option>ส่วนกลาง</option></select></label>
          <label style={css(LABEL)}>สูตรลงบัญชี<select disabled={!editable} value={payNow ? 'Cash[EXP]' : 'Credit[EXP]'} onChange={(e) => setPayNow(e.target.value === 'Cash[EXP]')} style={IN}><option value="Cash[EXP]">Cash[EXP] จ่ายทันที</option><option value="Credit[EXP]">Credit[EXP] ตั้งค้างจ่าย</option></select></label>
        </section>

        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <datalist id="exp-expense">{expense.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
          <table style={css('width: 100%; min-width: 820px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รายการ</th><th style={css('padding: 0 12px; font-weight: 400')}>บัญชีค่าใช้จ่าย</th><th style={css('padding: 0 12px; font-weight: 400')}>ภาษีซื้อ</th><th style={css('padding: 0 12px; font-weight: 400')}>หัก ณ ที่จ่าย</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>จำนวนเงิน</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const acc = accCode(r.account) ?? '';
                const accText = acc ? `${acc} ${names[acc] ?? ''}`.trim() : '';
                const t = r.wht ? whtTypes[r.wht] : undefined;
                return (
                  <tr key={i} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}>{editable ? <input aria-label={`รายการ บรรทัด ${i + 1}`} value={r.item} onChange={(e) => set(i, 'item', e.target.value)} style={css(`${CELL}; width: 100%`)} /> : r.item}</td>
                    <td style={css('padding: 0 12px')}>{editable ? <input aria-label={`บัญชีค่าใช้จ่าย บรรทัด ${i + 1}`} list="exp-expense" value={r.account.length > 7 ? r.account : accText || r.account} onChange={(e) => set(i, 'account', e.target.value)} style={css(`${CELL}; width: 100%`)} /> : accText}</td>
                    <td style={css('padding: 0 12px')}>{editable ? <select aria-label={`ภาษีซื้อ บรรทัด ${i + 1}`} value={r.vat ? '1' : '0'} onChange={(e) => set(i, 'vat', e.target.value === '1')} style={css(P.cellSel)}><option value="0">ไม่มี</option><option value="1">7%</option></select> : r.vat ? '7%' : 'ไม่มี'}</td>
                    {/* TODO(Wei): แบบร่างให้เลือก "3% ม.40(2) ค่ารับทำงานให้" / "3% ม.40(8) ค่าจ้างทำของ/ค่าบริการ" ต่อบรรทัด แต่ CLAUDE.md กำหนดให้ประเภทเงินได้ของฟรีแลนซ์เป็นค่าตั้งบริษัทที่รอผู้สอบบัญชี → ตัวเลือกมาจาก GET /v1/wht-types (ป้าย "รอยืนยัน") */}
                    <td style={css('padding: 0 12px')}>{editable
                      ? <select aria-label="อัตราหัก" value={r.wht} onChange={(e) => set(i, 'wht', e.target.value)} style={css(P.cellSel)}>{Object.values(whtTypes).map((w) => <option key={w.key} value={w.key}>{whtOptionText(w)}{w.status === 'PENDING_AUDITOR' ? ' · รอยืนยัน' : ''}</option>)}<option value="">ไม่หัก</option></select>
                      : <span style={css(t ? '' : 'color: #525252')}>{t ? whtOptionText(t) : 'ไม่หัก'}</span>}{t?.status === 'PENDING_AUDITOR' && <> <Pending /></>}</td>
                    <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{editable ? <input aria-label={`จำนวนเงิน บรรทัด ${i + 1}`} value={r.price} onChange={(e) => set(i, 'price', e.target.value)} style={css(`${CELL}; width: 120px; text-align: right; font-variant-numeric: tabular-nums`)} /> : money(detail?.lines.filter((l) => l.line_type === 'item')[i]?.amount)}</td>
                  </tr>
                );
              })}
              {editable && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={5} style={css('padding: 0 12px')}><Button kind="ghost" size={32} onClick={() => setRows([...rows, blankPLine(false)])}>+ เพิ่มรายการ</Button></td></tr>}
            </tbody>
          </table>
        </section>

        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; justify-content: space-between')}>
          <section style={css('flex: 1 1 380px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
            <strong>หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</strong>
            {!wht.length && <span style={css('color: #525252')}>—</span>}
            {wht.map((w) => {
              const no2 = 'certNo' in w ? w.certNo : null;
              const p = 'pnd' in w ? w.pnd : pnd;
              return (
                // TODO(Wei): ข้อความของ EXP ตั้งค้างจ่าย ("ออกเมื่อจ่ายด้วยใบสำคัญจ่าย") ไม่มีในแบบร่าง
                <span key={w.type} style={css('color: #525252')}>
                  {payNow || no2 ? <>{no2 ? `เลขที่ ${no2} ` : ''}ออกอัตโนมัติเมื่อบันทึก</> : 'ออกเมื่อจ่ายด้วยใบสำคัญจ่าย'} · ภ.ง.ด.{p ?? '—'}{w.section ? ` · ม.${w.section}` : ''}{w.pendingAuditor && <> <Pending /></>} · {pct(w.rate)}% ของ {money(w.base)} = {money(w.amount)} · รวมใน ภ.ง.ด.{p ?? '—'} เดือน {iso ? monthBE(iso) : '—'} ยื่นออนไลน์ภายใน {deadline} <Pending />
                </span>
              );
            })}
            {/* TODO(M7): ส่งอีเมลจริง — ยังไม่มี API ส่ง 50 ทวิ */}
            <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={emailCert} onChange={(e) => setEmailCert(e.target.checked)} /> ส่ง PDF ให้ผู้รับเงินทางอีเมล</label>
            {/* TODO(M5): แบบพิมพ์ 50 ทวิ (PrintWht50.dc.html) เป็นของ app/print (agent อื่น) — /print/wht50/<id เอกสารจ่าย> */}
            {id ? <a href={`/print/wht50/${id}`} style={css('font-size: 14px; text-decoration: none')}>ดูตัวอย่างหนังสือรับรอง 50 ทวิ</a> : <span style={css('font-size: 14px; color: #525252')}>ดูตัวอย่างหนังสือรับรอง 50 ทวิ</span>}
          </section>
          <table style={css('flex: 0 1 340px; border-collapse: collapse; font-size: 15px')}><tbody>
            <tr><td style={css(P.sumTd)}>รวมค่าใช้จ่าย</td><td style={css(P.sumNum)}>{money(grand)}</td></tr>
            <tr><td style={css(P.sumTd)}>หัก ณ ที่จ่าย {rateText || '—'}{payNow ? '' : ' ตอนจ่าย'}</td><td style={css(P.sumNum)}>{money(fromCents(-toCents(whtSum)), { paren: true })}</td></tr>
            <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css(P.sumTotal)}>จ่ายจริง</td><td style={css(P.sumTotalNum)}>{money(grand ? fromCents(toCents(grand) - toCents(whtSum)) : null)}</td></tr>
          </tbody></table>
        </div>
        {err && <Msg msg={{ kind: 'err', text: err }} />}
        <PJournal note={`สูตร ${payNow ? 'Cash[EXP]' : 'Credit[EXP]'}${detail?.journal[0] ? ` · ${detail.journal[0].journal_no}` : ''}`} names={names} posted={detail?.journal.length ? detail.journal : null}
          source={{ rule: payNow ? 'Cash[EXP]' : 'Credit[EXP]', docType: 'EXP', cash: payNow && payFrom !== CHEQUE ? payFrom : null,
            amounts: totals ? { grand_total: totals.grandTotal, vat: totals.vat, ...(payNow ? { wht: whtSum, paid: fromCents(toCents(totals.grandTotal) - toCents(whtSum)) } : {}) } : null,
            lines: net.map((l) => ({ amount: l.amount, account: l.account })) }} />
        <Msg msg={msg} />
      </div>

      <div style={css(P.footerEnd)}><div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
        {/* TODO(Wei): ปุ่มของค่าใช้จ่ายที่บันทึกแล้ว และของแบบตั้งค้างจ่าย ไม่มีในแบบร่าง — ใช้ชื่อจาก ScreenDocVoid / ScreenPurchaseBill */}
        {posted && <ButtonLink kind="danger" href={`/finance/docs/${d!.id}/void`}>ยกเลิกเอกสาร</ButtonLink>}
        {editable && <Button onClick={() => void save()}>บันทึกร่าง</Button>}
        {editable && <Button kind="primary" onClick={() => void approve()}>{payNow ? 'บันทึกและจ่าย' : 'อนุมัติและตั้งหนี้'}</Button>}
      </div></div>
    </>
  );
}
