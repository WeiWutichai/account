'use client';
// F6 กระทบยอดธนาคาร — design/project/ScreenBankRecon.dc.html
// ยอดทุกตัวมาจาก GET /v1/bank/:account/reconciliation · จับคู่เอง/พักไว้ = PUT /v1/bank/lines/:id · นำเข้า = POST /v1/bank/:account/statement (จับคู่อัตโนมัติต่อทันที)
// TODO(Wei) ScreenBankRecon.dc.html: "พักไว้" ในแบบร่างระบุ "พักไว้ก่อน: 2190100 เงินรับรอตรวจสอบ" แต่ backend ตอนนี้ = ทำเครื่องหมาย "ไม่สนใจ" (ignored) ไม่ได้ลงบัญชีพัก 2190100 — ต้องยืนยันว่าจะให้ลงบัญชีพักจริงหรือไม่
// TODO(backend) ScreenBankRecon.dc.html: จับคู่ 1 ต่อหลาย (PV2611-0031 + 0032 + 0033) — PUT bank/lines/:id รับได้ journal เดียว · ยังไม่แสดงข้อเสนอแบบหลายรายการ
// TODO(Wei) ScreenBankRecon.dc.html: กฎ "ดอกเบี้ยรับ (หัก ณ ที่จ่าย 15% แล้ว)" ต้องคำนวณยอดก่อนหักภาษีจากยอดสุทธิ — เป็นเรื่องภาษี ยังไม่ทำ (แสดงเป็นรายการที่ไม่มีเอกสาร)
// TODO(backend) ScreenBankRecon.dc.html: "ปิดกระทบยอดเดือนนี้" (ล็อกรายการธนาคารของเดือน) และ "พิมพ์งบกระทบยอด" ยังไม่มี API — ปุ่มคงตามแบบร่างแต่ยังไม่ทำงาน · OFX ยังไม่รองรับ (CSV เท่านั้น)
import { Button, buttonStyle, css, href, money, shortDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { call } from '../../sales/_lib/client';
import { fromCents, toCents } from '../../sales/_lib/num';
import { Msg } from '../../sales/_lib/ui';

interface StLine { id: string; line_date: string; description: string; amount: string; ref: string | null }
interface GlLine { id: string; journal_no: string; journal_date: string; description: string | null; debit: string; credit: string }
/** จำนวนรายการ (ไม่ใช่ยอดเงิน) */
type Count = number;
export interface Recon { statementBalance: string; glBalance: string; diff: string; unmatchedStatement: StLine[]; unmatchedGl: GlLine[]; matched: Count; total: Count }
interface Props {
  banks: { code: string; label: string }[]; account: string; year: number; period: number; from: string; asOf: string; rec: Recon;
  matchedGl: { date: string; journal_no: string; description: string | null; debit: string; credit: string }[];
}

const CELL = 'border: 1px solid #e0e0e0; padding: 8px 12px; display: flex; justify-content: space-between; gap: 12px';
const CELL_ON = 'border: 1px solid #0f62fe; background: #edf5ff; padding: 8px 12px; display: flex; justify-content: space-between; gap: 12px';
const RIGHT = 'border: 1px solid #e0e0e0; padding: 8px 12px; display: flex; justify-content: space-between; gap: 12px; align-items: center';
const RIGHT_ON = 'border: 1px solid #0f62fe; padding: 8px 12px; display: flex; justify-content: space-between; gap: 12px; align-items: center';
const TAB = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 36px; padding: 0 16px; background: transparent; color: #0f62fe; border: 1px solid transparent';
const SUB = 'font-size: 13px; color: #525252';
const NUM = 'font-variant-numeric: tabular-nums';
const FEE = /FEE|ค่าธรรมเนียม/iu;
const amt = (v: string) => money(v, { paren: true });
const glAmount = (g: { debit: string; credit: string }) => fromCents(toCents(g.debit) - toCents(g.credit));
const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000);

