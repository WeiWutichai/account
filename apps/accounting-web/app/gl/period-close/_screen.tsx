'use client';
// B5 ปิดงวดบัญชี — design/project/ScreenPeriodClose.dc.html
// สถานะงวดจาก GET /v1/periods · ปิด = POST /v1/periods/:year/:no/close {to} (open → soft_closed → hard_closed ตามลำดับ · backend ตรวจงวดก่อนหน้า/ร่าง)
// กำไร(ขาดทุน)รายงวด = กำไรสะสมถึงงวด n − ถึงงวด n−1 จาก GET /v1/reports/statements
// TODO(Wei) ScreenPeriodClose.dc.html: แบบร่างไม่มีปุ่ม "เปิดงวดคืน" (มีแต่ "ประวัติการเปิดงวดย้อนหลัง") — backend พร้อม (POST periods/:year/:no/reopen {reason} เฉพาะเจ้าของ + audit) · ต้องกำหนดตำแหน่งปุ่ม/ช่องกรอกเหตุผล
// TODO(Wei) ScreenPeriodClose.dc.html: แบบร่างไม่มีปุ่ม "ปิดปี" (POST periods/:year/year-end ลงงวด 13) — กล่อง "ปิดปีบัญชี (เตรียมการ)" แสดงตามแบบร่างเท่านั้น
// TODO(Wei) ScreenPeriodClose.dc.html: บรรทัด "ภาษีเงินได้นิติบุคคลค้างจ่าย" ในตัวอย่างปิดปี — ยอดประมาณการภาษีเงินได้ต้องให้ผู้สอบบัญชีกำหนด (backend ไม่ได้คำนวณ) จึงแสดง "—"
// คอลัมน์ ภ.พ.30 / ภ.ง.ด. = acct.tax_filing · ปิดโดย = public.app_user · "ยืนยันทบทวนแล้ว" = POST periods/:year/:no/accrual-reviewed
// TODO(Wei) ScreenPeriodClose.dc.html: รายการปรับปรุงผู้สอบบัญชี / ภ.ง.ด.50 / ภ.ง.ด.51 · "พิมพ์ชุดรายงานปิดงวด" — ยังไม่มีข้อมูล/แบบพิมพ์ (ไม่มีระบบบันทึกรายการผู้สอบบัญชีและการยื่น ภ.ง.ด.50/51)
import { buttonStyle, css, money, Tag, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { call } from '../../sales/_lib/client';
import { sumMoney } from '../../sales/_lib/num';
import { Msg } from '../../sales/_lib/ui';

type Status = 'open' | 'soft_closed' | 'hard_closed';
type Filing = 'filed' | 'draft' | null;
export interface PeriodRow { no: number; status: Status; closedAt: string | null; closedBy: string | null; drafts: number; profit: string | null; bank: { ok: boolean; diff: string; account: string } | null; pp30: Filing; pnd: Filing }
/** action = path ของ accounting-api ที่ปุ่ม (button) เรียก (POST) */
export interface Check { mark: 'ok' | 'x' | 'warn' | 'na'; text: string; right: string; href?: string; button?: string; action?: string }
interface Props { year: number; current: number; rows: PeriodRow[]; checks: Check[]; reopens: { at: string; period: string; reason: string }[]; yearEnd: { revenue: string; expense: string; profit: string } }

const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const MARK: Record<Check['mark'], [string, string]> = { ok: ['✓', '#0e6027'], x: ['✕', '#a2191f'], warn: ['!', '#684e00'], na: ['—', '#525252'] };
const ddmm = (ts: string | null) => (ts ? thaiDate(new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })).slice(0, 5) : '');

