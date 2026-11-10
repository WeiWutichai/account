'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// สกุลเงิน · อัตราแลกเปลี่ยน · ปรับมูลค่าสิ้นงวด · ทะเบียนสาขา — ใช้งานได้ก่อน (Wei 2026-11-10) · ทุกค่าตรวจที่ server (422 = ข้อความไทยจาก API)
// อัตรา = บาทต่อ 1 หน่วยสกุลต่างประเทศ กรอกเอง (ไม่ดึงจากภายนอก) · แหล่งอัตรา = fx.rate_source (รอผู้สอบบัญชี)
import { Button, css, money, parseThaiDate, S, Tag, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { req } from '../_p2a/req';
import { fromCents, toCents } from '../sales/_lib/num';
import type { Branch, CompanyModules, Currency } from '../_p2a/types';
import { P2A_INPUT, P2A_LABEL, PendingAuditor, rateText, TempBanner } from '../_p2a/ui';

export interface RateRow { currency: string; rate_date: string; source: 'bot_mid' | 'bot_buy' | 'bot_sell'; rate: string }
export interface FxSettings { rateSource: 'bot_mid' | 'bot_buy' | 'bot_sell'; revaluePeriodEnd: boolean; numbering: string; vatFiling: string }
export interface RevalRun { fiscal_year: number; period_no: number; rate_date: string; total: string; journal_no: string | null; reversal_no: string | null; reversal_date: string | null }
export interface PeriodRow { fiscal_year: number; period_no: number; starts_on: string; ends_on: string; status: string }
interface RevalLine { documentId: string; docNo: string | null; side: 'AR' | 'AP'; currency: string; openFx: string; originalRate: string; closingRate: string; carrying: string; revalued: string; adjustment: string }

const SOURCE: Record<RateRow['source'], string> = { bot_mid: 'อัตรากลาง ธปท.', bot_buy: 'อัตรารับซื้อ ธปท.', bot_sell: 'อัตราขาย ธปท.' };
const STATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };
const H2 = 'margin: 0; font-size: 17px; line-height: 24px; font-weight: 600';
const BOX = 'border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 16px';
const FORM = 'display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px; align-items: end';
const IN = css(P2A_INPUT);
const isoOf = (t: string): string | null => (t.trim() ? parseThaiDate(t.trim()) : null);

