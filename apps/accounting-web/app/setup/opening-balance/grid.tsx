'use client';
import { Button, buttonStyle, css, href, money, thaiMonth } from '@innovera/ui';
import { useMemo, useRef, useState } from 'react';

export interface Opening { date: string | null; status: string | null; lines: { account: string; debit: string; credit: string }[]; ar: { count: number; total: string }; ap: { count: number; total: string } }
export interface AccountLite { code: string; name: string; is_control: boolean; active: boolean }
interface Row { account: string; debit: string; credit: string }

const BTN = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 36px; padding: 0 16px';
const TAB_ON = `${BTN}; background: #ffffff; color: #161616; border: 1px solid #8d8d8d; border-bottom: 2px solid #0f62fe`;
const TAB_OFF = `${BTN}; background: transparent; color: #0f62fe; border: 1px solid transparent`;
const INPUT = 'width: 140px; height: 32px; text-align: right; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; font-variant-numeric: tabular-nums';
const STEPS = ['1 ข้อมูลบริษัท', '2 ปีบัญชี & ผังบัญชี', '3 ยอดยกมา', '4 ภาษี & เลขที่เอกสาร', '5 ทีมและแอปเชื่อมต่อ'];
const AR = '1130100';
const AP = '2110100';

/** "1,234.50" → "1234.50" (สตางค์เป็น BigInt — ห้าม float) · คืน null ถ้ารูปแบบผิด */
function parseAmount(s: string): bigint | null {
  const t = s.replace(/,/gu, '').trim();
  if (t === '') return 0n;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(t);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}