function StatusTag({ status, label }: { status: Status; label?: string }) {
  if (status === 'hard_closed') return <Tag kind="neutral">{label ?? 'ปิดแข็ง'}</Tag>;
  if (status === 'soft_closed') return <Tag kind="info">{label ?? 'ปิดอ่อน'}</Tag>;
  return <Tag kind="warning">{label ?? 'เปิด'}</Tag>;
}
/** Tag แบบ neutral ที่มีจุด (แบบร่างใช้จุดกับ "ปิดแข็ง" ด้วย) */
function Dot({ text, tone }: { text: string; tone: string }) {
  return <span style={css(`display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; ${tone}; font-size: 13px; font-weight: 500`)}><span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')} />{text}</span>;
}
const TONE: Record<Status, string> = { hard_closed: 'background: #e0e0e0; color: #161616', soft_closed: 'background: #edf5ff; color: #0043ce', open: 'background: #fcf4d6; color: #684e00' };
const LABEL: Record<Status, string> = { hard_closed: 'ปิดแข็ง', soft_closed: 'ปิดอ่อน', open: 'เปิด' };
const FILING: Record<'filed' | 'draft', string> = { filed: 'ยื่นแล้ว', draft: 'ร่าง' };
/** ปิดโดย: ชื่อผู้ปิด + วันที่ (แบบร่าง "[ผู้จัดการบัญชี] 25/10") */
const closer = (r: PeriodRow) => [r.closedBy ?? '', ddmm(r.closedAt)].filter(Boolean).join(' ');