export function BankReconScreen({ banks, account, year, period, from, asOf, rec, matchedGl }: Props) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'open' | 'matched' | 'carried'>('open');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const bank = banks.find((b) => b.code === account);
  const month = `${thaiMonth(period)} ${year}`;
  const current = rec.unmatchedStatement.filter((s) => s.line_date >= from);
  const carried = rec.unmatchedStatement.filter((s) => s.line_date < from);
  const glInMonth = rec.unmatchedGl.filter((g) => g.journal_date >= from);
  const diffZero = toCents(rec.diff) === 0n;

  /** ข้อเสนอจับคู่: รายการในสมุดที่ยังไม่จับคู่ ยอดเท่ากัน (ทิศเดียวกัน) วันที่ใกล้สุด */
  function proposal(s: StLine): GlLine | null {
    const c = rec.unmatchedGl.filter((g) => toCents(glAmount(g)) === toCents(s.amount));
    return c.sort((a, b) => days(a.journal_date, s.line_date) - days(b.journal_date, s.line_date))[0] ?? null;
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setMsg(null);
    const err = await fn();
    setBusy(false);
    if (err) { setMsg({ kind: 'err', text: err }); return; }
    setSearch(null);
    router.refresh();
  }
  const match = (lineId: string, journalId: string | null) => run(async () => {
    const r = await call<{ ok: boolean }>(`bank/lines/${lineId}`, 'PUT', { journalId });
    return r.ok ? null : r.error;
  });
  /** ค่าธรรมเนียมธนาคาร: สร้าง JV Dr 5401100 / Cr บัญชีธนาคาร ลงบัญชี แล้วจับคู่ (ScreenBankRecon.dc.html) */
  const createFee = (s: StLine) => run(async () => {
    const a = fromCents(-toCents(s.amount));
    const d = await call<{ id: string }>('journals', 'POST', { date: s.line_date, book: 'GJ', description: `ค่าธรรมเนียมธนาคาร ${s.description}`, auto_reverse: false, recurring: null,
      lines: [{ account_code: '5401100', debit: a }, { account_code: account, credit: a }] });
    if (!d.ok) return d.error;
    const p = await call<unknown>(`journals/${d.data.id}/post`, 'POST', {});
    if (!p.ok) return p.error;
    const m = await call<{ ok: boolean }>(`bank/lines/${s.id}`, 'PUT', { journalId: d.data.id });
    return m.ok ? null : m.error;
  });
  async function importFile(f: File) {
    if (!/\.csv$/iu.test(f.name)) { setMsg({ kind: 'err', text: 'ตอนนี้รองรับเฉพาะไฟล์ CSV (วันที่, รายการ, จำนวนเงิน, ยอดคงเหลือ)' }); return; }
    const csv = await f.text();
    await run(async () => {
      const r = await call<{ added: number; skipped: number; matched: number; remaining: number }>(`bank/${account}/statement`, 'POST', { csv, batch: f.name });
      if (!r.ok) return r.error;
      setMsg({ kind: 'ok', text: `นำเข้า ${r.data.added} รายการ · ซ้ำ ${r.data.skipped} · จับคู่อัตโนมัติ ${r.data.matched} · เหลือ ${r.data.remaining}` });
      return null;
    });
  }

  const rows = tab === 'carried' ? carried : current;
  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>การเงิน / กระทบยอดธนาคาร / {bank?.label ?? account} / {month}</span>
        <div style={css('display: flex; gap: 8px')}>
          <select aria-label="บัญชีธนาคาร" value={account} onChange={(e) => router.push(`${href('bank')}?account=${e.target.value}`)} style={css('height: 32px; padding: 0 12px; border: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 13px')}>
            {banks.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </select>
          <input ref={file} type="file" accept=".csv,.ofx,text/csv" aria-label="ไฟล์ statement" style={css('display: none')} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
          <Button size={32} disabled={busy} onClick={() => file.current?.click()}>นำเข้า statement (CSV/OFX)</Button>
        </div>
      </header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>กระทบยอด {month}</h1><span style={css(SUB)}>จับคู่อัตโนมัติ {rec.matched}/{rec.total} รายการ · เหลือ {current.length} รายการให้ตัดสินใจ</span></div>
          <table style={css('border-collapse: collapse; font-size: 14px')}><tbody>
            <tr><td style={css('padding: 0 16px 0 0; color: #525252')}>ยอดตาม statement {shortDate(asOf)}</td><td style={css('text-align: right; font-variant-numeric: tabular-nums; font-weight: 600')}>{amt(rec.statementBalance)}</td></tr>
            <tr><td style={css('padding: 0 16px 0 0; color: #525252')}>ยอดตามบัญชี (GL)</td><td style={css('text-align: right; font-variant-numeric: tabular-nums; font-weight: 600')}>{amt(rec.glBalance)}</td></tr>
            <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css(`padding: 0 16px 0 0; color: ${diffZero ? '#0e6027' : '#a2191f'}`)}>ผลต่างที่ยังไม่อธิบาย</td><td style={css(`text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: ${diffZero ? '#0e6027' : '#a2191f'}`)}>{amt(rec.diff)}</td></tr>
          </tbody></table>
        </div>
        <Msg msg={msg} />
        <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
          {([['open', `ยังไม่จับคู่ (${current.length})`], ['matched', `จับคู่แล้ว (${rec.matched})`], ['carried', `รายการค้างจากเดือนก่อน (${carried.length})`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSearch(null); }} style={css(`${TAB}${tab === k ? '; border-bottom: 2px solid #0f62fe' : ''}`)}>{label}</button>
          ))}
        </div>
        <div style={css('display: grid; grid-template-columns: minmax(0, 1fr) 48px minmax(0, 1fr); gap: 0 8px; align-items: start; font-size: 14px')}>
          <div style={css('font-size: 13px; color: #525252; padding: 0 12px 4px')}>รายการใน statement ธนาคาร</div><div></div><div style={css('font-size: 13px; color: #525252; padding: 0 12px 4px')}>รายการในสมุดบัญชี / ข้อเสนอการจับคู่</div>
          {tab === 'matched' ? matchedGl.map((g, i) => (
            <MatchedRow key={`${g.journal_no}-${i}`} first={i === 0} g={g} />
          )) : rows.map((s, i) => {
            const on = i === 0; // แบบร่าง: รายการแรกเป็นข้อเสนอที่เลือกอยู่ (กรอบน้ำเงิน)
            const p = proposal(s);
            const fee = !p && toCents(s.amount) < 0n && FEE.test(s.description);
            const dir = toCents(s.amount) < 0n ? 'โอนออก' : 'โอนเข้า';
            const lead = i === 0 ? '' : '; border-top: 0';
            return (
              <div key={s.id} style={css('display: contents')}>
                <div style={css(on ? CELL_ON : `${CELL}${lead}`)}>
                  <div><div style={css(NUM)}>{shortDate(s.line_date)} · {dir} · {s.description}</div>{s.ref && <div style={css(SUB)}>{s.ref}</div>}{!p && !fee && <div style={css('font-size: 13px; color: #a2191f')}>ไม่พบเอกสารยอดใกล้เคียง</div>}{fee && <div style={css(SUB)}>ไม่มีเอกสารในระบบ</div>}</div>
                  <strong style={css(NUM)}>{amt(s.amount)}</strong>
                </div>
                <div style={css(`height: 100%; display: flex; align-items: center; justify-content: center; color: ${on ? '#0f62fe' : '#8d8d8d'}`)}>{p ? '⇄' : fee ? '→' : '?'}</div>
                {p ? (
                  <div style={css(on ? RIGHT_ON : `${RIGHT}${lead}`)}>
                    <div><div>{p.journal_no} {p.description ?? ''}</div><div style={css('font-size: 13px; color: #0e6027')}>{days(p.journal_date, s.line_date) === 0 ? 'ยอดตรง · วันที่ตรง · ความเชื่อมั่นสูง' : `ยอดตรง · วันที่ห่าง ${days(p.journal_date, s.line_date)} วัน`}</div></div>
                    <div style={css('display: flex; align-items: center; gap: 12px')}><strong style={css(NUM)}>{amt(glAmount(p))}</strong><Button kind="primary" size={32} disabled={busy} onClick={() => void match(s.id, p.id)}>ยืนยัน</Button></div>
                  </div>
                ) : fee ? (
                  <div style={css(on ? RIGHT_ON : `${RIGHT}${lead}`)}>
                    <div><div>สร้างรายการใหม่: ค่าธรรมเนียมธนาคาร</div><div style={css(SUB)}>Dr 5401100 / Cr {account} · กฎ: &quot;FEE&quot; → ค่าธรรมเนียม (ใช้ซ้ำทุกเดือน)</div></div>
                    <Button size={32} disabled={busy} onClick={() => void createFee(s)}>สร้างและจับคู่</Button>
                  </div>
                ) : (
                  <div style={css(on ? RIGHT_ON : `${RIGHT}${lead}`)}>
                    <div>
                      <div>พักไว้ก่อน: 2190100 เงินรับรอตรวจสอบ</div>
                      {search === s.id ? (
                        <select aria-label="เลือกรายการในสมุดบัญชี" defaultValue="" disabled={busy} onChange={(e) => e.target.value && void match(s.id, e.target.value)} style={css('height: 32px; margin-top: 4px; max-width: 100%; padding: 0 8px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 13px')}>
                          <option value="">เลือกรายการในสมุดที่ยังไม่จับคู่</option>
                          {rec.unmatchedGl.map((g) => <option key={g.id} value={g.id}>{shortDate(g.journal_date)} · {g.journal_no} {g.description ?? ''} · {amt(glAmount(g))}</option>)}
                        </select>
                      ) : <div style={css(SUB)}>หรือค้นหาจากรายการในสมุดที่ยังไม่จับคู่ ({rec.unmatchedGl.length} รายการ)</div>}
                    </div>
                    <div style={css('display: flex; gap: 8px')}>
                      <Button size={32} disabled={busy} onClick={() => setSearch(search === s.id ? null : s.id)}>ค้นหา</Button>
                      <Button size={32} disabled={busy} onClick={() => void match(s.id, null)}>พักไว้</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {tab !== 'matched' && (
            <>
              <div style={css(`${CELL}; color: #525252${rows.length ? '; border-top: 0' : ''}`)}>{rows.length ? `รวม ${rows.length} รายการ` : 'ไม่มีรายการ'}</div><div></div>
              <div style={css(`${CELL}; color: #525252${rows.length ? '; border-top: 0' : ''}`)}>รายการในสมุดที่ยังไม่ปรากฏใน statement: {glInMonth.length} รายการ {amt(fromCents(glInMonth.reduce((t, g) => t + toCents(glAmount(g)), 0n)))}</div>
            </>
          )}
        </div>
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ปิดกระทบยอดได้เมื่อผลต่างเป็น 0.00 · จะล็อกรายการธนาคารของเดือนนี้</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <button type="button" style={buttonStyle('secondary')}>พิมพ์งบกระทบยอด</button>
          <button type="button" disabled style={buttonStyle('primary', 40, true)}>ปิดกระทบยอดเดือนนี้</button>
        </div>
      </div>
    </>
  );
}

function MatchedRow({ g, first }: { first: boolean; g: Props['matchedGl'][number] }) {
  const lead = first ? '' : '; border-top: 0';
  return (
    <>
      <div style={css(`${CELL}${lead}`)}><div><div style={css(NUM)}>{shortDate(g.date)} · {g.description ?? ''}</div></div><strong style={css(NUM)}>{amt(glAmount(g))}</strong></div>
      <div style={css('height: 100%; display: flex; align-items: center; justify-content: center; color: #8d8d8d')}>⇄</div>
      <div style={css(`${RIGHT}${lead}`)}><div><div>{g.journal_no} {g.description ?? ''}</div></div><strong style={css(NUM)}>{amt(glAmount(g))}</strong></div>
    </>
  );
}
