'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// /contracts — ตัวชี้วัด · รายการสัญญา · รอบบิล (ทุกสัญญา) · รับรู้รายได้รายงวด · สินทรัพย์ไม่มีตัวตน (ซอฟต์แวร์)
// API: POST /v1/contracts/billing-run · POST /v1/revenue-recognition/:year/:no (+/void) · POST /v1/intangible-assets — error 422 ภาษาไทยแสดงในกล่องข้อความของแต่ละส่วน
import { Button, ButtonLink, css, href, money, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '../sales/_lib/client';
import { Msg } from '../sales/_lib/ui';
import { ContractStatus, CYCLE_LABEL, pct, ST, thaiYm, type ContractRow, type Metrics, type RecognitionRun } from './_lib';

type M = { kind: 'ok' | 'err'; text: string } | null;
interface Created { id: string; contract: string; periodStart: string; periodEnd: string; subtotal: string; vat: string; grandTotal: string }
interface Props { month: string; metrics: Metrics; contracts: ContractRow[]; year: number; currentYear: number; currentPeriod: number; runs: RecognitionRun[]; today: string; assetCodes: string[] }

export function ContractsScreen(p: Props) {
  return (
    <>
      <MetricsSection month={p.month} m={p.metrics} />
      <ContractList contracts={p.contracts} today={p.today} />
      <RecognitionSection year={p.year} currentYear={p.currentYear} currentPeriod={p.currentPeriod} runs={p.runs} />
      <IntangibleSection today={p.today} assetCodes={p.assetCodes} />
    </>
  );
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={css(ST.card)}>
      <span style={css(ST.cardLabel)}>{label}</span>
      <span style={css(ST.cardNum)}>{value}</span>
      {note && <span style={css('font-size: 13px; color: #525252')}>{note}</span>}
    </div>
  );
}

function MetricsSection({ month, m }: { month: string; m: Metrics }) {
  const router = useRouter();
  const c = m.churn;
  return (
    <section aria-labelledby="h-metrics" style={css('display: flex; flex-direction: column; gap: 12px')}>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap')}>
        <h2 id="h-metrics" style={css(ST.h2)}>ตัวชี้วัด ณ {thaiDate(m.asOf)}</h2>
        <label style={css(`${ST.label}; flex-direction: row; align-items: center; gap: 8px`)}>เดือนที่ดู churn
          <input type="month" value={month} onChange={(e) => { if (e.target.value) router.push(`/contracts?month=${e.target.value}`); }} style={css(`${ST.input}; height: 36px`)} />
        </label>
      </div>
      <div style={css('display: flex; gap: 12px; flex-wrap: wrap')}>
        <Card label="MRR (รายได้ประจำต่อเดือน)" value={money(m.mrr)} note={`สัญญาใช้งาน ${m.activeContracts} ฉบับ`} />
        <Card label="ARR (MRR × 12)" value={money(m.arr)} />
        <Card label="Backlog (ยังไม่รับรู้)" value={money(m.backlog)} note={`รายได้รับล่วงหน้า ${money(m.deferredRevenue)} · ยังไม่ออกบิล ${money(m.unbilled)}`} />
        <Card label={`Churn ${thaiYm(month)}`} value={c ? `${c.churnedCustomers} / ${c.customersStart} ราย` : '—'}
          note={c ? `ลูกค้า ${pct(c.customerChurnRate)} · MRR หาย ${money(c.churnedMrr)} จาก ${money(c.mrrStart)} (${pct(c.mrrChurnRate)})` : undefined} />
      </div>
    </section>
  );
}

