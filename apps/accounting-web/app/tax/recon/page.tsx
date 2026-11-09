// R3 รายงานตรวจความถูกต้อง — design/project/ScreenReconReport.dc.html · เส้นทาง /tax/recon (packages/ui routes.ts id 'recon')
// ข้อมูล: GET /v1/reports/recon?month= (packages/db/src/reports.ts reconChecks) — ตัวเลขทุกตัวมาจาก API
// TODO(backend) ScreenReconReport.dc.html: ข้อ 1 "เอกสารเทียบบัญชีแยกประเภท" (IV/CN/DN/AP/EXP/RV/PV ↔ GL · JV ที่ไม่มีเอกสาร) ยังไม่มีใน API → แสดงหัวตาราง ไม่มีแถว
// TODO(backend): ข้อ 2 "ภาษีขายที่ยังไม่ถึงกำหนด (2150400)" และ "ภาษีถูกหัก ณ ที่จ่าย (1160100)" · ข้อ 3 "2140100 / 1140100 / 1150100-1150200" ยังไม่มีจุดตรวจใน API → ไม่แสดงแถว
// TODO(backend): ต้นเหตุของผลต่าง (เช่น "JV2611-0098 ลงบัญชีคุมโดยตรง ไม่ผูกผู้ขาย") ยังไม่มีใน API → ลิงก์ไปบัญชีแยกประเภทของบัญชีนั้นแทน
// TODO(backend): "ตรวจอัตโนมัติทุกคืน" (job) ยังไม่มี — ตรวจทุกครั้งที่เปิดหน้า · "ตรวจล่าสุด" = เวลาที่เปิดหน้า · "ใช้เวลา" = เวลาที่ API ใช้จริง
import { css, href, money, S } from '@innovera/ui';
import type { ReactNode } from 'react';
import { api, type Context } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { appToday, cents, fromCents, monthAbbr, monthParam, monthShort, reconReport, shiftMonth, type ReconCheck } from '../_lib/data';
import { ReconControls } from './_controls';

const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const TH = 'padding: 0 12px; font-weight: 400';
const mp = (v: string): string => money(v, { paren: true });

interface RowSpec { key: string; label: (m: string) => string; account: string; gl: string; okNote?: string }
const TAX_ROWS: RowSpec[] = [
  { key: 'vat_output', label: (m) => `รายงานภาษีขาย ${m}`, account: '2150100 ภาษีขาย (เครดิตในงวด)', gl: '2150100' },
  // TODO(backend): "(รวมใช้สิทธิ์ข้ามเดือน N ใบ)" — ภาษีซื้อข้ามเดือนยังไม่มีใน API
  { key: 'vat_input', label: (m) => `รายงานภาษีซื้อ ${m}`, account: '1170100 ภาษีซื้อ (เดบิตในงวด)', gl: '1170100' },
  { key: 'wht_payable', label: (m) => `ภ.ง.ด.3 + ภ.ง.ด.53 ${m} (หนังสือรับรองที่ออก)`, account: '2150300 ภาษีหัก ณ ที่จ่ายค้างนำส่ง', gl: '2150300', okNote: ' · รับรู้ตอนจ่ายเงินทุกฉบับ' },
];
const CONTROL_ROWS: RowSpec[] = [
  { key: 'ar_control', label: () => '1130100 ลูกหนี้การค้า', account: '', gl: '1130100' },
  { key: 'ap_control', label: () => '2110100 เจ้าหนี้การค้า', account: '', gl: '2110100' },
];

/** ผลต่างตามแบบร่าง = เอกสาร − GL (ค่าลบในวงเล็บ) */
const diffOf = (c: ReconCheck): string => fromCents(cents(c.byDocs) - cents(c.byGl));

function Result({ c, spec, ym }: { c: ReconCheck; spec: RowSpec; ym: string }): ReactNode {
  if (c.ok) return <td style={css('padding: 0 12px; color: #0e6027')}>✓ ผ่าน{spec.okNote ?? ''}</td>;
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return <td style={css('padding: 0 12px')}><a href={`${href('ledger')}?account=${spec.gl}&from=${ym}-01&to=${ym}-${String(last).padStart(2, '0')}`} style={css('text-decoration: none; color: #a2191f')}>✕ มีผลต่าง — ดูบัญชีแยกประเภท {spec.gl}</a></td>;
}