export function PeriodCloseScreen({ year, current, rows, checks, reopens, yearEnd }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const month = (n: number) => `${thaiMonth(n)} ${year}`;
  const blocking = checks.filter((c) => c.mark === 'x').length;
  const passed = checks.filter((c) => c.mark === 'ok').length;
  const cur = rows.find((r) => r.no === current);
  const months = rows.filter((r) => r.no <= 12);
  const firstOpen = months.find((r) => r.status === 'open')?.no ?? null;
  const firstSoft = months.find((r) => r.status === 'soft_closed')?.no ?? null;
  // ยุบงวดปิดแข็งต่อเนื่องตั้งแต่ ม.ค. (เว้นงวดล่าสุดไว้แสดงแยก) — ตามแบบร่าง "ม.ค. – ส.ค."
  let lastHard = 0;
  while (months[lastHard]?.status === 'hard_closed') lastHard++;
  const grouped = lastHard >= 3 ? months.slice(0, lastHard - 1) : [];
  const rest = months.slice(grouped.length);
  const p13 = rows.find((r) => r.no === 13);
  const decHard = months.find((r) => r.no === 12)?.status === 'hard_closed';

  async function close(no: number, to: 'soft_closed' | 'hard_closed') {
    if (!window.confirm(`${to === 'soft_closed' ? 'ปิดอ่อน' : 'ปิดแข็ง'} ${month(no)}?`)) return;
    setBusy(true); setMsg(null);
    const r = await call<{ ok: boolean }>(`periods/${year}/${no}/close`, 'POST', { to });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `${to === 'soft_closed' ? 'ปิดอ่อน' : 'ปิดแข็ง'} ${month(no)} แล้ว` });
    router.refresh();
  }
  async function runAction(c: Check) {
    if (!c.action) return;
    setBusy(true); setMsg(null);
    const r = await call<{ ok: boolean }>(c.action, 'POST', {});
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    router.refresh();
  }

  function action(r: PeriodRow) {
    if (r.status === 'soft_closed' && r.no === firstSoft) return <button type="button" disabled={busy} onClick={() => void close(r.no, 'hard_closed')} style={buttonStyle('secondary', 32, busy)}>ปิดแข็ง</button>;
    if (r.status === 'open' && r.no === firstOpen && r.no <= current) {
      const off = busy || (r.no === current && blocking > 0);
      return <button type="button" disabled={off} onClick={() => void close(r.no, 'soft_closed')} style={buttonStyle('secondary', 32, off)}>ปิดอ่อน</button>;
    }
    return null;
  }
  const bankCell = (r: PeriodRow) => (r.bank ? (r.bank.ok ? 'ครบ' : `ผลต่าง ${money(r.bank.diff)}`) : '—');

  const profit = yearEnd.profit;
  const loss = profit.startsWith('-');
  const absProfit = loss ? profit.slice(1) : profit;
  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>บัญชี / ปิดงวด / ปีบัญชี {year}</span>
        {cur && <StatusTag status={cur.status} label={`${month(current)} ${cur.status === 'open' ? 'เปิดอยู่' : LABEL[cur.status]}`} />}
      </header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ปิดงวดบัญชี</h1><span style={css('font-size: 13px; color: #525252')}>ปิดอ่อน (soft) = ล็อกผู้ใช้ทั่วไป ผู้จัดการบัญชียังแก้ได้ · ปิดแข็ง (hard) = ล็อกทุกคน แก้ได้เฉพาะด้วยรายการปรับปรุงในงวดถัดไป · บันทึกข้ามปีได้โดยไม่ต้องปิดปีก่อน</span></div>
        <Msg msg={msg} />
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 880px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
              <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>งวด</th><th style={css('padding: 0 12px; font-weight: 400')}>สถานะ</th><th style={css('padding: 0 12px; font-weight: 400')}>ภ.พ.30</th><th style={css('padding: 0 12px; font-weight: 400')}>ภ.ง.ด.</th><th style={css('padding: 0 12px; font-weight: 400')}>กระทบยอดธนาคาร</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>กำไร(ขาดทุน)</th><th style={css('padding: 0 12px; font-weight: 400')}>ปิดโดย</th><th style={css('padding: 0 12px; font-weight: 400')}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การดำเนินการ</span></th>
            </tr></thead>
            <tbody>
              {grouped.length > 0 && (
                <tr style={css('border-top: 1px solid #e0e0e0; color: #525252')}>
                  <td style={css('height: 40px; padding: 0 12px')}>{thaiMonth(grouped[0]!.no)} – {month(grouped.at(-1)!.no)}</td>
                  <td style={css(TD)}><Dot text="ปิดแข็ง" tone={TONE.hard_closed} /></td>
                  <td style={css(TD)}>{grouped.every((g) => g.pp30 === 'filed') ? 'ยื่นแล้ว' : '—'}</td><td style={css(TD)}>{grouped.every((g) => g.pnd !== 'draft') && grouped.some((g) => g.pnd === 'filed') ? 'ยื่นแล้ว' : '—'}</td>
                  <td style={css(TD)}>{grouped.every((g) => !g.bank) ? '—' : grouped.every((g) => !g.bank || g.bank.ok) ? 'ครบ' : 'มีผลต่าง'}</td>
                  <td style={css(NUM)}>{money(sumMoney(grouped.map((g) => g.profit)), { paren: true })}</td>
                  <td style={css(TD)}>{closer(grouped.at(-1)!)}</td><td style={css(TD)}></td>
                </tr>
              )}
              {rest.map((r) => {
                const isCur = r.no === current;
                const future = r.no > current;
                const label = r.status === 'open' && future && r.drafts > 0 ? `เปิด (ร่างล่วงหน้า ${r.drafts} รายการ)` : LABEL[r.status];
                return (
                  <tr key={r.no} style={css(`border-top: 1px solid #e0e0e0${isCur ? '; background: #e0e0e0' : future ? '; color: #525252' : ''}`)}>
                    <td style={css(`height: 40px; padding: 0 12px${isCur ? '; font-weight: 600' : ''}`)}>{month(r.no)}</td>
                    <td style={css(TD)}><Dot text={label} tone={TONE[r.status]} /></td>
                    <td style={css(`${TD}${r.pp30 === 'draft' && !future ? '; color: #684e00' : ''}`)}>{r.pp30 && !future ? FILING[r.pp30] : '—'}</td>
                    <td style={css(`${TD}${r.pnd === 'draft' && !future ? '; color: #684e00' : ''}`)}>{r.pnd && !future ? FILING[r.pnd] : '—'}</td>
                    <td style={css(`${TD}${r.bank && !r.bank.ok ? '; color: #a2191f' : ''}`)}>{bankCell(r)}</td>
                    <td style={css(NUM)}>{r.profit === null ? '—' : money(r.profit, { paren: true })}</td>
                    <td style={css(TD)}>{r.status === 'open' ? '—' : closer(r)}</td>
                    <td style={css(TD)}>{action(r)}</td>
                  </tr>
                );
              })}
              {p13 && (
                <tr style={css('border-top: 1px solid #e0e0e0; color: #525252')}>
                  <td style={css('height: 40px; padding: 0 12px')}>งวดที่ 13 · ปรับปรุงปิดปี {year}</td>
                  <td style={css(TD)}>{decHard ? <Dot text={LABEL[p13.status]} tone={TONE[p13.status]} /> : <Dot text="ยังไม่เปิด (เปิดหลังปิดแข็ง ธ.ค.)" tone={TONE.hard_closed} />}</td>
                  <td style={css(TD)}>—</td><td style={css(TD)}>—</td><td style={css(TD)}>—</td><td style={css(NUM)}>—</td><td style={css(TD)}>—</td>
                  <td style={css(TD)}><span style={css('font-size: 13px')}>สำหรับรายการผู้สอบบัญชี / ภาษีเงินได้ / ปิดบัญชี — ลงวันที่ 31/12 แต่แยกจากงวด ธ.ค.</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px; align-items: start')}>
          <section style={css('border: 1px solid #e0e0e0')}>
            <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>รายการตรวจก่อนปิด {month(current)}</strong><span style={css('font-size: 13px; color: #525252')}>ผ่าน {passed} / {checks.length}</span></div>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}><tbody>
              {checks.map((c, i) => {
                const [sym, color] = MARK[c.mark];
                const tone = c.mark === 'x' ? 'color: #a2191f' : c.mark === 'warn' ? 'color: #684e00' : 'color: #525252';
                return (
                  <tr key={c.text} style={css(i ? 'border-top: 1px solid #e0e0e0' : '')}>
                    <td style={css(`height: 40px; padding: 0 16px; width: 24px; color: ${color}`)}>{sym}</td>
                    <td style={css('padding: 0 16px 0 0')}>{c.href ? <a href={c.href} style={css('text-decoration: none')}>{c.text}</a> : c.text}</td>
                    <td style={css(`padding: 0 16px; text-align: right; ${c.button ? '' : tone}`)}>{c.button ? <button type="button" disabled={busy} onClick={() => void runAction(c)} style={buttonStyle('secondary', 32, busy)}>{c.button}</button> : c.right}</td>
                  </tr>
                );
              })}
            </tbody></table>
            <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>รายการ ✕ ต้องผ่านก่อนปิดอ่อน · รายการ ! ต้องผ่านก่อนปิดแข็ง</div>
          </section>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <div style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}>
              <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่างรายการปิดปี {year} (งวดที่ 13 · ระบบสร้างให้)</strong><span style={css('font-size: 13px; color: #525252')}>ตัวเลขประมาณจากยอดถึง {thaiMonth(current)}</span></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 13px')}><tbody>
                <tr><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #525252')}>JV{year}-13-0001 ภาษีเงินได้นิติบุคคลค้างจ่าย</td></tr>
                <tr><td style={css('height: 28px; padding: 0 16px')}>Dr 5950100 ภาษีเงินได้นิติบุคคล</td><td style={css('width: 110px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>—</td><td style={css('width: 110px')}></td></tr>
                <tr><td style={css('height: 28px; padding: 0 16px 0 32px')}>Cr 2160100 ภาษีเงินได้ค้างจ่าย (หัก ภ.ง.ด.51 + ถูกหัก ณ ที่จ่าย 1160100)</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>—</td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #525252')}>JV{year}-13-0002 ปิดบัญชีรายได้และค่าใช้จ่ายเข้ากำไรขาดทุน</td></tr>
                <tr><td style={css('height: 28px; padding: 0 16px')}>Dr 4xxxxxx รายได้ทุกบัญชี</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(yearEnd.revenue)}</td><td></td></tr>
                {loss && <tr><td style={css('height: 28px; padding: 0 16px')}>Dr 3900100 กำไรขาดทุน (ปิดบัญชี)</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(absProfit)}</td><td></td></tr>}
                <tr><td style={css('height: 28px; padding: 0 16px 0 32px')}>Cr 5xxxxxx ค่าใช้จ่ายทุกบัญชี</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(yearEnd.expense)}</td></tr>
                {!loss && <tr><td style={css('height: 28px; padding: 0 16px 0 32px')}>Cr 3900100 กำไรขาดทุน (ปิดบัญชี)</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(absProfit)}</td></tr>}
                <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={3} style={css('height: 28px; padding: 0 16px; color: #525252')}>JV{year}-13-0003 โอนกำไรสุทธิเข้ากำไรสะสม</td></tr>
                <tr><td style={css('height: 28px; padding: 0 16px')}>Dr {loss ? '3200100 กำไรสะสมยังไม่จัดสรร' : '3900100 กำไรขาดทุน'}</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(absProfit)}</td><td></td></tr>
                <tr><td style={css('height: 28px; padding: 0 16px 0 32px')}>Cr {loss ? '3900100 กำไรขาดทุน' : '3200100 กำไรสะสมยังไม่จัดสรร'}</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(absProfit)}</td></tr>
              </tbody></table>
              <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>สำรองตามกฎหมาย (Dr 3200100 / Cr 3300100) ไม่ลงตอนปิดปี — บันทึกแยกเมื่อที่ประชุมผู้ถือหุ้นอนุมัติจ่ายเงินปันผล อย่างน้อย 5% ของกำไรจนกว่าจะครบ 10% ของทุน (ป.พ.พ. ม.1202) · ยอดงบดุล ณ 31/12/{year} ยกไปเป็นยอดยกมา 01/01/{year + 1} อัตโนมัติ · รายการในปี {year + 1} บันทึกได้ก่อนปิดปี {year} และยอดยกมาจะคำนวณใหม่เมื่อปิดจริง</div>
            </div>
            <div style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>ปิดปีบัญชี {year} (เตรียมการ)</strong>
              <span style={css('color: #525252')}>ทำได้หลังปิดแข็ง ธ.ค. · รายการปิดปีและรายการปรับปรุงของผู้สอบบัญชีลงใน &quot;งวดที่ 13&quot; (ลงวันที่ 31/12 แยกจาก ธ.ค.) · ยกยอดงบดุลไปปี {year + 1} และคำนวณใหม่อัตโนมัติเมื่อแก้งวด 13</span>
              <div style={css('display: flex; justify-content: space-between')}><span>รายการปรับปรุงผู้สอบบัญชีปี {year - 1}</span><span style={css('color: #525252')}>—</span></div>
              <div style={css('display: flex; justify-content: space-between')}><span>ภ.ง.ด.50 ปี {year - 1}</span><span style={css('color: #525252')}>—</span></div>
              <div style={css('display: flex; justify-content: space-between')}><span>ภ.ง.ด.51 ครึ่งปี {year}</span><span style={css('color: #525252')}>—</span></div>
            </div>
            <div style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
              <strong>ประวัติการเปิดงวดย้อนหลัง</strong>
              {reopens.map((r) => {
                const no = Number(r.period.split('-')[1]);
                return (
                  <Fragment key={`${r.at}-${r.period}`}>
                    <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>{ddmm(r.at)} เปิด {thaiMonth(no) || `งวด ${no}`} — {r.reason}</span><span style={css('color: #525252; white-space: nowrap')}></span></div>
                  </Fragment>
                );
              })}
              <span style={css('font-size: 13px; color: #525252')}>ทุกครั้งที่เปิดงวดคืนจะบันทึกใน Audit log พร้อมเหตุผล และแจ้งเจ้าของบริษัททางอีเมล</span>
            </div>
          </section>
        </div>
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>{month(current)}: เหลือ {blocking} รายการบังคับก่อนปิดอ่อน</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <button type="button" style={buttonStyle('secondary')}>พิมพ์ชุดรายงานปิดงวด</button>
          {(() => {
            const off = busy || blocking > 0 || cur?.status !== 'open' || firstOpen !== current;
            return <button type="button" disabled={off} onClick={() => void close(current, 'soft_closed')} style={buttonStyle('primary', 40, off)}>ปิดอ่อน {month(current)}</button>;
          })()}
        </div>
      </div>
    </>
  );
}
