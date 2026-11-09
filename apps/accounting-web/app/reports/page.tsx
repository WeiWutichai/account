// R1 รายงาน (งบทดลอง / งบกำไรขาดทุน / งบแสดงฐานะการเงิน จาก GL) — design/project/ScreenReports.dc.html (Sidebar active="reports")
// ยอดจาก GET /v1/reports/statements?year=&period= (สะสมตั้งแต่ต้นปีถึงงวด) · รายเดือน = ถึงงวด n − ถึงงวด n−1 · คลิกชื่อบัญชี → แยกประเภท (/gl/ledger) → เอกสารต้นทาง
// TODO(Wei) ScreenReports.dc.html: แบบร่างกำหนดรายละเอียดเฉพาะ "งบกำไรขาดทุน" — งบทดลอง/งบแสดงฐานะการเงิน ใช้โครงตารางเดียวกัน (ยังไม่มีแบบร่างของตัวเอง)
// TODO(Wei) ScreenReports.dc.html: การจัดกลุ่มงบกำไรขาดทุน (ต้นทุนการให้บริการ = 51xxxxx + 5301xxx · หลังกำไรก่อนดอกเบี้ยและภาษี = 59xxxxx · ที่เหลือ = ค่าใช้จ่ายในการขายและบริหาร) อนุมานจากแบบร่าง/fixtures pl_ytd_2569_11 — ควรมาจากรูปแบบงบ (R2 acct.report_format)
// TODO(Wei) ScreenReports.dc.html: รายการในเมนูซ้ายที่ยังไม่มีใน P1 (งบกระแสเงินสด · หมายเหตุประกอบงบ · งบตามมิติ · งบประมาณ · รายงานบริหาร) ลิงก์ตามแบบร่างกลับมาหน้านี้ · ส่งออก Excel / PDF (Sarabun) / บันทึกมุมมองนี้ ยังไม่มี API
import { css, href, money } from '@innovera/ui';
import { api, type Context } from '../lib/api';
import { Shell } from '../lib/shell';
import { fromCents, toCents } from '../sales/_lib/num';
import { ReportFilters, type ReportQuery } from './filters';

interface TbLine { account: string; name: string; type: string; debit: string; credit: string; balance: string }
interface Statements { pl: { revenue: TbLine[]; expense: TbLine[]; profit: string }; bs: { assets: TbLine[]; liabilities: TbLine[]; equity: TbLine[]; balanced: boolean } }
type Acc = Map<string, { name: string; type: string; bal: bigint }>;
interface Row { kind: 'head' | 'line' | 'sub' | 'total' | 'pct'; label: string; code?: string; cur: bigint | string | null; prior: bigint | string | null }

const FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const pad = (n: number) => String(n).padStart(2, '0');
const VIEWS = { tb: 'งบทดลอง', pl: 'งบกำไรขาดทุน', bs: 'งบแสดงฐานะการเงิน' } as const;
type View = keyof typeof VIEWS;