export default async function ReconPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ym = monthParam((await searchParams).month);
  const t0 = Date.now();
  const [rep, ctx] = await Promise.all([reconReport(ym), api<Context>('/v1/context')]);
  const secs = Math.max(1, Math.ceil((Date.now() - t0) / 1000));
  const at = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(new Date());
  const cur = appToday().slice(0, 7);
  const openYm = ctx.period ? `${ctx.period.fiscal_year - 543}-${String(ctx.period.period_no).padStart(2, '0')}` : null;
  const options = [...new Set([cur, shiftMonth(cur, -1), ym])].sort().reverse()
    .map((m) => ({ value: m, label: `${monthShort(m)}${m === openYm && ctx.period?.status === 'open' ? ' (เปิด)' : ''}` }));
  const byKey = new Map(rep.checks.map((c) => [c.key, c]));
  const failing = rep.checks.filter((c) => !c.ok);
  const failSum = fromCents(failing.reduce((s, c) => { const d = cents(diffOf(c)); return s + (d < 0n ? -d : d); }, 0n));
  const m = monthAbbr(ym);

  const row = (spec: RowSpec, cols: 'tax' | 'control') => {
    const c = byKey.get(spec.key);
    if (!c) return null;
    const d = diffOf(c);
    return (
      <tr key={spec.key} style={css(S.tr)}>
        <td style={css('height: 40px; padding: 0 12px')}>{spec.label(m)}</td>
        {/* TODO(backend): จำนวนราย / เอกสาร ของบัญชีคุมยังไม่มีใน GET /v1/reports/recon */}
        <td style={css(cols === 'tax' ? 'padding: 0 12px' : NUM)}>{cols === 'tax' ? spec.account : ''}</td>
        <td style={css(NUM)}>{mp(c.byDocs)}</td><td style={css(NUM)}>{mp(c.byGl)}</td>
        <td style={css(`${NUM}; color: ${c.ok ? '#525252' : '#a2191f'}`)}>{mp(d)}</td>
        <Result c={c} spec={spec} ym={ym} />
      </tr>
    );
  };

  return (
    <Shell active="recon">
      <header style={css(S.topbar)}>
        <span style={css(S.crumb)}>รายงาน / ตรวจความถูกต้อง / {monthShort(ym)}</span>
        <ReconControls ym={ym} options={options} />
      </header>
      <div style={css(S.content)}>
        <div><h1 style={css(S.h1)}>รายงานตรวจความถูกต้อง — {monthShort(ym)}</h1><span style={css(S.sub)}>ระบบกระทบยอด 3 ด้านอัตโนมัติทุกคืนและก่อนปิดงวด: เอกสาร ↔ GL · รายงานภาษี ↔ GL · ลูกหนี้/เจ้าหนี้รายตัว ↔ บัญชีคุม · ผลต่างทุกบรรทัดคลิกดูต้นเหตุได้</span></div>
        <div style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          <div><span style={css('color: #525252; font-size: 13px')}>ตรวจล่าสุด</span><div style={css('font-size: 16px; font-weight: 600')}>วันนี้ {at}</div><span style={css('color: #525252')}>ใช้เวลา {secs} วินาที</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>จุดตรวจ</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{rep.checks.length}</div></div>
          <div><span style={css('color: #525252; font-size: 13px')}>ผ่าน</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: #0e6027')}>{rep.passed}</div></div>
          <div><span style={css('color: #525252; font-size: 13px')}>ผลต่างต้องดู</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: #a2191f')}>{rep.toReview}</div><span style={css('color: #525252')}>รวม {money(failSum)}</span></div>
          {/* TODO(backend): ส่งออกรายงาน (PDF/Excel) — ยังไม่มี API/แบบพิมพ์ จึงยังไม่ทำงาน */}
          <div style={css('margin-left: auto; align-self: center')}><button type="button" style={css('display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 36px; padding: 0 16px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d')}>ส่งออกรายงาน (PDF/Excel)</button></div>
        </div>

        <section style={css(S.tableBox)}>
          <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>1. เอกสารเทียบบัญชีแยกประเภท (ยอดรวมเอกสารที่ผ่านรายการในงวด ↔ ยอดเคลื่อนไหว GL)</strong><span style={css('font-size: 13px; color: #525252')}>ตรวจว่าทุกเอกสารมี JV และ JV ตรงยอด</span></div>
          <table style={css(`${S.table}; min-width: 960px`)}>
            <thead><tr style={css(S.theadRow)}><th style={css(`height: 40px; ${TH}`)}>ประเภทเอกสาร</th><th style={css(`${TH}; text-align: right`)}>จำนวน</th><th style={css(TH)}>บัญชีที่ตรวจ</th><th style={css(`${TH}; text-align: right`)}>ยอดตามเอกสาร</th><th style={css(`${TH}; text-align: right`)}>ยอดตาม GL</th><th style={css(`${TH}; text-align: right`)}>ผลต่าง</th><th style={css(TH)}>ผล</th></tr></thead>
            <tbody></tbody>
          </table>
        </section>

        <section style={css(S.tableBox)}>
          <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>2. รายงานภาษีเทียบบัญชีแยกประเภท</strong><span style={css('font-size: 13px; color: #525252')}>ยอดในรายงานภาษีขาย/ซื้อ และ ภ.ง.ด. ต้องเท่ากับบัญชีภาษี</span></div>
          <table style={css(`${S.table}; min-width: 960px`)}>
            <thead><tr style={css(S.theadRow)}><th style={css(`height: 40px; ${TH}`)}>รายงาน</th><th style={css(TH)}>บัญชี GL</th><th style={css(`${TH}; text-align: right`)}>ตามรายงานภาษี</th><th style={css(`${TH}; text-align: right`)}>ตาม GL</th><th style={css(`${TH}; text-align: right`)}>ผลต่าง</th><th style={css(TH)}>ผล</th></tr></thead>
            <tbody>{TAX_ROWS.map((s) => row(s, 'tax'))}</tbody>
          </table>
        </section>

        <section style={css(S.tableBox)}>
          <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>3. ลูกหนี้ / เจ้าหนี้รายตัว เทียบบัญชีคุม</strong><span style={css('font-size: 13px; color: #525252')}>ผลรวมยอดค้างรายเอกสาร (sub-ledger) ↔ ยอดคงเหลือบัญชีคุม ณ สิ้นงวด</span></div>
          <table style={css(`${S.table}; min-width: 960px`)}>
            <thead><tr style={css(S.theadRow)}><th style={css(`height: 40px; ${TH}`)}>บัญชีคุม</th><th style={css(`${TH}; text-align: right`)}>จำนวนราย / เอกสาร</th><th style={css(`${TH}; text-align: right`)}>รวมรายตัว</th><th style={css(`${TH}; text-align: right`)}>บัญชีคุม (GL)</th><th style={css(`${TH}; text-align: right`)}>ผลต่าง</th><th style={css(TH)}>ผล</th></tr></thead>
            <tbody>{CONTROL_ROWS.map((s) => row(s, 'control'))}</tbody>
          </table>
        </section>
        {/* TODO(Wei) ScreenReconReport.dc.html: กฎป้องกัน (ปิด JV ตรงเข้าบัญชีคุม · บังคับเหตุผล JV คีย์มือ) ยังไม่มีในหน้าตั้งค่า — ลิงก์ไปหน้าตั้งค่าตามแบบร่าง */}
        <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; padding: 12px 16px; font-size: 13px; color: #525252; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px')}>
          <span>กฎป้องกันที่แนะนำ: ปิดการลง JV ตรงเข้าบัญชีคุม (1130100 / 2110100) นอกจากผ่านเอกสาร · บังคับเหตุผลสำหรับ JV คีย์มือที่ไม่มีเอกสารอ้างอิง — <a href={href('settings')} style={css('text-decoration: none')}>เปิดใช้ในตั้งค่า</a></span>
          <span>ทุกจุดตรวจนี้เป็นเงื่อนไขก่อนปิดงวด (<a href={href('close')} style={css('text-decoration: none')}>ปิดงวด</a>)</span>
        </section>
      </div>
    </Shell>
  );
}
