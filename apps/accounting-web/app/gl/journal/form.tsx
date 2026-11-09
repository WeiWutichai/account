'use client';
import { Button, css, money, parseThaiDate, S, Tag, thaiDate, TopBar } from '@innovera/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface JournalView {
  id: string; journal_no: string; journal_date: string; book: string; description: string | null; status: string; auto_reverse: boolean; recurring: string | null;
  period: { fiscal_year: number; period_no: number; status: string };
  lines: { account_code: string; account_name: string; memo: string | null; contact_id: string | null; project_code: string | null; debit: string; credit: string }[];
}
export interface Template { id: string; name: string; book: string; description: string | null; lines: Line[] }
interface Line { account: string; memo: string; contact: string; dim: string; debit: string; credit: string }
interface Ctx { period: { fiscal_year: number; period_no: number; status: string } | null }

const BOOKS: [string, string][] = [['GJ', 'JV ทั่วไป'], ['SJ', 'SJ ขาย'], ['PJ', 'PJ ซื้อ'], ['RJ', 'RJ รับเงิน'], ['PV', 'PAJ จ่ายเงิน']];
const BOOK_NAME: Record<string, string> = { GJ: 'สมุดรายวันทั่วไป', SJ: 'สมุดรายวันขาย', PJ: 'สมุดรายวันซื้อ', RJ: 'สมุดรายวันรับเงิน', PV: 'สมุดรายวันจ่ายเงิน' };
const PSTATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };
const blank = (): Line => ({ account: '', memo: '', contact: '', dim: '', debit: '', credit: '' });

