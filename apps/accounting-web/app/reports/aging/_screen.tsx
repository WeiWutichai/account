'use client';
// F7 อายุหนี้ — design/project/ScreenAging.dc.html · ยอดทั้งหมดจาก GET /v1/reports/aging?asOf=&side=AR|AP
// drill-down: คลิกยอดในช่องอายุ → แสดงเอกสารของคู่ค้าในช่วงนั้น (docs[] จาก API) ใต้แถว
// TODO(backend) ScreenAging.dc.html: คอลัมน์ "เครดิต" (30 วัน · วงเงิน 3,000,000 / เกินวงเงิน) — API อายุหนี้ยังไม่คืน credit_days/credit_limit ของคู่ค้า จึงแสดง "—"
// TODO(backend) ScreenAging.dc.html: "นับอายุจาก: วันที่เอกสาร" และ "ช่วงอายุ (วัน)" ปรับได้ — backend นับจากวันครบกำหนด ช่วงคงที่ 30/60/90/120 (fixtures buckets_days) · "พนักงานขาย / มิติ" ยังไม่มีมิติในเอกสาร
// TODO(Wei) ScreenAging.dc.html: ปุ่ม แจ้งเตือน / จดหมายทวงถาม (ยังไม่มีระบบส่งอีเมล/แบบพิมพ์) และ "ตั้งค่าเผื่อหนี้สูญ" (นโยบายค่าเผื่อหนี้สงสัยจะสูญ — รอผู้สอบบัญชี) ยังไม่ทำงาน · เกณฑ์เลือกปุ่มต่อแถว (1–60 วัน แจ้งเตือน · 61–120 ทวงถาม · เกิน 120 ค่าเผื่อ) อนุมานจากแบบร่าง
// TODO(Wei) ScreenAging.dc.html: กล่อง "DSO และแนวโน้ม" — ยังไม่กำหนดสูตร DSO (ยอดขายเชื่อฐานใด/กี่วัน) จึงแสดง "—" · ส่งออก Excel / พิมพ์ ยังไม่มี API
import { buttonStyle, css, href, money, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { divRound, fromCents, toCents } from '../../sales/_lib/num';

const B = ['current', 'b1_30', 'b31_60', 'b61_90', 'b91_120', 'over_120'] as const;
type Bucket = (typeof B)[number];
interface Doc { docNo: string; due: string | null; days: number; amount: string; bucket: Bucket }
type Row = { contactId: string; code: string; name: string; docs: Doc[]; total: string } & Record<Bucket, string>;
export interface Aging { asOf: string; side: 'AR' | 'AP'; rows: Row[]; totals: Record<Bucket | 'total', string>; gl: { account: string; balance: string; diff: string } }

const TH = 'padding: 0 12px; font-weight: 400; text-align: right';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const FIELD = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';
const SEG_ON = 'height: 32px; padding: 0 12px; border: 0; border-radius: 0; background: #0f62fe; color: #ffffff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer';
const SEG_OFF = 'height: 32px; padding: 0 12px; border: 0; border-radius: 0; background: #ffffff; color: #161616; font-family: inherit; font-size: 14px; font-weight: 400; cursor: pointer';
const LINK = 'border: 0; background: transparent; padding: 0; font: inherit; cursor: pointer; text-decoration: none';
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${thaiMonth(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4)) + 543}`;
const pct = (part: string, total: string) => {
  const t = toCents(total);
  if (t === 0n) return '0.0%';
  const p = divRound(toCents(part) * 1000n, t);
  return `${p / 10n}.${(p < 0n ? -p : p) % 10n}%`;
};
const overdue = (r: Record<Bucket | 'total', string>) => fromCents(toCents(r.total) - toCents(r.current));

export function AgingScreen({ data, side, asOf, controlName }: { data: Aging; side: 'AR' | 'AP'; asOf: string; controlName: string }) {
  const router = useRouter();
  const [date, setDate] = useState(thaiDate(asOf));
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [open, setOpen] = useState<{ contact: string; bucket: Bucket } | null>(null);
  const go = (q: { side?: string; asOf?: string }) => router.push(`${href('aging')}?side=${q.side ?? side}&asOf=${encodeURIComponent(q.asOf ?? asOf)}`);
  const rows = onlyOverdue ? data.rows.filter((r) => toCents(overdue(r)) > 0n) : data.rows;
  const ok = toCents(data.gl.diff) === 0n;
  const who = side === 'AR' ? 'ลูกค้า' : 'ผู้ขาย';

  function action(r: Row) {
    if (toCents(r.over_120) > 0n) return <button type="button" style={buttonStyle('secondary', 32)}>ตั้งค่าเผื่อหนี้สูญ</button>;
    if (toCents(r.b61_90) + toCents(r.b91_120) > 0n) return <button type="button" style={buttonStyle('primary', 32)}>จดหมายทวงถาม</button>;
    if (toCents(r.b1_30) + toCents(r.b31_60) > 0n) return <button type="button" style={buttonStyle('secondary', 32)}>แจ้งเตือน</button>;
    return null;
  }

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>การเงิน / อายุหนี้</span>
        <div role="group" style={css('display: inline-flex; border: 1px solid #8d8d8d; border-radius: 4px; overflow: hidden')}>
          <button type="button" aria-pressed={side === 'AR'} onClick={() => go({ side: 'AR' })} style={css(side === 'AR' ? SEG_ON : SEG_OFF)}>ลูกหนี้ (AR)</button>
          <button type="button" aria-pressed={side === 'AP'} onClick={() => go({ side: 'AP' })} style={css(side === 'AP' ? SEG_ON : SEG_OFF)}>เจ้าหนี้ (AP)</button>
        </div>
      </header>
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>{side === 'AR' ? 'อายุลูกหนี้' : 'อายุเจ้าหนี้'} ณ {longDate(asOf)}</h1><span style={css('font-size: 13px; color: #525252')}>ช่วงอายุปรับได้ · คลิกยอดเพื่อดูเอกสาร · ส่งจดหมายทวงถามได้จากหน้านี้</span></div>
          <div style={css('display: flex; gap: 8px')}><button type="button" style={buttonStyle('secondary', 36)}>ส่งออก Excel</button><button type="button" style={buttonStyle('secondary', 36)}>พิมพ์</button></div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); go({ asOf: date }); }} style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
          <label style={css(LABEL)}>ณ วันที่<input value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => date !== thaiDate(asOf) && go({ asOf: date })} style={css(`${FIELD}; width: 140px; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(LABEL)}>นับอายุจาก<select style={css(FIELD)}><option>วันครบกำหนด</option><option>วันที่เอกสาร</option></select></label>
          <label style={css(LABEL)}>ช่วงอายุ (วัน)<input defaultValue="30, 60, 90, 120" readOnly style={css(`${FIELD}; width: 160px; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(LABEL)}>พนักงานขาย / มิติ<select style={css(FIELD)}><option>ทั้งหมด</option><option>สาขากรุงเทพ</option><option>สาขาระยอง</option></select></label>
          <label style={css('display: flex; align-items: center; gap: 8px; margin-top: 20px')}><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> แสดงเฉพาะที่เกินกำหนด</label>
        </form>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 1040px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
              <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>{who}</th><th style={css('padding: 0 12px; font-weight: 400')}>เครดิต</th>
              <th style={css(TH)}>ยังไม่ครบกำหนด</th><th style={css(TH)}>1–30</th><th style={css(TH)}>31–60</th><th style={css(TH)}>61–90</th><th style={css(TH)}>91–120</th><th style={css(TH)}>เกิน 120</th><th style={css(TH)}>รวมค้าง</th><th style={css('padding: 0 12px; font-weight: 400')}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การดำเนินการ</span></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.contactId}>
                  <tr style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}><a href={href('contacts')} style={css('text-decoration: none; font-weight: 500')}>{r.name}</a> <span style={css('color: #525252; font-size: 13px')}>{r.code}</span></td>
                    <td style={css('padding: 0 12px; color: #525252')}>—</td>
                    {B.map((b) => {
                      const zero = toCents(r[b]) === 0n;
                      const late = b !== 'current' && b !== 'b1_30' && b !== 'b31_60';
                      const on = open?.contact === r.contactId && open.bucket === b;
                      return (
                        <td key={b} style={css(NUM)}>
                          {zero ? '' : (
                            <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : { contact: r.contactId, bucket: b })} style={css(`${LINK}; color: ${late ? '#a2191f' : '#161616'}; font-variant-numeric: tabular-nums`)}>{money(r[b])}</button>
                          )}
                        </td>
                      );
                    })}
                    <td style={css(`${NUM}; font-weight: 500`)}>{money(r.total)}</td>
                    <td style={css('padding: 0 12px')}>{action(r)}</td>
                  </tr>
                  {open?.contact === r.contactId && (
                    <tr style={css('background: #f4f4f4')}>
                      <td colSpan={10} style={css('padding: 8px 12px 8px 32px; font-size: 13px')}>
                        {r.docs.filter((d) => d.bucket === open.bucket).map((d) => (
                          <div key={d.docNo} style={css('display: flex; gap: 16px; font-variant-numeric: tabular-nums')}>
                            <span style={css('min-width: 120px; font-weight: 500')}>{d.docNo}</span>
                            <span style={css('color: #525252')}>ครบกำหนด {d.due ? thaiDate(d.due) : '—'}</span>
                            <span style={css('color: #525252')}>{d.days > 0 ? `เกิน ${d.days} วัน` : `อีก ${-d.days} วัน`}</span>
                            <span style={css('margin-left: auto')}>{money(d.amount)}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}>
                <td colSpan={2} style={css('height: 40px; padding: 0 12px')}>รวม {data.rows.length} ราย</td>
                {B.map((b) => <td key={b} style={css(NUM)}>{money(data.totals[b])}</td>)}
                <td style={css(NUM)}>{money(data.totals.total)}</td><td></td>
              </tr>
              <tr style={css('color: #525252; font-size: 13px')}>
                <td colSpan={2} style={css('height: 32px; padding: 0 12px')}>สัดส่วน</td>
                {B.map((b) => <td key={b} style={css(NUM)}>{pct(data.totals[b], data.totals.total)}</td>)}
                <td style={css(NUM)}>100%</td><td></td>
              </tr>
            </tfoot>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
            <strong>ตรวจกับบัญชีแยกประเภท</strong>
            <div style={css('display: flex; justify-content: space-between')}><span>รวมอายุหนี้</span><span style={css('font-variant-numeric: tabular-nums')}>{money(data.totals.total)}</span></div>
            <div style={css('display: flex; justify-content: space-between')}><span>{data.gl.account} {controlName} (GL) ณ {thaiDate(asOf).slice(0, 5)}</span><span style={css('font-variant-numeric: tabular-nums')}>{money(data.gl.balance)}</span></div>
            <div style={css(`display: flex; justify-content: space-between; color: ${ok ? '#0e6027' : '#a2191f'}; border-top: 1px solid #8d8d8d; padding-top: 4px`)}><span>ผลต่าง</span><span style={css('font-variant-numeric: tabular-nums')}>{money(data.gl.diff)}{ok ? ' ✓' : ' ✕'}</span></div>
          </section>
          {side === 'AR' && (
            <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
              <strong>DSO และแนวโน้ม</strong>
              <div style={css('display: flex; justify-content: space-between')}><span>DSO (วันเก็บหนี้เฉลี่ย) เดือนนี้</span><span style={css('font-variant-numeric: tabular-nums')}>—</span></div>
              <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>เดือนก่อน / 3 เดือนก่อน</span><span style={css('font-variant-numeric: tabular-nums')}>—</span></div>
              <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>เกินกำหนดรวม</span><span style={css('font-variant-numeric: tabular-nums')}>{money(overdue(data.totals))} ({pct(overdue(data.totals), data.totals.total)})</span></div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