async function load(year: number, period: number): Promise<Acc> {
  const m: Acc = new Map();
  if (period < 1) return m;
  const s = await api<Statements>(`/v1/reports/statements?year=${year}&period=${period}`).catch(() => null);
  if (!s) return m;
  for (const l of [...s.pl.revenue, ...s.pl.expense, ...s.bs.assets, ...s.bs.liabilities, ...s.bs.equity]) m.set(l.account, { name: l.name, type: l.type, bal: toCents(l.balance) });
  return m;
}
function minus(a: Acc, b: Acc): Acc {
  const m: Acc = new Map();
  for (const [k, v] of a) m.set(k, { ...v, bal: v.bal - (b.get(k)?.bal ?? 0n) });
  for (const [k, v] of b) if (!a.has(k)) m.set(k, { ...v, bal: -v.bal });
  return m;
}
const fmt = (c: bigint | string | null) => (c === null ? '' : typeof c === 'string' ? c : money(fromCents(c), { paren: true }));
/** a ÷ b × 100 ทศนิยม 1 ตำแหน่ง (ปัดครึ่งขึ้น) · b = 0 → ว่าง */
function pct1(a: bigint, b: bigint): string {
  if (b === 0n) return '';
  const neg = (a < 0n) !== (b < 0n);
  const [x, z] = [a < 0n ? -a : a, b < 0n ? -b : b];
  const p = (x * 1000n * 2n + z) / (z * 2n);
  return `${neg && p > 0n ? '−' : ''}${p / 10n}.${p % 10n}`;
}
/** % เปลี่ยนแปลงเทียบปีก่อน = (ปีนี้ − ปีก่อน) ÷ |ปีก่อน| */
const pctChange = (cur: bigint, prior: bigint) => pct1(cur - prior, prior < 0n ? -prior : prior);
const pctOf = (a: bigint, b: bigint) => { const t = pct1(a, b); return t ? `${t}%` : ''; };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await api<Context>('/v1/context');
  const year = ctx.period?.fiscal_year ?? 2569;
  const period = ctx.period?.period_no ?? 12;
  const y = year - 543;
  const q: ReportQuery = { view: sp.view && sp.view in VIEWS ? sp.view : 'pl', range: sp.range === 'month' ? 'month' : 'ytd', cmp: sp.cmp === 'none' ? 'none' : 'prior', level: sp.level === 'summary' ? 'summary' : sp.level === 'all' ? 'all' : 'sub' };
  const view = q.view as View;
  const monthOnly = q.range === 'month' && view !== 'bs';
  const [c1, c0, p1, p0] = await Promise.all([load(year, period), monthOnly ? load(year, period - 1) : null, q.cmp === 'prior' ? load(year - 1, period) : null, q.cmp === 'prior' && monthOnly ? load(year - 1, period - 1) : null]);
  const cur = c0 ? minus(c1, c0) : c1;
  const prior = p1 ? (p0 ? minus(p1, p0) : p1) : null;
  const lastDay = new Date(Date.UTC(y, period, 0)).getUTCDate();
  const from = monthOnly ? `${y}-${pad(period)}-01` : `${y}-01-01`;
  const to = `${y}-${pad(period)}-${pad(lastDay)}`;
  const codes = [...new Set([...cur.keys(), ...(prior?.keys() ?? [])])].sort();
  const info = (code: string) => cur.get(code) ?? prior?.get(code);
  const val = (m: Acc | null, code: string, sign: 1n | -1n) => (m ? (m.get(code)?.bal ?? 0n) * sign : null);
  const sum = (m: Acc | null, cs: string[], sign: 1n | -1n) => (m ? cs.reduce((s, c) => s + (m.get(c)?.bal ?? 0n) * sign, 0n) : null);
  const add = (a: bigint | null, b: bigint | null) => (a === null || b === null ? null : a + b);
  const detail = q.level !== 'summary';

  const rows: Row[] = [];
  const section = (head: string, cs: string[], subLabel: string | null, sign: 1n | -1n) => {
    if (head) rows.push({ kind: 'head', label: head, cur: null, prior: null });
    if (detail) for (const c of cs) rows.push({ kind: 'line', label: `${c} ${info(c)?.name ?? ''}`, code: c, cur: val(cur, c, sign), prior: val(prior, c, sign) });
    const t = { cur: sum(cur, cs, sign)!, prior: sum(prior, cs, sign) };
    if (subLabel) rows.push({ kind: 'sub', label: subLabel, ...t });
    return t;
  };
  let net: { cur: bigint; prior: bigint | null } = { cur: 0n, prior: null };
  let netLabel = '';
  if (view === 'pl') {
    const of = (types: string[]) => codes.filter((c) => types.includes(info(c)?.type ?? ''));
    const rev = of(['revenue', 'contra_revenue']);
    const exp = of(['expense']);
    const cost = exp.filter((c) => c.startsWith('51') || c.startsWith('5301'));
    const below = exp.filter((c) => c.startsWith('59'));
    const sga = exp.filter((c) => !cost.includes(c) && !below.includes(c));
    const r = section('รายได้', rev, null, -1n);
    rows.push({ kind: 'total', label: 'รวมรายได้', ...r });
    const k = section('ต้นทุนการให้บริการ', cost, 'รวมต้นทุนการให้บริการ', -1n);
    const gp = { cur: r.cur + k.cur, prior: add(r.prior, k.prior) };
    rows.push({ kind: 'total', label: 'กำไรขั้นต้น', ...gp });
    rows.push({ kind: 'pct', label: 'อัตรากำไรขั้นต้น', cur: pctOf(gp.cur, r.cur), prior: gp.prior !== null && r.prior !== null ? pctOf(gp.prior, r.prior) : null });
    const s = section('ค่าใช้จ่ายในการขายและบริหาร', sga, 'รวมค่าใช้จ่ายในการขายและบริหาร', -1n);
    const ebit = { cur: gp.cur + s.cur, prior: add(gp.prior, s.prior) };
    rows.push({ kind: 'total', label: 'กำไรก่อนดอกเบี้ยและภาษี', ...ebit });
    const b = section('', below, null, -1n);
    net = { cur: ebit.cur + b.cur, prior: add(ebit.prior, b.prior) };
    netLabel = 'กำไรสุทธิ';
  } else if (view === 'bs') {
    const of = (types: string[]) => codes.filter((c) => types.includes(info(c)?.type ?? ''));
    const a = section('สินทรัพย์', of(['asset', 'contra_asset']), null, 1n);
    rows.push({ kind: 'total', label: 'รวมสินทรัพย์', ...a });
    const l = section('หนี้สิน', of(['liability']), 'รวมหนี้สิน', -1n);
    const e = section('ส่วนของเจ้าของ', of(['equity']), null, -1n);
    // กำไรสะสมปีปัจจุบัน = รายได้ − ค่าใช้จ่ายถึงงวด (ยังไม่ปิดบัญชีเข้า 3200100 จนปิดปีในงวด 13)
    const pl = (m: Acc | null) => (m ? codes.filter((c) => ['revenue', 'contra_revenue', 'expense'].includes(info(c)?.type ?? '')).reduce((s, c) => s - (m.get(c)?.bal ?? 0n), 0n) : null);
    const p = { cur: pl(cur)!, prior: pl(prior) };
    rows.push({ kind: 'line', label: 'กำไร(ขาดทุน)สุทธิปีปัจจุบัน', cur: p.cur, prior: p.prior });
    rows.push({ kind: 'sub', label: 'รวมส่วนของเจ้าของ', cur: e.cur + p.cur, prior: add(e.prior, p.prior) });
    net = { cur: l.cur + e.cur + p.cur, prior: add(add(l.prior, e.prior), p.prior) };
    netLabel = 'รวมหนี้สินและส่วนของเจ้าของ';
  }

  const title = VIEWS[view];
  const periodText = view === 'bs' ? `ณ วันที่ ${lastDay} ${FULL[period - 1]} ${year}` : monthOnly ? `สำหรับงวด 1 – ${lastDay} ${FULL[period - 1]} ${year}` : `สำหรับงวด 1 มกราคม – ${lastDay} ${FULL[period - 1]} ${year}`;
  const colCur = monthOnly ? `${SHORT[period - 1]} ${year}` : `${year} (ถึง ${SHORT[period - 1]})`;
  const colPrior = monthOnly ? `${SHORT[period - 1]} ${year - 1}` : `${year - 1} (ถึง ${SHORT[period - 1]})`;
  const showPrior = prior !== null;
  const base = href('reports');
  const nav = (label: string, link: string, active = false) => (
    <a href={link} aria-current={active ? 'page' : undefined} style={css(active ? 'display: block; padding: 8px 16px 8px 13px; text-decoration: none; color: #161616; background: #e0e0e0; border-left: 3px solid #0f62fe; font-weight: 600' : 'display: block; padding: 8px 16px; text-decoration: none; color: #161616')}>{label}</a>
  );
  const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
  const btn = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 32px; padding: 0 12px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d';
  const cells = (r: { cur: bigint | string | null; prior: bigint | string | null }, pct = true) => {
    const c = typeof r.cur === 'bigint' ? r.cur : null;
    const p = typeof r.prior === 'bigint' ? r.prior : null;
    return (
      <>
        <td style={css(NUM)}>{fmt(r.cur)}</td>
        {showPrior && <><td style={css(NUM)}>{fmt(r.prior)}</td><td style={css(NUM)}>{c !== null && p !== null ? fmt(c - p) : ''}</td><td style={css(NUM)}>{pct && c !== null && p !== null ? pctChange(c, p) : ''}</td></>}
      </>
    );
  };
  const ledger = (code: string) => `${href('ledger')}?account=${code}&from=${from}&to=${to}`;
  const tbRows = view === 'tb' ? codes.filter((c) => cur.has(c)).map((c) => ({ code: c, name: info(c)?.name ?? '', bal: cur.get(c)!.bal })) : [];
  const tbDr = tbRows.reduce((s, r) => s + (r.bal > 0n ? r.bal : 0n), 0n);
  const tbCr = tbRows.reduce((s, r) => s + (r.bal < 0n ? -r.bal : 0n), 0n);

  return (
    <Shell active="reports">
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>รายงาน / {title}</span>
        <div style={css('display: flex; gap: 8px')}><button type="button" style={css(btn)}>ส่งออก Excel</button><button type="button" style={css(btn)}>PDF (Sarabun)</button><button type="button" style={css(btn)}>บันทึกมุมมองนี้</button></div>
      </header>
      <div style={css('display: flex; flex: 1; min-height: 0')}>
        <nav aria-label="รายงาน" style={css('flex: 0 0 240px; border-right: 1px solid #e0e0e0; padding: 16px 0; font-size: 14px')}>
          <div style={css('padding: 0 16px 8px; font-size: 13px; color: #525252')}>งบการเงิน</div>
          {nav('งบทดลอง', `${base}?view=tb`, view === 'tb')}
          {nav('งบกำไรขาดทุน', base, view === 'pl')}
          {nav('งบแสดงฐานะการเงิน', `${base}?view=bs`, view === 'bs')}
          {nav('งบกระแสเงินสด', base)}
          {nav('งบแสดงการเปลี่ยนแปลงส่วนของเจ้าของ', href('plan'))}
          {nav('หมายเหตุประกอบงบ (ร่าง)', base)}
          <div style={css('padding: 16px 16px 8px; font-size: 13px; color: #525252')}>รายงานตามรูปแบบ</div>
          {/* TODO(Wei): "(3)" = จำนวนรูปแบบที่บันทึกไว้ — ตัวสร้างรูปแบบงบอยู่นอก P1 (ยังไม่มีข้อมูล) คงข้อความตามแบบร่าง */}
          {nav('รูปแบบที่กำหนดเอง (3) · ตัวสร้าง', `${base}/builder`)}
          {nav('งบตามมิติ: โครงการ / สาขา / ศูนย์ต้นทุน', href('settings'))}
          {nav('งบเปรียบเทียบงบประมาณ', base)}
          <div style={css('padding: 16px 16px 8px; font-size: 13px; color: #525252')}>รายงานบริหาร</div>
          {nav('ขายตามลูกค้า / สินค้า / พนักงาน', base)}
          {nav('ซื้อตามผู้ขาย / หมวด', base)}
          {nav('กระแสเงินสดคาดการณ์ 13 สัปดาห์', base)}
          {nav('รายงานตรวจสอบ (Audit pack)', href('recon'))}
        </nav>
        <div style={css('flex: 1; min-width: 0; padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
          <ReportFilters base={base} q={q} year={year} monthLabel={SHORT[period - 1]!} />
          <div style={css('text-align: center; padding: 8px 0 0')}><div style={css('font-weight: 600; font-size: 16px')}>{ctx.name}</div><div>{title}</div><div style={css('font-size: 13px; color: #525252')}>{periodText} · หน่วย: บาท</div></div>
          <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
            {view === 'tb' ? (
              <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px')}><th style={css('height: 40px; padding: 0 12px; text-align: left; font-weight: 400')}>บัญชี</th><th style={css('padding: 0 12px; text-align: right; font-weight: 400; width: 150px')}>เดบิต</th><th style={css('padding: 0 12px; text-align: right; font-weight: 400; width: 150px')}>เครดิต</th></tr></thead>
                <tbody>
                  {tbRows.map((r) => (
                    <tr key={r.code}><td style={css('height: 32px; padding: 0 12px 0 32px')}><a href={ledger(r.code)} style={css('text-decoration: none; color: #161616')}>{r.code} {r.name}</a></td><td style={css(NUM)}>{r.bal > 0n ? money(fromCents(r.bal)) : ''}</td><td style={css(NUM)}>{r.bal < 0n ? money(fromCents(-r.bal)) : ''}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr style={css('border-top: 2px solid #161616; font-weight: 600; font-size: 15px')}><td style={css('height: 44px; padding: 0 12px')}>รวม</td><td style={css(NUM)}>{money(fromCents(tbDr))}</td><td style={css(NUM)}>{money(fromCents(tbCr))}</td></tr></tfoot>
              </table>
            ) : (
              <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px')}>
                  <th style={css('height: 40px; padding: 0 12px; text-align: left; font-weight: 400')}>รายการ</th><th style={css('padding: 0 12px; text-align: right; font-weight: 400; width: 150px')}>{colCur}</th>
                  {showPrior && <><th style={css('padding: 0 12px; text-align: right; font-weight: 400; width: 150px')}>{colPrior}</th><th style={css('padding: 0 12px; text-align: right; font-weight: 400; width: 130px')}>เปลี่ยนแปลง</th><th style={css('padding: 0 12px; text-align: right; font-weight: 400; width: 80px')}>%</th></>}
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const key = `${r.kind}-${r.label}-${i}`;
                    if (r.kind === 'head') return <tr key={key} style={css('border-top: 1px solid #e0e0e0; font-weight: 600')}><td style={css('height: 36px; padding: 0 12px')}>{r.label}</td><td></td>{showPrior && <><td></td><td></td><td></td></>}</tr>;
                    if (r.kind === 'line') return <tr key={key}><td style={css('height: 32px; padding: 0 12px 0 32px')}>{r.code ? <a href={ledger(r.code)} style={css('text-decoration: none; color: #161616')}>{r.label}</a> : r.label}</td>{cells(r)}</tr>;
                    if (r.kind === 'sub') return <tr key={key} style={css('border-top: 1px solid #e0e0e0; color: #525252')}><td style={css('height: 32px; padding: 0 12px 0 32px')}>{r.label}</td>{cells(r)}</tr>;
                    if (r.kind === 'pct') return <tr key={key} style={css('color: #525252; font-size: 13px')}><td style={css('height: 32px; padding: 0 12px 0 32px')}>{r.label}</td><td style={css(NUM)}>{r.cur ?? ''}</td>{showPrior && <><td style={css(NUM)}>{r.prior ?? ''}</td><td style={css(NUM)}></td><td style={css(NUM)}></td></>}</tr>;
                    return <tr key={key} style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}><td style={css('height: 36px; padding: 0 12px')}>{r.label}</td>{cells(r)}</tr>;
                  })}
                </tbody>
                <tfoot><tr style={css('border-top: 2px solid #161616; font-weight: 600; font-size: 15px')}><td style={css('height: 44px; padding: 0 12px')}>{netLabel}</td>{cells(net)}</tr></tfoot>
              </table>
            )}
          </section>
          <div style={css('font-size: 13px; color: #525252')}>คลิกชื่อบัญชี → แยกประเภท → เอกสารต้นทาง (drill-down 3 ชั้น) · ตัวเลขในวงเล็บ = ค่าลบ · งวดที่ปิดแล้วล็อกตัวเลข; งวดเปิดแสดงป้าย &quot;ยังไม่ปิด&quot; บนรายงานพิมพ์</div>
        </div>
      </div>
    </Shell>
  );
}