function ContractList({ contracts, today }: { contracts: ContractRow[]; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const [created, setCreated] = useState<Created[]>([]);
  async function billing() {
    setBusy(true); setMsg(null);
    const r = await call<{ asOf: string; created: Created[] }>('contracts/billing-run', 'POST', { asOf: today });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setCreated(r.data.created);
    setMsg({ kind: 'ok', text: r.data.created.length ? `สร้างใบแจ้งหนี้ร่าง ${r.data.created.length} ใบ ณ ${thaiDate(r.data.asOf)} — ตรวจและอนุมัติที่หน้าใบแจ้งหนี้` : `ไม่มีรอบบิลที่ถึงกำหนด ณ ${thaiDate(r.data.asOf)}` });
    router.refresh();
  }
  return (
    <section aria-labelledby="h-list" style={css('display: flex; flex-direction: column; gap: 12px')}>
      <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap')}>
        <h2 id="h-list" style={css(ST.h2)}>สัญญา ({contracts.length})</h2>
        <div style={css('display: flex; gap: 8px')}>
          <Button kind="secondary" size={36} disabled={busy} onClick={() => void billing()}>รันรอบบิลทุกสัญญา ณ {thaiDate(today)}</Button>
          <ButtonLink href="/contracts/new" kind="primary" size={36}>+ สร้างสัญญา</ButtonLink>
        </div>
      </div>
      <Msg msg={msg} />
      {created.length > 0 && <CreatedDrafts rows={created} />}
      <div style={css(S.tableBox)}>
        <table style={css(`${S.table}; min-width: 1000px`)}>
          <thead><tr style={css(S.theadRow)}>
            <th style={css(S.thFirst)}>เลขที่สัญญา</th><th style={css(S.th)}>ลูกค้า</th><th style={css(S.th)}>ช่วงสัญญา</th><th style={css(S.th)}>รอบบิล</th>
            <th style={css(`${S.th}; text-align: right`)}>ยอดต่อรอบบิล</th><th style={css(`${S.th}; text-align: right`)}>ยอดครั้งเดียว</th><th style={css(`${S.th}; text-align: right`)}>ใบแจ้งหนี้ (รวมร่าง)</th><th style={css(S.th)}>สถานะ</th>
          </tr></thead>
          <tbody>
            {contracts.length === 0 && <tr style={css(S.tr)}><td colSpan={8} style={css('height: 48px; padding: 0 12px; color: #525252')}>ยังไม่มีสัญญา — กด “+ สร้างสัญญา”</td></tr>}
            {contracts.map((c) => (
              <tr key={c.id} style={css(S.tr)}>
                <td style={css('height: 40px; padding: 0 12px')}><a href={`/contracts/${c.id}`} style={css('text-decoration: none; font-weight: 500')}>{c.code}</a></td>
                <td style={css(S.td)}>{c.contact_name} <span style={css('color: #525252; font-size: 13px')}>{c.contact_code}</span></td>
                <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(c.start_date)} – {thaiDate(c.end_date)}{c.auto_renew ? ' · ต่ออายุอัตโนมัติ' : ''}</td>
                <td style={css(S.td)}>{CYCLE_LABEL[c.billing_cycle]}</td>
                <td style={css(S.num)}>{c.recurring_amount !== undefined ? money(c.recurring_amount) : '—'}</td>
                <td style={css(S.num)}>{c.one_time_amount !== undefined ? money(c.one_time_amount) : '—'}</td>
                <td style={css(S.num)}>{c.billed_total !== undefined ? money(c.billed_total) : '—'}</td>
                <td style={css(S.td)}><ContractStatus status={c.status} />{c.cancelled_on ? <span style={css('font-size: 13px; color: #525252')}> ถึง {thaiDate(c.cancelled_on)}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CreatedDrafts({ rows }: { rows: Created[] }) {
  return (
    <div style={css(S.tableBox)}>
      <table style={css(S.table)}>
        <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>ใบแจ้งหนี้ร่างที่สร้าง</th><th style={css(S.th)}>สัญญา</th><th style={css(S.th)}>รอบ</th>
          <th style={css(`${S.th}; text-align: right`)}>ก่อน VAT</th><th style={css(`${S.th}; text-align: right`)}>VAT</th><th style={css(`${S.th}; text-align: right`)}>รวม</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} style={css(S.tr)}>
            <td style={css('height: 40px; padding: 0 12px')}><a href={href('invoice') + `/${r.id}`} style={css('text-decoration: none')}>เปิดใบแจ้งหนี้ร่าง → อนุมัติ</a></td>
            <td style={css(S.td)}>{r.contract}</td>
            <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.periodStart)} – {thaiDate(r.periodEnd)}</td>
            <td style={css(S.num)}>{money(r.subtotal)}</td><td style={css(S.num)}>{money(r.vat)}</td><td style={css(S.num)}>{money(r.grandTotal)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function RecognitionSection({ year, currentYear, currentPeriod, runs }: { year: number; currentYear: number; currentPeriod: number; runs: RecognitionRun[] }) {
  const router = useRouter();
  const [no, setNo] = useState(year === currentYear ? currentPeriod : 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const active = runs.filter((r) => !r.voided_at);
  const lastActive = active.reduce((a, r) => Math.max(a, r.period_no), 0);
  async function run() {
    setBusy(true); setMsg(null);
    const r = await call<{ total: string; journalNo: string | null; rows: number }>(`revenue-recognition/${year}/${no}`, 'POST', {});
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: r.data.journalNo ? `บันทึก ${r.data.journalNo} รับรู้รายได้งวด ${no}/${year} ยอด ${money(r.data.total)} (${r.data.rows} รายการตาราง)` : `งวด ${no}/${year} ไม่มีรายได้รับล่วงหน้าที่ต้องรับรู้` });
    router.refresh();
  }
  async function voidRun(p: number) {
    setBusy(true); setMsg(null);
    const r = await call<{ reversal: string }>(`revenue-recognition/${year}/${p}/void`, 'POST', { reason });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setVoiding(null); setReason('');
    setMsg({ kind: 'ok', text: `ยกเลิกการรับรู้งวด ${p}/${year} แล้ว — กลับรายการ ${r.data.reversal}` });
    router.refresh();
  }
  return (
    <section aria-labelledby="h-rec" style={css(ST.box)}>
      <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap')}>
        <div><h2 id="h-rec" style={css(ST.h2)}>รับรู้รายได้รับล่วงหน้ารายงวด</h2>
          <span style={css('font-size: 13px; color: #525252')}>JV Dr 2170100 รายได้รับล่วงหน้า / Cr รายได้ · ลงวันสิ้นงวด · รันได้ครั้งเดียวต่องวด (เหมือนค่าเสื่อม) · รับรู้เฉพาะใบแจ้งหนี้ที่อนุมัติแล้ว</span></div>
        <label style={css(`${ST.label}; flex-direction: row; align-items: center; gap: 8px`)}>ปีบัญชี
          <select value={year} onChange={(e) => router.push(`/contracts?year=${e.target.value}`)} style={css(`${ST.input}; height: 36px`)}>
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <Msg msg={msg} />
      <div style={css('display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap')}>
        <label style={css(ST.label)}>งวด
          <select aria-label="งวดที่รับรู้" value={no} onChange={(e) => setNo(Number(e.target.value))} style={css(`${ST.input}; height: 36px; width: 120px`)}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}/{year}</option>)}
          </select>
        </label>
        <Button kind="primary" size={36} disabled={busy || active.some((r) => r.period_no === no)} onClick={() => void run()}>รันรับรู้รายได้งวด {no}</Button>
      </div>
      <div style={css(S.tableBox)}>
        <table style={css(S.table)}>
          <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>งวด</th><th style={css(S.th)}>เลขที่ JV</th><th style={css(S.th)}>ลงวันที่</th><th style={css(`${S.th}; text-align: right`)}>ยอดรับรู้</th><th style={css(S.th)}>สถานะ</th><th style={css(S.th)}></th></tr></thead>
          <tbody>
            {runs.length === 0 && <tr style={css(S.tr)}><td colSpan={6} style={css('height: 40px; padding: 0 12px; color: #525252')}>ยังไม่มีการรับรู้รายได้ในปี {year}</td></tr>}
            {runs.map((r, i) => (
              <tr key={`${r.period_no}-${i}`} style={css(S.tr)}>
                <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{r.period_no}/{year}</td>
                <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{r.journal_no}</td>
                <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.journal_date)}</td>
                <td style={css(S.num)}>{money(r.total)}</td>
                <td style={css(S.td)}>{r.voided_at ? <Tag kind="error">ยกเลิกแล้ว (กลับรายการ)</Tag> : <Tag kind="success">บันทึกแล้ว</Tag>}</td>
                <td style={css(`${S.td}; text-align: right`)}>
                  {!r.voided_at && voiding !== r.period_no && <Button kind="danger" size={32} disabled={busy || r.period_no !== lastActive} onClick={() => { setVoiding(r.period_no); setReason(''); }}>ยกเลิกการรับรู้</Button>}
                  {!r.voided_at && voiding === r.period_no && (
                    <span style={css('display: inline-flex; gap: 8px; align-items: center')}>
                      <input aria-label="เหตุผลการยกเลิก" placeholder="เหตุผลการยกเลิก" value={reason} onChange={(e) => setReason(e.target.value)} style={css(`${ST.cell}; width: 220px`)} />
                      <Button kind="danger" size={32} disabled={busy} onClick={() => void voidRun(r.period_no)}>ยืนยันยกเลิก</Button>
                      <Button kind="ghost" size={32} onClick={() => setVoiding(null)}>ปิด</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span style={css('font-size: 13px; color: #525252')}>ยกเลิกได้เฉพาะงวดล่าสุดที่รับรู้ (ต้องยกเลิกงวดหลังก่อน) · เลข JV เดิมคงอยู่ + JV กลับรายการ</span>
    </section>
  );
}

function IntangibleSection({ today, assetCodes }: { today: string; assetCodes: string[] }) {
  const router = useRouter();
  const [f, setF] = useState({ code: '', name: '', origin: 'purchased' as 'purchased' | 'internal_dev', startDate: today, lifeYears: '3', cost: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    // POST /v1/assets ใช้รหัสเป็น key (upsert) → กันรหัสซ้ำที่หน้าจอ ไม่ให้ทับทรัพย์สินเดิม
    if (assetCodes.includes(f.code.trim())) { setMsg({ kind: 'err', text: `รหัส ${f.code.trim()} มีในทะเบียนทรัพย์สินแล้ว — ใช้รหัสอื่น` }); return; }
    setBusy(true); setMsg(null);
    const r = await call<{ ok: true }>('intangible-assets', 'POST', { code: f.code.trim(), name: f.name.trim(), origin: f.origin, startDate: f.startDate, lifeYears: f.lifeYears, cost: f.cost.replace(/,/gu, '') });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: `บันทึกสินทรัพย์ ${f.code} แล้ว — ดูและตัดจำหน่ายที่ทะเบียนทรัพย์สิน` });
    setF({ ...f, code: '', name: '', cost: '' });
    router.refresh();
  }
  return (
    <section aria-labelledby="h-intangible" style={css(ST.box)}>
      <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap')}>
        <div><h2 id="h-intangible" style={css(ST.h2)}>สินทรัพย์ไม่มีตัวตน (ซอฟต์แวร์)</h2>
          <span style={css('font-size: 13px; color: #525252')}>บัญชี 1600100 · ตัดจำหน่ายเส้นตรงด้วยค่าเสื่อมรายเดือนเดิม (Dr 5150400 / Cr 1600190) · ซาก 0.00 · พัฒนาเองบันทึกได้เมื่อเปิด asset.intangible.capitalize_dev (รอผู้สอบบัญชี)</span></div>
        <ButtonLink href={href('assets')} kind="ghost" size={36}>ดูในทะเบียนทรัพย์สิน →</ButtonLink>
      </div>
      <Msg msg={msg} />
      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px 24px; align-items: end')}>
        <label style={css(ST.label)}>รหัสสินทรัพย์<input value={f.code} onChange={set('code')} placeholder="เช่น SW-0001" style={css(ST.input)} /></label>
        <label style={css(ST.label)}>ชื่อ<input value={f.name} onChange={set('name')} placeholder="เช่น ลิขสิทธิ์ซอฟต์แวร์บัญชี" style={css(ST.input)} /></label>
        <label style={css(ST.label)}>ที่มา<select value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value as 'purchased' | 'internal_dev' })} style={css(ST.input)}>
          <option value="purchased">ซื้อมา</option><option value="internal_dev">พัฒนาเอง (รอยืนยัน)</option></select></label>
        <label style={css(ST.label)}>วันที่เริ่มใช้<input type="date" value={f.startDate} onChange={set('startDate')} style={css(ST.input)} /></label>
        <label style={css(ST.label)}>อายุ (ปี)<input inputMode="decimal" value={f.lifeYears} onChange={set('lifeYears')} style={css(`${ST.input}; text-align: right`)} /></label>
        <label style={css(ST.label)}>ราคาทุน (บาท)<input inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="0.00" style={css(`${ST.input}; text-align: right; font-variant-numeric: tabular-nums`)} /></label>
        <div><Button kind="primary" disabled={busy || !f.code.trim() || !f.name.trim() || !f.cost.trim()} onClick={() => void save()}>บันทึกสินทรัพย์ไม่มีตัวตน</Button></div>
      </div>
    </section>
  );
}