/** แปลงช่องเงินที่ผู้ใช้พิมพ์ ("8,500" "8500.5") → "8500.50" · ไม่ถูกต้อง = '' */
function norm(v: string): string {
  const t = v.replace(/,/gu, '').trim();
  if (!t) return '';
  if (!/^\d+(\.\d{0,2})?$/u.test(t)) return '';
  const [i, f = ''] = t.split('.');
  return `${String(Number(i))}.${(f + '00').slice(0, 2)}`;
}
const cents = (v: string) => (v ? BigInt(v.replace('.', '')) : 0n);
const fromCents = (c: bigint) => { const a = (c < 0n ? -c : c).toString().padStart(3, '0'); return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`; };

export function JournalForm({ ctx, accounts, contacts, templates, existing, today }: {
  ctx: Ctx; accounts: { code: string; name: string; is_control: boolean }[]; contacts: { id: string; code: string; name: string }[]; templates: Template[]; existing: JournalView | null; today: string;
}) {
  const readOnly = existing !== null && existing.status !== 'draft';
  const [id, setId] = useState(existing?.status === 'draft' ? existing.id : null);
  const [no, setNo] = useState(existing && existing.status !== 'draft' ? existing.journal_no : null);
  const [date, setDate] = useState(thaiDate(existing?.journal_date ?? today));
  const [book, setBook] = useState(existing?.book ?? 'GJ');
  const [autoRev, setAutoRev] = useState(existing?.auto_reverse ?? false);
  const [recurring, setRecurring] = useState(existing?.recurring ?? '');
  const [desc, setDesc] = useState(existing?.description ?? '');
  const [tpl, setTpl] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(existing?.lines.length
    ? existing.lines.map((l) => ({ account: `${l.account_code} ${l.account_name}`, memo: l.memo ?? '', contact: l.contact_id ?? '', dim: l.project_code ?? '', debit: l.debit === '0.00' ? '' : l.debit, credit: l.credit === '0.00' ? '' : l.credit }))
    : [blank(), blank()]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const accMap = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  const dr = lines.reduce((s, l) => s + cents(norm(l.debit)), 0n);
  const cr = lines.reduce((s, l) => s + cents(norm(l.credit)), 0n);
  const controls = lines.map((l) => accMap.get(l.account.slice(0, 7))).filter((a) => a?.is_control);
  const balanced = dr === cr && dr > 0n;
  const p = ctx.period;

  const payload = () => ({
    date: parseThaiDate(date) ?? '', book, description: desc, auto_reverse: autoRev, recurring: recurring || null,
    lines: lines.map((l) => ({ account_code: l.account.slice(0, 7), memo: l.memo || undefined, contact_id: l.contact || null, project_code: l.dim || null, debit: norm(l.debit) || undefined, credit: norm(l.credit) || undefined })),
  });

  const save = useCallback(async (): Promise<string | null> => {
    if (!parseThaiDate(date)) { setMsg({ kind: 'err', text: 'วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)' }); return null; }
    const res = await fetch(id ? `/api/proxy/journals/${id}` : '/api/proxy/journals', { method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) });
    const r = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !r.id) { setMsg({ kind: 'err', text: r.error ?? 'บันทึกไม่สำเร็จ' }); return null; }
    setId(r.id);
    setMsg({ kind: 'ok', text: 'บันทึกร่างแล้ว' });
    return r.id;
  }, [id, date, book, desc, autoRev, recurring, lines]);

  async function postIt() {
    const jid = await save();
    if (!jid) return;
    const res = await fetch(`/api/proxy/journals/${jid}/post`, { method: 'POST' });
    const r = (await res.json()) as { journalNo?: string; reversalNo?: string | null; error?: string };
    if (!res.ok || !r.journalNo) { setMsg({ kind: 'err', text: r.error ?? 'ลงบัญชีไม่สำเร็จ' }); return; }
    setNo(r.journalNo);
    setId(null);
    setMsg({ kind: 'ok', text: `ลงบัญชีแล้ว ${r.journalNo}${r.reversalNo ? ` · กลับรายการอัตโนมัติ ${r.reversalNo}` : ''}` });
  }

  async function asTemplate() {
    const name = desc.trim() || 'template ใหม่';
    const res = await fetch('/api/proxy/journals/templates', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, book, description: desc, lines: lines.map((l) => ({ ...l, debit: norm(l.debit), credit: norm(l.credit) })) }) });
    setMsg(res.ok ? { kind: 'ok', text: `บันทึก template "${name}" แล้ว` } : { kind: 'err', text: 'บันทึก template ไม่สำเร็จ' });
  }

  function applyTemplate(name: string) {
    if (name === '__new') { void asTemplate(); return; }
    const t = templates.find((x) => x.name === name);
    if (!t) return;
    setTpl(t.name);
    setBook(t.book);
    setDesc(t.description ?? '');
    setLines(t.lines.length ? t.lines : [blank()]);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const title = no ?? (id ? 'ร่าง' : 'ใหม่');
  const IN = 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; padding: 0 8px; width: 100%; box-sizing: border-box';

  return (
    <>
      <TopBar crumb={`บัญชี / บันทึกรายวัน / ${title}`} right={readOnly || no ? <Tag kind="success">ผ่านรายการ</Tag> : <Tag kind="info">ร่าง</Tag>} />
      <div style={css(S.contentForm)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div>
            <h1 style={css(S.h1)}>รายการปรับปรุง {title}</h1>
            <span style={css(S.sub)}>{BOOK_NAME[book]}{tpl ? ` · สร้างจาก template "${tpl}"` : ''}</span>
          </div>
          {!readOnly && (
            <select aria-label="template" value={tpl ?? ''} onChange={(e) => applyTemplate(e.target.value)} style={css('height: 40px; padding: 0 32px 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')}>
              <option value="" disabled>ใช้ template…</option>
              {templates.map((t) => <option key={t.id} value={t.name}>{tpl === t.name ? `ใช้ template: ${t.name}` : t.name}</option>)}
              <option value="__new">บันทึกเป็น template ใหม่…</option>
            </select>
          )}
        </div>
        <section style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px')}>
          <label style={css(S.label)}>วันที่<input disabled={readOnly} value={date} onChange={(e) => setDate(e.target.value)} style={css(`${S.input}; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(S.label)}>สมุดบัญชี<select disabled={readOnly} value={book} onChange={(e) => setBook(e.target.value)} style={css(S.input)}>{BOOKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={css(S.label)}>กลับรายการอัตโนมัติ<select disabled={readOnly} value={autoRev ? '1' : '0'} onChange={(e) => setAutoRev(e.target.value === '1')} style={css(S.input)}><option value="1">วันที่ 1 งวดถัดไป</option><option value="0">ไม่กลับรายการ</option></select></label>
          {/* รายการประจำ = GL-05 (P2 ใน Spec) — เก็บค่าไว้ งานตั้งเวลาทำใน Phase 2 */}
          <label style={css(S.label)}>รายการประจำ<select disabled={readOnly} value={recurring} onChange={(e) => setRecurring(e.target.value)} style={css(S.input)}><option value="">ไม่ใช่</option><option value="monthly_last_day">ทุกเดือน วันสุดท้าย</option></select></label>
          <label style={css(`grid-column: 1 / -1; ${S.label}`)}>คำอธิบาย<input disabled={readOnly} value={desc} onChange={(e) => setDesc(e.target.value)} style={css(S.input)} /></label>
        </section>
        <section style={css(S.tableBox)}>
          <datalist id="jv-acc">{accounts.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
          <table style={css('width: 100%; min-width: 860px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css('height: 40px; width: 32px; padding: 0 12px; font-weight: 400')}>#</th><th style={css(S.th)}>บัญชี</th><th style={css(S.th)}>คำอธิบาย</th><th style={css(S.th)}>คู่ค้า</th><th style={css(S.th)}>มิติ</th>
              <th style={css(`${S.th}; text-align: right`)}>เดบิต</th><th style={css(`${S.th}; text-align: right`)}>เครดิต</th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={css(S.tr)}>
                  <td style={css('height: 40px; padding: 0 12px; color: #525252')}>{i + 1}</td>
                  <td style={css(S.td)}>{readOnly ? l.account : <input aria-label={`บัญชี บรรทัด ${i + 1}`} list="jv-acc" value={l.account} onChange={(e) => set(i, 'account', e.target.value)} style={css(IN)} />}</td>
                  <td style={css(S.td)}>{readOnly ? l.memo : <input aria-label={`คำอธิบาย บรรทัด ${i + 1}`} value={l.memo} onChange={(e) => set(i, 'memo', e.target.value)} style={css(IN)} />}</td>
                  <td style={css(`${S.td}${l.contact ? '' : '; color: #525252'}`)}>{readOnly ? (contacts.find((c) => c.id === l.contact)?.name ?? '—') : (
                    <select aria-label={`คู่ค้า บรรทัด ${i + 1}`} value={l.contact} onChange={(e) => set(i, 'contact', e.target.value)} style={css(IN)}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}</td>
                  <td style={css(`${S.td}${l.dim ? '' : '; color: #525252'}`)}>{readOnly ? (l.dim || '—') : <input aria-label={`มิติ บรรทัด ${i + 1}`} value={l.dim} onChange={(e) => set(i, 'dim', e.target.value)} style={css(IN)} />}</td>
                  <td style={css(S.num)}>{readOnly ? money(l.debit, { blankZero: true }) : <input aria-label={`เดบิต บรรทัด ${i + 1}`} value={l.debit} onChange={(e) => set(i, 'debit', e.target.value)} onBlur={(e) => set(i, 'debit', norm(e.target.value) ? money(norm(e.target.value)) : '')} style={css(`${IN}; text-align: right; font-variant-numeric: tabular-nums`)} />}</td>
                  <td style={css(S.num)}>{readOnly ? money(l.credit, { blankZero: true }) : <input aria-label={`เครดิต บรรทัด ${i + 1}`} value={l.credit} onChange={(e) => set(i, 'credit', e.target.value)} onBlur={(e) => set(i, 'credit', norm(e.target.value) ? money(norm(e.target.value)) : '')}
                    onKeyDown={(e) => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); setLines([...lines, blank()]); } }} style={css(`${IN}; text-align: right; font-variant-numeric: tabular-nums`)} />}</td>
                </tr>
              ))}
              {!readOnly && (
                <tr style={css(S.tr)}><td style={css('height: 40px; padding: 0 12px; color: #525252')}>{lines.length + 1}</td>
                  <td colSpan={6} style={css(S.td)}><Button kind="ghost" size={32} onClick={() => setLines([...lines, blank()])}>+ เพิ่มบรรทัด (Enter)</Button></td></tr>
              )}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}>
              <td colSpan={5} style={css('height: 40px; padding: 0 12px; text-align: right')}>รวม</td>
              <td style={css(S.num)}>{money(fromCents(dr))}</td><td style={css(S.num)}>{money(fromCents(cr))}</td>
            </tr></tfoot>
          </table>
        </section>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap')}>
          <div role="status" style={css(`flex: 1 1 320px; display: flex; gap: 12px; align-items: center; padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${balanced && !controls.length ? '#24a148' : '#da1e28'}; font-size: 14px`)}>
            <span><strong>{balanced ? 'ดุลแล้ว' : 'ยังไม่ดุล'}</strong> ผลต่าง {money(fromCents(dr - cr < 0n ? cr - dr : dr - cr))} · {p ? `งวด ${p.period_no}/${p.fiscal_year} ${PSTATUS[p.status]}` : 'ไม่มีงวด'} · {controls.length ? `มีบัญชีคุม ${controls.map((c) => c!.code).join(', ')} (ลงตรงไม่ได้)` : 'ไม่มีบัญชีคุม'} · ผู้ใช้มีสิทธิ์สมุด {BOOKS.find(([v]) => v === book)?.[1].split(' ')[0]}</span>
          </div>
          {/* TODO(M4): ไฟล์แนบ + เส้นทางอนุมัติจริง (ต้องมีระบบไฟล์แนบ/สายอนุมัติ) */}
          <div style={css('flex: 1 1 320px; padding: 12px 16px; border: 1px solid #e0e0e0; font-size: 14px; color: #525252')}>ไฟล์แนบ: — · เส้นทางอนุมัติ: นักบัญชี → ผู้จัดการบัญชี · <a href="/settings/audit">ประวัติ</a></div>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      {!readOnly && !no && (
        <div style={css(S.stickyBar)}>
          <span style={css('font-size: 13px; color: #525252')}>Ctrl/⌘+S บันทึกร่าง · Enter เพิ่มบรรทัด</span>
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            <Button onClick={() => void asTemplate()}>ตั้งเป็น template</Button>
            <Button onClick={() => void save()}>บันทึกร่าง</Button>
            <Button kind="primary" onClick={() => void postIt()}>ลงบัญชี</Button>
          </div>
        </div>
      )}
    </>
  );
}