const fmt = (c: bigint) => { const a = (c < 0n ? -c : c).toString().padStart(3, '0'); return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`; };
const dateLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${thaiMonth(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4)) + 543}`;

export function OpeningGrid({ year, opening, accounts }: { year: number; opening: Opening; accounts: AccountLite[] }) {
  const locked = opening.status === 'hard_closed' && opening.lines.length > 0;
  const name = useMemo(() => new Map(accounts.map((a) => [a.code, a.name])), [accounts]);
  const [rows, setRows] = useState<Row[]>(() => {
    const posted = opening.lines.map((l) => ({ account: l.account, debit: l.debit === '0.00' ? '' : money(l.debit), credit: l.credit === '0.00' ? '' : money(l.credit) }));
    const has = new Set(posted.map((r) => r.account));
    // บัญชีคุม: ยอดรวมจากรายใบที่นำเข้าแล้ว (อ่านอย่างเดียว)
    if (opening.ar.count && !has.has(AR)) posted.push({ account: AR, debit: money(opening.ar.total), credit: '' });
    if (opening.ap.count && !has.has(AP)) posted.push({ account: AP, debit: '', credit: money(opening.ap.total) });
    return posted.sort((a, b) => a.account.localeCompare(b.account));
  });
  const [tab, setTab] = useState(0);
  const [adding, setAdding] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const parsed = rows.map((r) => ({ dr: parseAmount(r.debit), cr: parseAmount(r.credit) }));
  const bad = parsed.some((p) => p.dr === null || p.cr === null);
  const dr = parsed.reduce((a, p) => a + (p.dr ?? 0n), 0n);
  const cr = parsed.reduce((a, p) => a + (p.cr ?? 0n), 0n);
  const diff = dr - cr;

  const set = (i: number, k: 'debit' | 'credit', v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const readOnly = (code: string) => locked || code === AR || code === AP;
  const note = (code: string) => {
    if (code === AR) return <><a href={href('aging')} style={css('text-decoration: none')}>รวมจากรายใบ {opening.ar.count} ใบ</a> <span style={css('color: #0e6027')}>✓ ตรง</span></>;
    if (code === AP) return <><a href={href('aging')} style={css('text-decoration: none')}>รวมจากรายใบ {opening.ap.count} ใบ</a> <span style={css('color: #0e6027')}>✓ ตรง</span></>;
    // TODO(M6): ทะเบียนสินทรัพย์ (1530xxx) · statement ธนาคาร · หมายเหตุ DBD — แบบร่างแสดงข้อความเหล่านี้จากข้อมูลโมดูลที่ยังไม่มี
    return null;
  };

  async function upload(f: File) {
    setMsg('กำลังนำเข้า…');
    const res = await fetch(`/api/proxy/import?year=${year}`, { method: 'POST', headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: f });
    const r = (await res.json()) as { ok?: boolean; issues?: { sheet: string; row: number; message: string }[]; error?: string };
    if (r.ok) location.reload();
    else setMsg(r.error ?? (r.issues ?? []).map((i) => `${i.sheet} แถว ${i.row}: ${i.message}`).join(' · '));
  }

  async function confirm() {
    if (bad) return setMsg('รูปแบบจำนวนเงินไม่ถูกต้อง');
    if (diff !== 0n) return setMsg(`ยังไม่สมดุล · ผลต่าง ${money(fmt(diff < 0n ? -diff : diff))}`);
    // บัญชีคุมส่งด้วย — ฝั่ง API ตรวจกับรายใบที่มีอยู่ (ชุดตรวจเดียวกับ Excel)
    const body = { rows: rows.map((r, i) => { const p = parsed[i]!; return { account: r.account, debit: p.dr ? fmt(p.dr) : undefined, credit: p.cr ? fmt(p.cr) : undefined }; }) };
    const res = await fetch(`/api/proxy/opening?year=${year}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = (await res.json()) as { ok?: boolean; journal?: string; issues?: { sheet: string; row: number; message: string }[]; error?: string };
    if (r.ok) location.assign(href('docsettings'));
    else setMsg(r.error ?? (r.issues ?? []).map((i) => `แถว ${i.row}: ${i.message}`).join(' · '));
  }

  const tabs = ['งบทดลองยกมา', `ลูกหนี้รายใบ (${opening.ar.count})`, `เจ้าหนี้รายใบ (${opening.ap.count})`,
    // TODO(M6): จำนวนเช็คค้าง/สินทรัพย์ถาวร มาจากโมดูลเช็คและทะเบียนสินทรัพย์ (M6) · เนื้อหาแท็บ 2–5 แบบร่างยังไม่กำหนด
    'เช็คค้าง (0)', 'สินทรัพย์ถาวร (0)'];
  const unused = accounts.filter((a) => a.active && !rows.some((r) => r.account === a.code) && a.code !== AR && a.code !== AP);

  return (
    <>
      <main style={css('flex: 1; display: flex; justify-content: center; padding: 48px 32px 96px; box-sizing: border-box')}>
        <div style={css('width: 100%; max-width: 1040px; display: flex; flex-direction: column; gap: 24px')}>
          <ol style={css('margin: 0; padding: 0; list-style: none; display: flex; font-size: 13px')}>
            {STEPS.map((s, i) => <li key={s} style={css(`flex: 1; padding: ${i === 4 ? '8px 0' : '8px 12px 8px 0'}; border-top: 2px solid ${i <= 2 ? '#0f62fe' : '#e0e0e0'}; ${i < 2 ? 'color: #0f62fe' : i === 2 ? 'font-weight: 600' : 'color: #525252'}`)}>{s}</li>)}
          </ol>
          <div style={css('display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px')}>
            <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ยอดยกมา ณ {opening.date ? dateLabel(opening.date) : `31 ธ.ค. ${year - 1}`}</h1><span style={css('font-size: 13px; color: #525252')}>กรอกจากงบทดลองของระบบเดิม · รายละเอียดลูกหนี้/เจ้าหนี้รายใบเพื่อให้อายุหนี้ถูกต้องตั้งแต่วันแรก · ข้ามได้แล้วกลับมาทำทีหลัง</span></div>
            <div style={css('display: flex; gap: 8px')}>
              <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <Button size={36} disabled={locked} onClick={() => file.current?.click()}>นำเข้างบทดลอง (Excel)</Button>
              <a href="/api/proxy/import/template" style={buttonStyle('secondary', 36, false, 'text-decoration: none')}>ดาวน์โหลดแม่แบบ</a>
            </div>
          </div>
          <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
            {tabs.map((t, i) => <button key={t} role="tab" aria-selected={tab === i} type="button" style={css(tab === i ? TAB_ON : TAB_OFF)} onClick={() => setTab(i)}>{t}</button>)}
          </div>
          {msg && <div role="status" style={css('padding: 12px 16px; background: #ffffff; border: 1px solid #e0e0e0; border-left: 3px solid #da1e28; font-size: 14px')}>{msg}</div>}
          {tab === 0 && (
            <section style={css('background: #ffffff; border: 1px solid #e0e0e0; overflow-x: auto')}>
              <table style={css('width: 100%; min-width: 800px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รหัส</th><th style={css('padding: 0 12px; font-weight: 400')}>ชื่อบัญชี</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right; width: 180px')}>เดบิต</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right; width: 180px')}>เครดิต</th><th style={css('padding: 0 12px; font-weight: 400')}>รายละเอียด</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.account} style={css('border-top: 1px solid #e0e0e0')}>
                      <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{r.account}</td>
                      <td style={css('padding: 0 12px')}>{name.get(r.account) ?? ''}</td>
                      {(['debit', 'credit'] as const).map((k) => (
                        readOnly(r.account)
                          ? <td key={k} style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; color: #525252')}>{r[k]}</td>
                          : <td key={k} style={css('padding: 0 12px; text-align: right')}><input aria-label={`${k === 'debit' ? 'เดบิต' : 'เครดิต'} ${r.account}`} value={r[k]} onChange={(e) => set(i, k, e.target.value)} onBlur={(e) => { const c = parseAmount(e.target.value); if (c) set(i, k, money(fmt(c))); }} style={css(INPUT)} /></td>
                      ))}
                      <td style={css('padding: 0 12px')}>{note(r.account)}</td>
                    </tr>
                  ))}
                  {!locked && (
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={5} style={css('padding: 0 12px')}>
                      {/* TODO(Wei): แบบร่างมีแค่ปุ่ม "+ เพิ่มบัญชี" ไม่ได้กำหนดตัวเลือกบัญชี — ใช้ select ของเบราว์เซอร์ไปก่อน */}
                      {adding === '' ? <Button kind="ghost" size={32} onClick={() => setAdding(' ')}>+ เพิ่มบัญชี</Button>
                        : <select aria-label="เลือกบัญชี" autoFocus value="" onChange={(e) => { const v = e.target.value; if (v) setRows((rs) => [...rs, { account: v, debit: '', credit: '' }].sort((a, b) => a.account.localeCompare(b.account))); setAdding(''); }} onBlur={() => setAdding('')} style={css('height: 32px; font-family: inherit; font-size: 14px; margin: 4px 0')}>
                          <option value="" />{unused.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                        </select>}
                    </td></tr>
                  )}
                </tbody>
                <tfoot><tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}>
                  <td colSpan={2} style={css('height: 44px; padding: 0 12px')}>รวม</td>
                  <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(fmt(dr))}</td>
                  <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(fmt(cr))}</td>
                  {diff === 0n && !bad
                    ? <td style={css('padding: 0 12px; color: #0e6027')}>สมดุล · ผลต่าง 0.00 ✓</td>
                    : <td style={css('padding: 0 12px; color: #da1e28')}>ไม่สมดุล · ผลต่าง {money(fmt(diff < 0n ? -diff : diff))}</td>}
                </tr></tfoot>
              </table>
            </section>
          )}
          <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 14px; display: flex; flex-direction: column; gap: 6px; color: #525252')}>
            <strong style={css('color: #161616')}>เมื่อยืนยัน</strong>
            <span>· ระบบสร้างรายการ &quot;ยอดยกมา&quot; JV0000-0001 ลงวันที่ {opening.date ? `${opening.date.slice(8, 10)}/${opening.date.slice(5, 7)}/${Number(opening.date.slice(0, 4)) + 543}` : `31/12/${year - 1}`} ในงวดพิเศษ (ปิดแข็งทันที)</span>
            <span>· ลูกหนี้/เจ้าหนี้รายใบ กลายเป็นเอกสารยกมาที่รับ/จ่ายชำระได้ และปรากฏในอายุหนี้</span>
            <span>· ปรับแก้ทีหลังได้โดยเจ้าของ/ผู้จัดการบัญชี ผ่าน &quot;แก้ยอดยกมา&quot; ซึ่งบันทึกใน Audit log · ใส่รายการปรับปรุงของผู้สอบบัญชีปีก่อนได้ภายหลัง</span>
          </section>
        </div>
      </main>
      <div style={css('position: sticky; bottom: 0; display: flex; justify-content: center; background: #ffffff; border-top: 1px solid #e0e0e0')}>
        <div style={css('width: 100%; max-width: 1040px; height: 64px; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; box-sizing: border-box')}>
          <a href={href('companyCreate')} style={buttonStyle('secondary', 40, false, 'text-decoration: none')}>← ย้อนกลับ</a>
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            {/* ข้ามไปก่อน = ไปขั้น 4 โดยไม่บันทึก (แบบร่าง: "ข้ามได้แล้วกลับมาทำทีหลัง") */}
            <Button onClick={() => location.assign(href('docsettings'))}>ข้ามไปก่อน</Button>
            <Button kind="primary" disabled={locked} onClick={() => void confirm()}>ยืนยันยอดยกมา · ถัดไป</Button>
          </div>
        </div>
      </div>
    </>
  );
}