export function FxScreen({ modules, currencies, rates, filter, settings, runs, periods, current, branches, today }: {
  modules: CompanyModules; currencies: Currency[]; rates: RateRow[]; filter: { currency: string; from: string; to: string }; settings: FxSettings | null;
  runs: RevalRun[]; periods: PeriodRow[]; current: { year: number; period: number }; branches: Branch[]; today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ at: string; kind: 'ok' | 'err'; text: string } | null>(null);
  const [cur, setCur] = useState({ code: '', name: '', decimals: '2' });
  const [rate, setRate] = useState({ currency: currencies[0]?.code ?? '', date: thaiDate(today), rate: '', source: settings?.rateSource ?? 'bot_mid' });
  const [flt, setFlt] = useState({ currency: filter.currency, from: filter.from ? thaiDate(filter.from) : '', to: filter.to ? thaiDate(filter.to) : '' });
  const [per, setPer] = useState(`${current.year}-${current.period}`);
  const [preview, setPreview] = useState<{ asOf: string; lines: RevalLine[] } | null>(null);
  const blankBranch = { code: '', name: '', address: '', taxId: '', filesSeparately: true, active: true };
  const [br, setBr] = useState(blankBranch);
  const [editing, setEditing] = useState(false);

  async function run(at: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, ok: string, after?: () => void) {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setMsg({ at, kind: 'err', text: r.error }); return false; }
    setMsg({ at, kind: 'ok', text: ok });
    after?.();
    router.refresh();
    return true;
  }
  const note = (at: string): ReactNode => (msg?.at === at
    ? <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div> : null);
  const off = (what: string) => (
    <p style={css(S.note)}>{`ยังไม่ได้เปิดโมดูล${what} — `}<a href="/settings/modules">เปิดที่ ตั้งค่า / โมดูล</a></p>
  );

  // ---------- สกุลเงิน ----------
  function saveCurrency() {
    const code = cur.code.trim().toUpperCase();
    void run('cur', () => req(`fx/currencies/${encodeURIComponent(code)}`, 'PUT', { name: cur.name.trim(), decimals: Number(cur.decimals) }), `บันทึกสกุล ${code} แล้ว`, () => setCur({ code: '', name: '', decimals: '2' }));
  }
  const toggleCurrency = (c: Currency) => void run('cur', () => req(`fx/currencies/${c.code}`, 'PUT', { name: c.name, decimals: c.decimals, active: !c.active }), `${c.active ? 'ปิดใช้' : 'เปิดใช้'} ${c.code} แล้ว`);

  // ---------- อัตรา ----------
  const rateCur = rate.currency || currencies.find((c) => c.active)?.code || '';
  function saveRate() {
    const date = isoOf(rate.date);
    if (!date) { setMsg({ at: 'rate', kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    void run('rate', () => req('fx/rates', 'PUT', { currency: rateCur, date, rate: rate.rate.replace(/,/gu, '').trim(), source: rate.source }), `บันทึกอัตรา ${rateCur} ${rate.date} แล้ว`, () => setRate({ ...rate, rate: '' }));
  }
  function deleteRate(r: RateRow) {
    if (!window.confirm(`ลบอัตรา ${r.currency} ${thaiDate(r.rate_date)} (${SOURCE[r.source]})?`)) return;
    void run('rate', () => req(`fx/rates/${r.currency}/${r.rate_date}?source=${r.source}`, 'DELETE'), 'ลบอัตราแล้ว');
  }
  function applyFilter() {
    const from = isoOf(flt.from);
    const to = isoOf(flt.to);
    if ((flt.from.trim() && !from) || (flt.to.trim() && !to)) { setMsg({ at: 'rate', kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return; }
    const qs = new URLSearchParams({ ...(flt.currency ? { currency: flt.currency } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    router.push(`/fx${qs ? `?${qs}` : ''}`);
  }

  // ---------- ปรับมูลค่าสิ้นงวด ----------
  const [py, pn] = per.split('-').map(Number) as [number, number];
  async function loadPreview() {
    setBusy(true); setMsg(null);
    const r = await req<{ asOf: string; lines: RevalLine[] }>(`fx/revaluation/${py}/${pn}/preview`);
    setBusy(false);
    if (!r.ok) { setPreview(null); setMsg({ at: 'reval', kind: 'err', text: r.error }); return; }
    setPreview(r.data);
  }
  function runReval() {
    if (!window.confirm(`ลงบัญชีปรับมูลค่าอัตราแลกเปลี่ยนงวด ${pn}/${py} และกลับรายการวันแรกของงวดถัดไป?`)) return;
    void run('reval', async () => {
      const r = await req<{ total: string; journalNo: string | null; reversalNo: string | null }>(`fx/revaluation/${py}/${pn}`, 'POST', {});
      if (r.ok) setMsg(null);
      return r.ok ? { ok: true as const, data: r.data } : r;
    }, 'ลงบัญชีปรับมูลค่าแล้ว', () => setPreview(null));
  }
  // กำไร (+) / ขาดทุน (−): ลูกหนี้เพิ่ม = กำไร · เจ้าหนี้เพิ่ม = ขาดทุน
  const adjTotal = preview ? fromCents(preview.lines.reduce((s, l) => s + toCents(l.adjustment) * (l.side === 'AR' ? 1n : -1n), 0n)) : '0.00';

  // ---------- สาขา ----------
  function saveBranch() {
    void run('branch', () => req(`branches/${encodeURIComponent(br.code.trim())}`, 'PUT', {
      name: br.name.trim(), address: br.address.trim() || null, taxId: br.taxId.trim() || null, filesSeparately: br.filesSeparately, active: br.active,
    }), `บันทึกสาขา ${br.code} แล้ว`, () => { setBr(blankBranch); setEditing(false); });
  }
  const editBranch = (b: Branch) => { setBr({ code: b.code, name: b.name, address: b.address ?? '', taxId: b.tax_id ?? '', filesSeparately: b.files_separately, active: b.active }); setEditing(true); };

  return (
    <>
      <TopBar crumb="โมดูลเพิ่มเติม / สกุลเงิน และสาขา" />
      <div style={css(S.content)}>
        <TempBanner />
        <div><h1 style={css(S.h1)}>สกุลเงิน อัตราแลกเปลี่ยน และสาขา</h1>
          <span style={css(S.sub)}>เอกสารเก็บยอดเป็นสกุลเอกสาร · บัญชีลงเป็นบาทเสมอ (ยอด × อัตรา) · รับ/จ่ายล้างลูกหนี้/เจ้าหนี้ตามอัตราเดิม ผลต่างลงกำไร/ขาดทุนจากอัตราแลกเปลี่ยน</span></div>

        {/* ---------- สกุลเงิน ---------- */}
        <section aria-label="สกุลเงิน" style={css(BOX)}>
          <h2 style={css(H2)}>สกุลเงิน</h2>
          {!modules.multi_currency ? off('หลายสกุลเงิน') : (<>
            <div style={css(S.tableBox)}>
              <table style={css(S.table)}>
                <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>รหัส</th><th style={css(S.th)}>ชื่อ</th><th style={css(`${S.th}; text-align: right`)}>ทศนิยม</th><th style={css(S.th)}>สถานะ</th><th style={css(S.th)}></th></tr></thead>
                <tbody>
                  <tr style={css(S.tr)}><td style={css('height: 40px; padding: 0 12px; font-weight: 600')}>THB</td><td style={css(S.td)}>บาท (สกุลหลัก)</td><td style={css(S.num)}>2</td><td style={css(S.td)}><Tag kind="info">สกุลหลัก</Tag></td><td></td></tr>
                  {currencies.map((c) => (
                    <tr key={c.code} style={css(S.tr)}>
                      <td style={css('height: 40px; padding: 0 12px; font-weight: 600')}>{c.code}</td><td style={css(S.td)}>{c.name}</td><td style={css(S.num)}>{c.decimals}</td>
                      <td style={css(S.td)}>{c.active ? <Tag kind="success">ใช้งาน</Tag> : <Tag kind="neutral">ปิดใช้</Tag>}</td>
                      <td style={css('padding: 0 12px; text-align: right; white-space: nowrap')}>
                        <Button kind="ghost" size={32} onClick={() => setCur({ code: c.code, name: c.name, decimals: String(c.decimals) })}>แก้ไข</Button>
                        <Button kind="ghost" size={32} disabled={busy} onClick={() => toggleCurrency(c)}>{c.active ? 'ปิดใช้' : 'เปิดใช้'}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={css(FORM)}>
              <label style={css(P2A_LABEL)}>รหัสสกุล (ISO 4217)<input value={cur.code} maxLength={3} placeholder="USD" onChange={(e) => setCur({ ...cur, code: e.target.value.toUpperCase() })} style={IN} /></label>
              <label style={css(P2A_LABEL)}>ชื่อ<input value={cur.name} placeholder="ดอลลาร์สหรัฐ" onChange={(e) => setCur({ ...cur, name: e.target.value })} style={IN} /></label>
              <label style={css(P2A_LABEL)}>ทศนิยม<select value={cur.decimals} onChange={(e) => setCur({ ...cur, decimals: e.target.value })} style={IN}><option value="2">2</option><option value="0">0</option><option value="1">1</option></select></label>
              <div><Button kind="primary" disabled={busy || !cur.code.trim() || !cur.name.trim()} onClick={saveCurrency}>บันทึกสกุลเงิน</Button></div>
            </div>
            {note('cur')}
          </>)}
        </section>

        {/* ---------- อัตราแลกเปลี่ยน ---------- */}
        <section aria-label="อัตราแลกเปลี่ยน" style={css(BOX)}>
          <div style={css('display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center')}>
            <h2 style={css(H2)}>อัตราแลกเปลี่ยน (บาทต่อ 1 หน่วย)</h2>
            {settings && <span style={css('display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: #525252')}>{`แหล่งอัตราที่ใช้: ${SOURCE[settings.rateSource]} (fx.rate_source)`} <PendingAuditor /></span>}
          </div>
          {!modules.multi_currency ? off('หลายสกุลเงิน') : (<>
            <div style={css(FORM)}>
              <label style={css(P2A_LABEL)}>สกุล<select aria-label="สกุลของอัตรา" value={rateCur} onChange={(e) => setRate({ ...rate, currency: e.target.value })} style={IN}>{currencies.filter((c) => c.active).map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}</select></label>
              <label style={css(P2A_LABEL)}>วันที่<input value={rate.date} placeholder="วว/ดด/ปปปป" onChange={(e) => setRate({ ...rate, date: e.target.value })} style={css(`${P2A_INPUT}; font-variant-numeric: tabular-nums`)} /></label>
              <label style={css(P2A_LABEL)}>อัตรา (บาท)<input value={rate.rate} inputMode="decimal" placeholder="33.250000" onChange={(e) => setRate({ ...rate, rate: e.target.value })} style={css(`${P2A_INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} /></label>
              <label style={css(P2A_LABEL)}>แหล่งอัตรา<select value={rate.source} onChange={(e) => setRate({ ...rate, source: e.target.value as RateRow['source'] })} style={IN}>{Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <div style={css('grid-column: 4')}><Button kind="primary" disabled={busy || !rateCur || !rate.rate.trim()} onClick={saveRate}>บันทึกอัตรา</Button></div>
            </div>
            <div style={css('display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid #e0e0e0')}>
              <label style={css(`${P2A_LABEL}; width: 200px`)}>กรองสกุล<select value={flt.currency} onChange={(e) => setFlt({ ...flt, currency: e.target.value })} style={IN}><option value="">ทุกสกุล</option>{currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
              <label style={css(`${P2A_LABEL}; width: 180px`)}>ตั้งแต่<input value={flt.from} placeholder="วว/ดด/ปปปป" onChange={(e) => setFlt({ ...flt, from: e.target.value })} style={css(`${P2A_INPUT}; font-variant-numeric: tabular-nums`)} /></label>
              <label style={css(`${P2A_LABEL}; width: 180px`)}>ถึง<input value={flt.to} placeholder="วว/ดด/ปปปป" onChange={(e) => setFlt({ ...flt, to: e.target.value })} style={css(`${P2A_INPUT}; font-variant-numeric: tabular-nums`)} /></label>
              <Button onClick={applyFilter}>กรอง</Button>
              {(filter.currency || filter.from || filter.to) && <Button kind="ghost" onClick={() => router.push('/fx')}>ล้างตัวกรอง</Button>}
            </div>
            <div style={css(S.tableBox)}>
              <table style={css(S.table)}>
                <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>สกุล</th><th style={css(S.th)}>แหล่ง</th><th style={css(`${S.th}; text-align: right`)}>อัตรา (บาท)</th><th style={css(S.th)}></th></tr></thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={`${r.currency}-${r.rate_date}-${r.source}`} style={css(S.tr)}>
                      <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{thaiDate(r.rate_date)}</td><td style={css(S.td)}>{r.currency}</td><td style={css(S.td)}>{SOURCE[r.source]}</td>
                      <td style={css(S.num)}>{rateText(r.rate)}</td>
                      <td style={css('padding: 0 12px; text-align: right')}><Button kind="ghost" size={32} disabled={busy} onClick={() => deleteRate(r)}>ลบ</Button></td>
                    </tr>
                  ))}
                  {!rates.length && <tr style={css(S.tr)}><td colSpan={5} style={css('height: 40px; padding: 0 12px; color: #525252')}>ยังไม่มีอัตรา</td></tr>}
                </tbody>
              </table>
            </div>
            {note('rate')}
          </>)}
        </section>

        {/* ---------- ปรับมูลค่าสิ้นงวด ---------- */}
        <section aria-label="ปรับมูลค่าสิ้นงวด" style={css(BOX)}>
          <div style={css('display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center')}>
            <h2 style={css(H2)}>ปรับมูลค่าลูกหนี้/เจ้าหนี้สกุลต่างประเทศสิ้นงวด</h2>
            {settings && <span style={css('display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: #525252')}>{`fx.revalue_period_end = ${settings.revaluePeriodEnd ? 'เปิด' : 'ปิด'}`} <PendingAuditor /></span>}
          </div>
          {!modules.multi_currency ? off('หลายสกุลเงิน') : (<>
            <p style={css(S.note)}>{'ลงบัญชีกำไร/ขาดทุนที่ยังไม่เกิดขึ้นจริง ณ วันสิ้นงวด (อัตราตามแหล่งที่ตั้ง) แล้วกลับรายการวันแรกของงวดถัดไปอัตโนมัติ · รันได้ครั้งเดียวต่องวด'}
              {settings && !settings.revaluePeriodEnd && <> · <span style={css('color: #684e00')}>ตอนนี้ปิดอยู่ (ค่าตั้งต้นชั่วคราว) — ดูตัวอย่างได้ แต่ลงบัญชีไม่ได้จนกว่าจะเปิดที่ <a href="/settings/modules">ตั้งค่า / โมดูล</a></span></>}</p>
            <div style={css('display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap')}>
              <label style={css(`${P2A_LABEL}; width: 260px`)}>งวด<select value={per} onChange={(e) => { setPer(e.target.value); setPreview(null); }} style={IN}>
                {periods.map((p) => <option key={`${p.fiscal_year}-${p.period_no}`} value={`${p.fiscal_year}-${p.period_no}`}>{`งวด ${p.period_no}/${p.fiscal_year} · สิ้นงวด ${thaiDate(p.ends_on)} · ${STATUS[p.status] ?? p.status}`}</option>)}
                {!periods.length && <option value={per}>{`งวด ${pn}/${py}`}</option>}
              </select></label>
              <Button disabled={busy} onClick={() => void loadPreview()}>ดูตัวอย่าง</Button>
              <Button kind="primary" disabled={busy || settings?.revaluePeriodEnd === false || !preview || !preview.lines.length || runs.some((r) => r.fiscal_year === py && r.period_no === pn)} onClick={runReval}>ลงบัญชีปรับมูลค่า</Button>
            </div>
            {preview && (
              <div style={css(S.tableBox)}>
                <div style={css('padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>{`ยอดคงค้าง ณ ${thaiDate(preview.asOf)} · ${preview.lines.length} รายการ`}</div>
                <table style={css(`${S.table}; min-width: 900px`)}>
                  <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>เอกสาร</th><th style={css(S.th)}>ด้าน</th><th style={css(S.th)}>สกุล</th><th style={css(`${S.th}; text-align: right`)}>ยอดค้าง (สกุลเอกสาร)</th><th style={css(`${S.th}; text-align: right`)}>อัตราเดิม</th><th style={css(`${S.th}; text-align: right`)}>อัตราสิ้นงวด</th><th style={css(`${S.th}; text-align: right`)}>มูลค่าตามบัญชี (บาท)</th><th style={css(`${S.th}; text-align: right`)}>มูลค่าใหม่ (บาท)</th><th style={css(`${S.th}; text-align: right`)}>ปรับปรุง</th></tr></thead>
                  <tbody>
                    {preview.lines.map((l) => (
                      <tr key={l.documentId} style={css(S.tr)}>
                        <td style={css('height: 40px; padding: 0 12px')}>{l.docNo ?? '—'}</td><td style={css(S.td)}>{l.side === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'}</td><td style={css(S.td)}>{l.currency}</td>
                        <td style={css(S.num)}>{money(l.openFx)}</td><td style={css(S.num)}>{rateText(l.originalRate)}</td><td style={css(S.num)}>{rateText(l.closingRate)}</td>
                        <td style={css(S.num)}>{money(l.carrying)}</td><td style={css(S.num)}>{money(l.revalued)}</td><td style={css(S.num)}>{money(l.adjustment, { paren: true })}</td>
                      </tr>
                    ))}
                    {!preview.lines.length && <tr style={css(S.tr)}><td colSpan={9} style={css('height: 40px; padding: 0 12px; color: #525252')}>ไม่มียอดค้างสกุลต่างประเทศ ณ สิ้นงวด</td></tr>}
                  </tbody>
                  {preview.lines.length > 0 && <tfoot><tr style={css(S.tfoot)}><td colSpan={8} style={css('height: 40px; padding: 0 12px')}>กำไร (ขาดทุน) สุทธิที่ยังไม่เกิดขึ้นจริง</td><td style={css(S.num)}>{money(adjTotal, { paren: true })}</td></tr></tfoot>}
                </table>
              </div>
            )}
            {note('reval')}
            <div style={css(S.tableBox)}>
              <div style={css('padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>{`ประวัติการปรับมูลค่า ปี ${current.year}`}</div>
              <table style={css(S.table)}>
                <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>งวด</th><th style={css(S.th)}>วันที่อัตรา</th><th style={css(`${S.th}; text-align: right`)}>กำไร (ขาดทุน)</th><th style={css(S.th)}>รายการบัญชี</th><th style={css(S.th)}>กลับรายการ</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={`${r.fiscal_year}-${r.period_no}`} style={css(S.tr)}>
                      <td style={css('height: 40px; padding: 0 12px')}>{`${r.period_no}/${r.fiscal_year}`}</td><td style={css(S.td)}>{thaiDate(r.rate_date)}</td><td style={css(S.num)}>{money(r.total, { paren: true })}</td>
                      <td style={css(S.td)}>{r.journal_no ? <a href={`/gl/journal?no=${encodeURIComponent(r.journal_no)}`}>{r.journal_no}</a> : '—'}</td>
                      <td style={css(S.td)}>{r.reversal_no ? <><a href={`/gl/journal?no=${encodeURIComponent(r.reversal_no)}`}>{r.reversal_no}</a>{r.reversal_date ? ` · ${thaiDate(r.reversal_date)}` : ''}</> : '—'}</td>
                    </tr>
                  ))}
                  {!runs.length && <tr style={css(S.tr)}><td colSpan={5} style={css('height: 40px; padding: 0 12px; color: #525252')}>ยังไม่เคยปรับมูลค่า</td></tr>}
                </tbody>
              </table>
            </div>
          </>)}
        </section>

        {/* ---------- สาขา ---------- */}
        <section id="branches" aria-label="สาขา" style={css(BOX)}>
          <div style={css('display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center')}>
            <h2 style={css(H2)}>ทะเบียนสาขา</h2>
            {settings && <span style={css('display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: #525252')}>{`เลขที่เอกสาร: ${settings.numbering === 'per_branch' ? 'แยกต่อสาขา' : 'ร่วมทุกสาขา'} · ภ.พ.30: ${settings.vatFiling === 'combined' ? 'ยื่นรวม' : 'ยื่นแยกสาขา'}`} <PendingAuditor /></span>}
          </div>
          {!modules.branches ? off('สาขา') : (<>
            <div style={css(S.tableBox)}>
              <table style={css(`${S.table}; min-width: 900px`)}>
                <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>รหัส</th><th style={css(S.th)}>ชื่อสาขา</th><th style={css(S.th)}>ที่อยู่</th><th style={css(S.th)}>เลขผู้เสียภาษี</th><th style={css(S.th)}>ยื่น ภ.พ.30 แยก</th><th style={css(S.th)}>สถานะ</th><th style={css(S.th)}></th></tr></thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.code} style={css(S.tr)}>
                      <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums; font-weight: 600')}>{b.code}</td><td style={css(S.td)}>{b.name}</td>
                      <td style={css('padding: 8px 12px; color: #525252')}>{b.address ?? '—'}</td><td style={css('padding: 0 12px; font-variant-numeric: tabular-nums')}>{b.tax_id ?? '—'}</td>
                      <td style={css(S.td)}>{b.files_separately ? 'ใช่' : 'ไม่ใช่'}</td><td style={css(S.td)}>{b.active ? <Tag kind="success">ใช้งาน</Tag> : <Tag kind="neutral">ปิดใช้</Tag>}</td>
                      <td style={css('padding: 0 12px; text-align: right')}><Button kind="ghost" size={32} onClick={() => editBranch(b)}>แก้ไข</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={css(FORM)}>
              <label style={css(P2A_LABEL)}>รหัสสาขา (5 หลัก)<input value={br.code} readOnly={editing} maxLength={5} inputMode="numeric" placeholder="00001" onChange={(e) => setBr({ ...br, code: e.target.value })} style={css(`${P2A_INPUT}; font-variant-numeric: tabular-nums`)} /></label>
              <label style={css(P2A_LABEL)}>ชื่อสาขา<input value={br.name} onChange={(e) => setBr({ ...br, name: e.target.value })} style={IN} /></label>
              <label style={css(`grid-column: span 2; ${P2A_LABEL}`)}>ที่อยู่<input value={br.address} onChange={(e) => setBr({ ...br, address: e.target.value })} style={IN} /></label>
              <label style={css(P2A_LABEL)}>เลขผู้เสียภาษี (13 หลัก · ว่าง = ของบริษัท)<input value={br.taxId} maxLength={13} inputMode="numeric" onChange={(e) => setBr({ ...br, taxId: e.target.value })} style={css(`${P2A_INPUT}; font-variant-numeric: tabular-nums`)} /></label>
              <label style={css('display: flex; gap: 8px; align-items: center; font-size: 14px; height: 40px')}><input type="checkbox" checked={br.filesSeparately} onChange={(e) => setBr({ ...br, filesSeparately: e.target.checked })} /> ยื่น ภ.พ.30 แยกสาขานี้</label>
              <label style={css('display: flex; gap: 8px; align-items: center; font-size: 14px; height: 40px')}><input type="checkbox" checked={br.active} onChange={(e) => setBr({ ...br, active: e.target.checked })} /> ใช้งาน</label>
              <div style={css('display: flex; gap: 8px')}>
                {editing && <Button onClick={() => { setBr(blankBranch); setEditing(false); }}>ยกเลิก</Button>}
                <Button kind="primary" disabled={busy || !br.code.trim() || !br.name.trim()} onClick={saveBranch}>{editing ? 'บันทึกการแก้ไข' : 'เพิ่มสาขา'}</Button>
              </div>
            </div>
            {note('branch')}
          </>)}
        </section>
      </div>
    </>
  );
}
