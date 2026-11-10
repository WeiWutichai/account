'use client';
// T1 ภาษี — design/project/ScreenTax.dc.html · style คัดลอกจากแบบร่างผ่าน css() · ตัวเลขจาก props (GET /v1/tax/*) เท่านั้น
// แท็บ: แบบร่างวาดเฉพาะแท็บ ภ.พ.30 — TODO(Wei) ScreenTax.dc.html: เนื้อหาแท็บ รายงานภาษีขาย/ซื้อ · ภ.ง.ด.3/53 · 50 ทวิ ที่ออก ไม่มีในแบบร่าง
//   → ใช้ตารางมาตรฐาน (S.table) คอลัมน์ตามแบบพิมพ์ D12–D15 แทนส่วนซ้าย · ส่วนขวา (ปฏิทิน/e-Tax/RD Prep) คงเดิมทุกแท็บ
// TODO(Wei) ScreenTax.dc.html: แท็บ ภ.ง.ด.1 — v1 ไม่มีเงินเดือนในระบบ (CLAUDE.md · flag ปิด) · แท็บ e-Tax Invoice — ยังไม่มีระบบ e-Tax (M7) → แสดง "หน้านี้ยังไม่เปิดใช้"
import { buttonStyle, css, money, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import type { Branch } from '../_p2a/types';
import { TempHint } from '../_p2a/ui';
import { call } from '../sales/_lib/client';
import { Msg } from '../sales/_lib/ui';
import type { VatReport, VatRow } from './_lib/data';
import { monthAbbr, monthShort, rdPrepName, rdPrepUrl, ratePct, type Deadlines } from './_lib/fmt';

export type TabId = 'pp30' | 'sales' | 'purchases' | 'pnd3' | 'pnd53' | 'wht' | 'pnd1' | 'etax';
export interface ReviewItem { key: string; tone: 'error' | 'warning'; text: string; href: string; link: string }
export interface PndLine { certNo: string; payDate: string; name: string; taxId: string | null; income: string; rate: string; base: string; amount: string; docNo: string | null; pending: boolean }
export interface PndView { rows: PndLine[]; certs: number; base: string; tax: string; pendingAuditor: boolean }
export interface CertRow { id: string; certNo: string; pnd: '3' | '53'; payDate: string; name: string; taxId: string | null; income: string; base: string; amount: string; paymentNo: string | null; voided: boolean; pending: boolean }
interface Props {
  ym: string; tab: TabId; months: string[]; filedMonths: string[]; today: string; vat: VatReport; pnd: Record<'3' | '53', PndView>; certs: CertRow[];
  review: ReviewItem[]; missingPostcode: number; due: Deadlines;
  /** P2A สาขา: ทะเบียนสาขา (ว่าง = ปิดโมดูล → ไม่แสดงตัวกรอง) · สาขาที่กรอง */
  branches?: Branch[]; branch?: string | null;
}

const TABS: [TabId, string][] = [['pp30', 'ภ.พ.30'], ['sales', 'รายงานภาษีขาย'], ['purchases', 'รายงานภาษีซื้อ'], ['pnd3', 'ภ.ง.ด.3'], ['pnd53', 'ภ.ง.ด.53'], ['wht', '50 ทวิ ที่ออก'], ['pnd1', 'ภ.ง.ด.1'], ['etax', 'e-Tax Invoice']];
const TAB_BTN = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 36px; padding: 0 16px; background: transparent; color: #0f62fe; border: 1px solid transparent';
const NUM = 'padding: 0 16px; text-align: right; font-variant-numeric: tabular-nums';
const NO = 'height: 36px; padding: 0 16px; color: #525252; font-variant-numeric: tabular-nums';
const LINK = 'text-decoration: none';
const DOT = (c: string) => `display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: ${c}`;
const mp = (v: string): string => money(v, { paren: true });

export function TaxScreen({ ym, tab, months, filedMonths, today, vat, pnd, certs, review, missingPostcode, due, branches = [], branch = null }: Props) {
  const router = useRouter();
  const p = vat.pp30;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const filed = p.status === 'filed';
  const lastSeq = p.filings.at(-1)?.seq ?? 0;
  /** POST /v1/tax/pp30/:month/filed — ลงบัญชีตาม postOnFiled (ยื่นเพิ่มเติม = ส่วนต่าง) · วันที่ยื่น = วันนี้
   * TODO(Wei) ScreenTax.dc.html: ไม่มีช่องกรอกวันที่ยื่น/เลขอ้างอิงการชำระ — ใช้วันนี้ · "ตั้งงานจ่ายในคิว" ยังไม่มีระบบคิวงานจ่ายภาษี */
  async function file(additional: boolean) {
    if (!window.confirm(additional ? `ยื่นเพิ่มเติม ภ.พ.30 ${monthShort(ym)} (ฉบับที่ ${lastSeq + 2})?` : `บันทึกว่ายื่น ภ.พ.30 ${monthShort(ym)} แล้ว และลงบัญชีนำส่ง?`)) return;
    setBusy(true); setMsg(null);
    const r = await call<{ journalNo: string | null; amount: string }>(`tax/pp30/${ym}/filed`, 'POST', { filedAt: today, additional });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `บันทึกว่ายื่นแล้ว${r.data.journalNo ? ` · ${r.data.journalNo}` : ''}` });
    router.refresh();
  }
  const go = (q: { month?: string; tab?: TabId; branch?: string | null }) => {
    const b = q.branch === undefined ? branch : q.branch;
    const sp = new URLSearchParams({ month: q.month ?? ym, ...((q.tab ?? tab) === 'pp30' ? {} : { tab: q.tab ?? tab }), ...(b ? { branch: b } : {}) });
    router.push(`/tax?${sp.toString()}`);
  };
  // ยอดขายที่เสียภาษีอัตราร้อยละ 0 = ยอดขาย − ยกเว้น − ที่ต้องเสียภาษี (API ยังไม่แยกบรรทัด 0% · ธุรกิจบริการ v1 ไม่มียอด 0%)
  const zeroRated = p.zeroRatedSales ?? sub(sub(p.salesTotal, p.exemptSales), p.taxableSales);
  // ข้อ 10 ภาษีที่ชำระเกินยกมา = ยอดยกไปของ ภ.พ.30 เดือนก่อนที่บันทึกว่ายื่นแล้ว · ข้อ 11 = 8–9 − 10
  const carried = p.carriedForward;
  const net = p.netAfterCarry;
  const download = (form: '3' | '53') => { const a = document.createElement('a'); a.href = rdPrepUrl(ym, form); a.download = rdPrepName(ym, form); a.click(); };
  const accName: Record<string, string> = { '2150100': 'ภาษีขาย', '1170100': 'ภาษีซื้อ', '2150200': 'ภาษีมูลค่าเพิ่มค้างจ่าย' };

  return (
    <>
      <header style={css(S.topbar)}>
        <span style={css(S.crumb)}>ภาษี / เดือนภาษี {monthShort(ym)}</span>
        <select aria-label="เดือนภาษี" value={ym} onChange={(e) => go({ month: e.target.value })} style={css('height: 32px; padding: 0 12px; border: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 13px')}>
          {months.map((m) => <option key={m} value={m}>{monthShort(m)}{filedMonths.includes(m) ? ' · ยื่นแล้ว' : ''}</option>)}
        </select>
        {/* TODO(Wei): ตัวกรองสาขา ไม่มีใน ScreenTax.dc.html — แสดงเมื่อเปิดโมดูลสาขาเท่านั้น (ชั่วคราว) */}
        {branches.length > 0 && <label style={css('display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: #525252; margin-left: 8px')}><span>สาขา<TempHint /></span>
          <select aria-label="สาขา" value={branch ?? ''} onChange={(e) => go({ branch: e.target.value || null })} style={css('height: 32px; padding: 0 12px; border: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 13px')}>
            <option value="">ทุกสาขา</option>{branches.map((b) => <option key={b.code} value={b.code}>{b.code} {b.name}</option>)}
          </select></label>}
      </header>
      <div style={css(S.content)}>
        <div><h1 style={css(S.h1)}>ภาษีประจำเดือน {monthShort(ym)}</h1><span style={css(S.sub)}>ระบบรวบรวมจากเอกสารที่ลงบัญชีแล้ว · ตรวจก่อนยื่น · ส่งออกไฟล์ยื่นออนไลน์ (e-Filing) ได้ทุกแบบ</span></div>
        <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go({ tab: id })} style={css(`${TAB_BTN}${tab === id ? '; border-bottom: 2px solid #0f62fe' : ''}`)}>{label}</button>
          ))}
        </div>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section style={css('flex: 2 1 560px; display: flex; flex-direction: column; gap: 16px')}>
            {tab === 'pp30' && (
              <>
                <div style={css('border: 1px solid #e0e0e0')}>
                  <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; align-items: center')}>
                    <strong style={css('font-weight: 600')}>แบบ ภ.พ.30 — {lastSeq > 0 ? `ยื่นเพิ่มเติม (ฉบับที่ ${lastSeq + 1})` : 'ยื่นปกติ'}</strong>
                    {/* สถานะการยื่นจาก acct.tax_filing · กำหนดออนไลน์ = config tax.filing.online_extension (รอผู้สอบบัญชี) */}
                    <span style={css('display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
                      {filed ? <Tag kind="success">ยื่นแล้ว</Tag> : <Tag kind="warning">{`ร่าง · ครบกำหนด ${due.pp30}${due.online ? ' (ออนไลน์)' : ''}`}</Tag>}
                      <Tag kind="neutral">รอยืนยัน</Tag>
                    </span>
                  </div>
                  <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}><tbody>
                    <tr><td style={css(`${NO}; width: 48px`)}>1</td><td style={css('padding: 0 16px')}>ยอดขายในเดือนนี้</td><td style={css(`${NUM}; width: 160px`)}>{mp(p.salesTotal)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(NO)}>2</td><td style={css('padding: 0 16px')}>หัก ยอดขายที่เสียภาษีอัตราร้อยละ 0</td><td style={css(NUM)}>{mp(zeroRated)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(NO)}>3</td><td style={css('padding: 0 16px')}>หัก ยอดขายที่ได้รับยกเว้น</td><td style={css(NUM)}>{mp(p.exemptSales)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0; font-weight: 500')}><td style={css(NO)}>4</td><td style={css('padding: 0 16px')}>ยอดขายที่ต้องเสียภาษี</td><td style={css(NUM)}>{mp(p.taxableSales)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0; font-weight: 500')}><td style={css(NO)}>5</td><td style={css('padding: 0 16px')}>ภาษีขายเดือนนี้</td><td style={css(NUM)}>{mp(p.outputVat)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(NO)}>6</td><td style={css('padding: 0 16px')}>ยอดซื้อที่มีสิทธิ์นำภาษีซื้อมาหัก</td><td style={css(NUM)}>{mp(p.purchasesCreditable)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0; font-weight: 500')}><td style={css(NO)}>7</td><td style={css('padding: 0 16px')}>ภาษีซื้อเดือนนี้{p.priorMonthClaims.count > 0 && <> <span style={css('font-weight: 400; color: #525252; font-size: 13px')}>(รวมใบกำกับเดือนก่อนที่ขอใช้สิทธิ์ {p.priorMonthClaims.count} ใบ)</span></>}</td><td style={css(NUM)}>{mp(p.inputVat)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(NO)}>8–9</td><td style={css('padding: 0 16px')}>ภาษีที่ต้องชำระ (5 − 7) / ภาษีชำระเกิน</td><td style={css(NUM)}>{mp(p.netPayable)}</td></tr>
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(NO)}>10</td><td style={css('padding: 0 16px')}>ภาษีที่ชำระเกินยกมา</td><td style={css(NUM)}>{mp(carried)}</td></tr>
                    <tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600; font-size: 15px')}><td style={css('height: 44px; padding: 0 16px; color: #525252; font-variant-numeric: tabular-nums')}>11</td><td style={css('padding: 0 16px')}>ภาษีสุทธิที่ต้องชำระ</td><td style={css(NUM)}>{mp(net)}</td></tr>
                  </tbody></table>
                  <div style={css('display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}>
                    {/* TODO(Wei) ScreenTax.dc.html: "พิมพ์แบบ ภ.พ.30" — ไม่มีแบบร่างแบบพิมพ์ ภ.พ.30 · "ส่งออกไฟล์ยื่นออนไลน์" (ภ.พ.30) — ยังไม่มีรูปแบบไฟล์ จึงแสดงตามแบบร่างแต่ยังไม่ทำงาน
                        "ยื่นเพิ่มเติม" ใช้ได้หลังยื่นปกติแล้ว · "บันทึกว่ายื่นแล้ว + ลงบัญชีนำส่ง" = POST /v1/tax/pp30/:month/filed */}
                    <button type="button" style={buttonStyle('secondary', 36)}>พิมพ์แบบ ภ.พ.30</button>
                    <a href={`/print/vat-sales/${ym}`} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>พิมพ์รายงานภาษีขาย</a>
                    <a href={`/print/vat-purchase/${ym}`} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>พิมพ์รายงานภาษีซื้อ</a>
                    <button type="button" style={buttonStyle('secondary', 36)}>ส่งออกไฟล์ยื่นออนไลน์</button>
                    <button type="button" disabled={busy || !filed} onClick={() => void file(true)} style={buttonStyle('secondary', 36, busy || !filed)}>ยื่นเพิ่มเติม (ฉบับที่ {lastSeq + 2})</button>
                    <button type="button" disabled={busy || filed} onClick={() => void file(false)} style={buttonStyle('primary', 36, busy || filed, 'margin-left: auto')}>บันทึกว่ายื่นแล้ว + ลงบัญชีนำส่ง</button>
                  </div>
                  {msg && <div style={css('padding: 0 16px 12px')}><Msg msg={msg} /></div>}
                </div>
                <div style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
                  <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>รายการที่ควรตรวจก่อนยื่น ({review.length})</strong><a href={`/tax?month=${ym}&tab=purchases`} style={css('font-size: 14px; text-decoration: none')}>ดูรายงานภาษีซื้อเต็ม</a></div>
                  <table style={css('width: 100%; min-width: 640px; border-collapse: collapse; font-size: 14px; line-height: 20px')}><tbody>
                    {review.map((r, i) => (
                      <tr key={r.key} style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
                        <td style={css(`height: 40px; padding: 0 16px${i ? '' : '; width: 24px'}`)}><span style={css(DOT(r.tone === 'error' ? '#a2191f' : '#684e00'))}></span></td>
                        <td style={css('padding: 0 16px')}>{r.text}</td>
                        <td style={css('padding: 0 16px; text-align: right')}><a href={r.href} style={css(LINK)}>{r.link}</a></td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </>
            )}
            {branches.length > 0 && tab === 'pp30' && vat.byBranch && vat.byBranch.length > 0 && <BranchSummary vat={vat} />}
            {(tab === 'sales' || tab === 'purchases') && <VatTable rows={vat[tab].rows} base={vat[tab].base} vatSum={vat[tab].vat} purchases={tab === 'purchases'} />}
            {(tab === 'pnd3' || tab === 'pnd53') && <PndTable v={pnd[tab === 'pnd3' ? '3' : '53']} />}
            {tab === 'wht' && <CertTable rows={certs} />}
            {(tab === 'pnd1' || tab === 'etax') && <p style={css(S.note)}>หน้านี้ยังไม่เปิดใช้</p>}
          </section>
          <aside style={css('flex: 1 1 300px; display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}><strong>ปฏิทินยื่นแบบ เดือนนี้</strong>
              {/* ภ.ง.ด.1 / ประกันสังคม: v1 ไม่มีเงินเดือน → แสดงเฉพาะกำหนดยื่นตามแบบร่าง */}
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>ภ.ง.ด.1 (เงินเดือน)</span><span style={css('color: #525252; font-variant-numeric: tabular-nums')}>{due.pnd}</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>ภ.ง.ด.3 · {pnd['3'].certs} ฉบับ {money(pnd['3'].tax)}</span><span style={css('color: #525252; font-variant-numeric: tabular-nums')}>{due.pnd}</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>ภ.ง.ด.53 · {pnd['53'].certs} ฉบับ {money(pnd['53'].tax)}</span><span style={css('color: #525252; font-variant-numeric: tabular-nums')}>{due.pnd}</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>ภ.พ.30 · {mp(net)}</span><span style={css('color: #525252; font-variant-numeric: tabular-nums')}>{due.pp30}</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px; color: #525252')}><span>ประกันสังคม</span><span style={css('font-variant-numeric: tabular-nums')}>{due.sso}</span></div>
              {/* CLAUDE.md "รอผู้สอบบัญชี": ขยายกำหนดยื่นออนไลน์ยังใช้หรือไม่ → ป้าย "รอยืนยัน" · TODO(Wei) ScreenTax.dc.html: "แจ้งเตือนในคิวงานหน้าแรกล่วงหน้า 7 วัน" ยังไม่มีใน M6 */}
              <span style={css('font-size: 13px; color: #525252')}>{due.online ? 'กำหนดออนไลน์ +8 วัน คำนวณให้อัตโนมัติ · ' : ''}แจ้งเตือนในคิวงานหน้าแรกล่วงหน้า 7 วัน</span>
              <span><Tag kind="neutral">รอยืนยัน</Tag></span>
            </section>
            {/* TODO(Wei/backend) ScreenTax.dc.html: e-Tax Invoice & e-Receipt — ยังไม่มีระบบส่งสรรพากร (M7) → จำนวนแสดง "—" · ปุ่ม "ส่งใหม่" ยังไม่ทำงาน */}
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>e-Tax Invoice &amp; e-Receipt</strong>
              <div style={css('display: flex; justify-content: space-between')}><span>ออกเดือนนี้</span><span style={css('font-variant-numeric: tabular-nums')}>—</span></div>
              <div style={css('display: flex; justify-content: space-between')}><span>ส่งสรรพากรแล้ว</span><span style={css('font-variant-numeric: tabular-nums; color: #0e6027')}>—</span></div>
              <div style={css('display: flex; justify-content: space-between')}><span>รอส่ง / ผิดพลาด</span><span style={css('font-variant-numeric: tabular-nums; color: #a2191f')}>—</span></div>
              <button type="button" style={buttonStyle('secondary', 32, false, 'align-self: flex-start')}>ส่งใหม่</button>
            </section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}><strong>ไฟล์ RD Prep — ภ.ง.ด.3 / ภ.ง.ด.53 เดือน {monthAbbr(ym)}</strong>
              <span style={css('font-size: 13px; color: #525252')}>ส่งออกเป็นไฟล์ข้อความตามรูปแบบโปรแกรม RD Prep ของกรมสรรพากร (ใบแนบ + ใบหน้า) นำเข้าแล้วยื่นออนไลน์ได้ทันที · ตรวจเลขประจำตัว 13 หลัก ที่อยู่ และประเภทเงินได้ให้ก่อนส่งออก</span>
              {/* TODO(Wei) T11: รูปแบบไฟล์ RD Prep ยังไม่ได้ตรวจกับ spec/validator ของกรมสรรพากร — ห้ามใช้ยื่นจริงจนกว่าจะยืนยัน */}
              <span><Tag kind="warning">รอยืนยันรูปแบบไฟล์ (ยังไม่ผ่าน validator)</Tag></span>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 13px')}><tbody>
                <tr><td style={css('height: 28px; color: #525252')}>ภ.ง.ด.3 (บุคคลธรรมดา)</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{pnd['3'].certs} ฉบับ · {money(pnd['3'].tax)}</td><td style={css('text-align: right')}><a href={rdPrepUrl(ym, '3')} download={rdPrepName(ym, '3')} style={css(LINK)}>{rdPrepName(ym, '3')}</a></td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 28px; color: #525252')}>ภ.ง.ด.53 (นิติบุคคล)</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{pnd['53'].certs} ฉบับ · {money(pnd['53'].tax)}</td><td style={css('text-align: right')}><a href={rdPrepUrl(ym, '53')} download={rdPrepName(ym, '53')} style={css(LINK)}>{rdPrepName(ym, '53')}</a></td></tr>
                {missingPostcode > 0 && <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 28px; color: #a2191f')}>ตรวจพบ</td><td colSpan={2} style={css('text-align: right; color: #a2191f')}>{missingPostcode} ฉบับ ที่อยู่ผู้รับเงินไม่มีรหัสไปรษณีย์ — แก้ก่อนส่งออก</td></tr>}
              </tbody></table>
              <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
                <button type="button" onClick={() => { download('3'); download('53'); }} style={buttonStyle('secondary', 32)}>ส่งออก RD Prep ทั้ง 2 แบบ</button>
                <a href={`/print/pnd3/${ym}`} style={buttonStyle('secondary', 32, false, 'text-decoration: none')}>พิมพ์ใบแนบ ภ.ง.ด.3</a>
                <a href={`/print/pnd53/${ym}`} style={buttonStyle('secondary', 32, false, 'text-decoration: none')}>พิมพ์ใบแนบ ภ.ง.ด.53</a>
                {/* TODO(backend): ส่ง 50 ทวิ ทางอีเมล — ยังไม่มีระบบส่งอีเมล จึงยังไม่ทำงาน
                    TODO(Wei) ScreenTax.dc.html: ไม่มีปุ่ม "บันทึกว่ายื่นแล้ว" ของ ภ.ง.ด.3/53 — API พร้อม (POST /v1/tax/pnd/:form/:month/filed · ไม่มี JV) ต้องกำหนดตำแหน่งปุ่ม */}
                <button type="button" style={buttonStyle('secondary', 32)}>ส่ง 50 ทวิ ทางอีเมลทั้งหมด</button>
              </div>
              <span style={css('font-size: 13px; color: #525252')}>หัก ณ ที่จ่ายรับรู้เมื่อจ่ายเงินจริง — ฉบับที่ออกจากบิลซื้อที่ยังไม่จ่ายจะไม่ถูกนับในเดือนนี้</span>
            </section>
            <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; padding: 12px 16px; font-size: 13px; color: #525252')}>
              เมื่อกด &quot;ยื่นแล้ว&quot; ระบบบันทึก {p.postOnFiled.map(([side, acct, amt], i) => <Fragment key={`${side}${acct ?? i}`}>{i ? ' / ' : ''}{side} {acct ?? '—'} {acct ? accName[acct] ?? '' : ''} {money(amt)}</Fragment>)} และตั้งงานจ่ายในคิว
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}

/** P2A สาขา: ภาษีขาย/ซื้อแยกสาขา (GET /v1/tax/vat byBranch) — TODO(Wei): ชั่วคราว รอแบบร่าง · ยื่นแยก/รวม = branch.vat_filing (รอยืนยัน) */
function BranchSummary({ vat }: { vat: VatReport }) {
  return (
    <div style={css(S.tableBox)}>
      <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; font-size: 14px')}>
        <strong style={css('font-weight: 600')}>แยกตามสาขา<TempHint /></strong>
        <span style={css('color: #525252')}>{`${vat.branch ? `กรองสาขา ${vat.branch} · ` : ''}ยื่น ภ.พ.30 ${vat.vatFiling === 'combined' ? 'รวมสาขา' : 'แยกสาขา'}`} <Tag kind="warning">รอยืนยัน</Tag></span>
      </div>
      <table style={css(S.table)}>
        <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>สาขา</th><th style={css(`${S.th}; text-align: right`)}>ภาษีขาย</th><th style={css(`${S.th}; text-align: right`)}>ภาษีซื้อ</th><th style={css(`${S.th}; text-align: right`)}>สุทธิ</th></tr></thead>
        <tbody>{(vat.byBranch ?? []).map((b) => (
          <tr key={b.branch} style={css(S.tr)}><td style={css('height: 40px; padding: 0 12px')}>{b.branch}</td><td style={css(S.num)}>{mp(b.outputVat)}</td><td style={css(S.num)}>{mp(b.inputVat)}</td><td style={css(S.num)}>{mp(b.netPayable)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function sub(a: string, b: string): string {
  const c = (v: string): bigint => { const n = v.startsWith('-'); const [i = '0', f = ''] = (n ? v.slice(1) : v).split('.'); const x = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2)); return n ? -x : x; };
  const r = c(a) - c(b);
  const s = (r < 0n ? -r : r).toString().padStart(3, '0');
  return `${r < 0n ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

function VatTable({ rows, base, vatSum, purchases }: { rows: VatRow[]; base: string; vatSum: string; purchases: boolean }) {
  return (
    <div style={css(S.tableBox)}>
      <table style={css(`${S.table}; min-width: 860px`)}>
        <thead><tr style={css(S.theadRow)}>
          <th style={css(S.thFirst)}>ลำดับ</th><th style={css(S.th)}>วัน เดือน ปี</th><th style={css(S.th)}>เลขที่ใบกำกับภาษี</th>
          <th style={css(S.th)}>{purchases ? 'ชื่อผู้ขายสินค้า/ผู้ให้บริการ' : 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ'}</th><th style={css(S.th)}>เลขประจำตัวผู้เสียภาษีอากร</th>
          {purchases && <th style={css(S.th)}>เลขที่อ้างอิงภายใน</th>}
          <th style={css(`${S.th}; text-align: right`)}>มูลค่าสินค้าหรือบริการ</th><th style={css(`${S.th}; text-align: right`)}>จำนวนเงินภาษีมูลค่าเพิ่ม</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.docId} style={css(S.tr)}>
              <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{i + 1}</td><td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.date)}</td>
              <td style={css(S.td)}>{purchases ? (r.vendorRef ?? '') : r.docNo}{r.rate === '0' && <span style={css('font-size: 12px; color: #525252')}> 0% ส่งออก<TempHint /></span>}</td><td style={css(S.td)}>{r.partner}</td><td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{r.taxId ?? ''}</td>
              {purchases && <td style={css(S.td)}>{r.docNo}</td>}
              <td style={css(S.num)}>{mp(r.base)}</td><td style={css(S.num)}>{mp(r.vat)}</td>
            </tr>
          ))}
          <tr style={css(S.tfoot)}><td colSpan={purchases ? 6 : 5} style={css('height: 40px; padding: 0 12px; text-align: right')}>รวม</td><td style={css(S.num)}>{mp(base)}</td><td style={css(S.num)}>{mp(vatSum)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function PndTable({ v }: { v: PndView }) {
  return (
    <div style={css(S.tableBox)}>
      <table style={css(`${S.table}; min-width: 860px`)}>
        <thead><tr style={css(S.theadRow)}>
          <th style={css(S.thFirst)}>ลำดับ</th><th style={css(S.th)}>ชื่อผู้มีเงินได้</th><th style={css(S.th)}>เลขประจำตัวผู้เสียภาษีอากร</th><th style={css(S.th)}>วัน เดือน ปี ที่จ่าย</th>
          <th style={css(S.th)}>ประเภทเงินได้พึงประเมินที่จ่าย</th><th style={css(`${S.th}; text-align: right`)}>อัตราภาษี ร้อยละ</th><th style={css(`${S.th}; text-align: right`)}>จำนวนเงินที่จ่าย</th><th style={css(`${S.th}; text-align: right`)}>ภาษีที่หักและนำส่ง</th>
        </tr></thead>
        <tbody>
          {v.rows.map((r, i) => (
            <tr key={r.certNo} style={css(S.tr)}>
              <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{i + 1}</td><td style={css(S.td)}>{r.name}</td><td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{r.taxId ?? ''}</td>
              <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.payDate)}</td>
              <td style={css(S.td)}>{r.income}{r.pending ? <> <Tag kind="neutral">รอยืนยัน</Tag></> : null}</td>
              <td style={css(S.num)}>{ratePct(r.rate)}</td><td style={css(S.num)}>{money(r.base)}</td><td style={css(S.num)}>{money(r.amount)}</td>
            </tr>
          ))}
          <tr style={css(S.tfoot)}><td colSpan={6} style={css('height: 40px; padding: 0 12px; text-align: right')}>รวม {v.certs} ฉบับ</td><td style={css(S.num)}>{money(v.base)}</td><td style={css(S.num)}>{money(v.tax)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function CertTable({ rows }: { rows: CertRow[] }) {
  return (
    <div style={css(S.tableBox)}>
      <table style={css(`${S.table}; min-width: 1040px; white-space: nowrap`)}>
        <thead><tr style={css(S.theadRow)}>
          <th style={css(S.thFirst)}>เลขที่</th><th style={css(S.th)}>วันที่จ่าย</th><th style={css(S.th)}>แบบ</th><th style={css(S.th)}>ผู้ถูกหักภาษี</th><th style={css(S.th)}>ประเภทเงินได้</th>
          <th style={css(S.th)}>เอกสารการจ่าย</th><th style={css(`${S.th}; text-align: right`)}>จำนวนเงินที่จ่าย</th><th style={css(`${S.th}; text-align: right`)}>ภาษีที่หัก</th><th style={css(S.th)}>สถานะ</th>
        </tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} style={css(S.tr)}>
              <td style={css('height: 40px; padding: 0 12px')}><a href={`/print/wht50/${c.id}`} style={css('text-decoration: none; font-weight: 500')}>{c.certNo}</a></td>
              <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(c.payDate)}</td><td style={css(S.td)}>ภ.ง.ด.{c.pnd}</td><td style={css(S.td)}>{c.name}</td><td style={css(S.td)}>{c.income}</td>
              <td style={css(S.td)}>{c.paymentNo ?? ''}</td><td style={css(S.num)}>{money(c.base)}</td><td style={css(S.num)}>{money(c.amount)}</td>
              <td style={css(S.td)}>{c.voided ? <Tag kind="error">ยกเลิกแล้ว</Tag> : c.pending ? <Tag kind="neutral">รอยืนยัน</Tag> : <Tag kind="success">ออกแล้ว</Tag>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
