'use client';
import { Button, css, money, S } from '@innovera/ui';
import { useState } from 'react';

interface RuleLine { side: 'Dr' | 'Cr'; account: { from?: string[]; default?: string }; amount: string; perLine?: boolean; memo?: string }
export interface Rule { code: string; docType: string; name: string; book: string; settlement?: 'open' | 'paid'; lines: RuleLine[]; version: number; usage: number; check: { ok: boolean; equation: string; message: string } }

// ลำดับตามแบบร่าง ScreenFormula
const ORDER = ['Credit[IV]', 'Cash[IV]', 'Service[IV]', 'CN[ref IV]', 'CN[no-ref]', 'Credit[AP]', 'Cash[EXP]', 'Receive[RV]', 'Pay[PV]'];
const SHORT: Record<string, string> = { 'Credit[IV]': 'ขายเชื่อ', 'Cash[IV]': 'ขายสด', 'Service[IV]': 'บริการ (VAT เมื่อรับเงิน)', 'Credit[AP]': 'ซื้อเชื่อ', 'Cash[EXP]': 'จ่ายทันที' };
const BOOKS: [string, string][] = [['SJ', 'SJ ขาย'], ['PJ', 'PJ ซื้อ'], ['RJ', 'RJ รับเงิน'], ['PV', 'PAJ จ่ายเงิน'], ['GJ', 'JV ทั่วไป']];
const AMOUNT: Record<string, string> = {
  grand_total: 'ยอดสุทธิ (grand_total)', wht: 'ภาษีถูกหัก (wht)', net: 'ยอดก่อนภาษี (total)', 'line.amount': 'ยอดก่อนภาษี (total)', discount: 'ส่วนลดท้ายบิล (discount)',
  vat: 'ภาษีมูลค่าเพิ่ม (vat)', cash_in: 'เงินรับ (cash_in)', settled: 'ยอดตัดหนี้ (settled)', vat_due: 'ภาษีขายที่ถึงกำหนด (vat_due)', fee: 'ค่าธรรมเนียม (fee)', paid: 'จ่ายจริง (paid)',
};
function fromLabel(l: RuleLine, docType: string): string | null {
  const f = l.account.from ?? [];
  if (f.includes('contact.ar')) return 'บัญชีลูกหนี้ของคู่ค้า';
  if (f.includes('contact.ap')) return 'บัญชีเจ้าหนี้ของคู่ค้า';
  if (f.includes('input.cash')) return 'บัญชีเงินที่เลือกในเอกสาร';
  if (f.includes('product') || f.includes('line')) return ['IV', 'CN'].includes(docType) ? 'บัญชีรายได้ของสินค้า (แยกตามบรรทัด)' : 'บัญชีของบรรทัด / สินค้า (แยกตามบรรทัด)';
  return null;
}

export function RulesEditor({ rules, accounts }: { rules: Rule[]; accounts: { code: string; name: string }[] }) {
  const sorted = [...rules].sort((a, b) => (ORDER.indexOf(a.code) + 1 || 99) - (ORDER.indexOf(b.code) + 1 || 99));
  const [sel, setSel] = useState(sorted[0]!.code);
  const rule = sorted.find((r) => r.code === sel)!;
  const [draft, setDraft] = useState<Rule>(rule);
  const [docNo, setDocNo] = useState('IV2611-0052');
  const [result, setResult] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const accName = (c?: string) => (c ? `${c} ${accounts.find((a) => a.code === c)?.name ?? ''}` : '—');

  const pick = (code: string) => { setSel(code); setDraft(sorted.find((r) => r.code === code)!); setResult(null); setMsg(null); };
  const toggleFrom = (i: number, on: boolean) => setDraft({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, account: { ...l.account, from: on ? (rule.lines[i]?.account.from ?? []) : [] } } : l)) });

  async function test() {
    const res = await fetch('/api/proxy/rules/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: draft.code, docNo }) });
    const r = (await res.json()) as { lines?: [string, string, string][]; error?: string };
    setResult(r.lines ? `ผล: ${r.lines.map(([s, a, v]) => `${s} ${a} ${money(v)}`).join(' / ')} — ดุล ✓` : (r.error ?? 'ทดสอบไม่สำเร็จ'));
  }
  async function save() {
    const { version: _v, usage: _u, check: _c, ...def } = draft;
    const res = await fetch('/api/proxy/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(def) });
    const r = (await res.json()) as { version?: number; error?: string };
    setMsg(r.version ? `บันทึกสูตร ${draft.code} เป็นเวอร์ชัน ${r.version} — มีผลกับเอกสารที่ลงหลังจากนี้` : (r.error ?? 'บันทึกไม่สำเร็จ'));
  }

  return (
    <div style={css(S.content)}>
      <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
        <h1 style={css(S.h1)}>สูตรลงบัญชี</h1>
        {/* TODO(Wei): แบบร่างไม่มีฟอร์มสร้างสูตรใหม่แยก — ปุ่มนี้คัดลอกสูตรที่เลือกเป็นสูตรใหม่ให้แก้ */}
        <Button kind="primary" size={36} onClick={() => { setDraft({ ...draft, code: `${draft.code}-copy`, name: `${draft.name} (สำเนา)`, version: 0, usage: 0 }); setMsg('สร้างสำเนาจากสูตรที่เลือก — แก้แล้วกด "บันทึกสูตร"'); }}>สร้างสูตร</Button>
      </div>
      <p style={css('margin: 0; font-size: 14px; color: #525252; max-width: 880px')}>สูตรบอกว่า &quot;ยอดเงินก้อนไหนของเอกสาร&quot; ลงบัญชีใดฝั่ง Dr/Cr บัญชีจริงเลือกตามลำดับ: บรรทัดเอกสาร → สินค้า → คู่ค้า → ค่าในสูตร แก้สูตรแล้วมีผลกับเอกสารที่ลงหลังจากนี้ เอกสารเดิมใช้ปุ่ม &quot;ลงใหม่ตามสูตร&quot; (ยกเว้นงวดที่ล็อก)</p>
      <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
        <section style={css('flex: 0 1 380px; border: 1px solid #e0e0e0')}>
          <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}>
            <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>สูตร</th><th style={css(S.th)}>เอกสาร</th><th style={css(`${S.th}; text-align: right`)}>ใช้ไป</th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.code} onClick={() => pick(r.code)} style={css(`border-top: 1px solid #e0e0e0; cursor: pointer${r.code === sel ? '; background: #e0e0e0' : ''}`)}>
                  <td style={css(`height: 40px; padding: 0 12px${r.code === sel ? '; font-weight: 600' : ''}`)}>{r.code}{SHORT[r.code] ? ` ${SHORT[r.code]}` : ''}</td>
                  <td style={css(S.td)}>{r.docType}</td>
                  <td style={css(S.num)}>{r.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section style={css('flex: 1 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 16px')}>
          <div style={css('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px')}>
            <label style={css(S.label)}>ชื่อสูตร<input value={`${draft.code}${SHORT[draft.code] ? ` ${SHORT[draft.code]}` : ''}`} readOnly style={css(S.input)} /></label>
            <label style={css(S.label)}>สมุดรายวัน<select value={draft.book} onChange={(e) => setDraft({ ...draft, book: e.target.value })} style={css(S.input)}>{BOOKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label style={css(S.label)}>สถานะชำระเมื่อลง<select value={draft.settlement ?? 'open'} onChange={(e) => setDraft({ ...draft, settlement: e.target.value as 'open' | 'paid' })} style={css(S.input)}><option value="open">ลูกหนี้ (ค้างชำระ)</option><option value="paid">ชำระแล้ว</option></select></label>
          </div>
          <div style={css(S.tableBox)}>
            <table style={css('width: 100%; min-width: 560px; border-collapse: collapse; font-size: 14px')}>
              <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>ยอดเงิน</th><th style={css(S.th)}>ด้าน</th><th style={css(S.th)}>บัญชีค่าเริ่มต้น</th><th style={css(S.th)}>แทนค่าจาก</th></tr></thead>
              <tbody>
                {draft.lines.map((l, i) => {
                  const fl = fromLabel(rule.lines[i] ?? l, draft.docType);
                  return (
                    <tr key={i} style={css(S.tr)}>
                      <td style={css('height: 40px; padding: 0 12px')}>{AMOUNT[l.amount] ?? l.amount}</td>
                      <td style={css(S.td)}>{l.side}</td>
                      <td style={css(S.td)}>{accName(l.account.default)}</td>
                      <td style={css(`${S.td}${fl ? '' : '; color: #525252'}`)}>{fl ? <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={(l.account.from ?? []).length > 0} onChange={(e) => toggleFrom(i, e.target.checked)} /> {fl}</label> : '—'}</td>
                    </tr>
                  );
                })}
                {/* TODO(Wei): แบบร่างไม่ได้กำหนดฟอร์มเพิ่มบรรทัดสูตร */}
                <tr style={css(S.tr)}><td colSpan={4} style={css(S.td)}><Button kind="ghost" size={32} onClick={() => setMsg('การเพิ่มบรรทัดสูตรยังไม่มีในแบบร่าง — รอแบบร่าง')}>+ เพิ่มบรรทัด</Button></td></tr>
              </tbody>
            </table>
          </div>
          <div role="status" style={css(`display: flex; gap: 12px; align-items: center; padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${rule.check.ok ? '#24a148' : '#da1e28'}; font-size: 14px`)}>
            ตรวจสมดุล: {rule.check.equation} {rule.check.ok ? '✓ · น้ำหนัก Dr = Cr ✓' : `✗ · ${rule.check.message}`}
          </div>
          <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 8px; font-size: 14px')}>
            <strong>ทดสอบสูตรกับเอกสารจริง</strong>
            <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center')}>
              <input aria-label="เลขเอกสาร" value={docNo} onChange={(e) => setDocNo(e.target.value)} style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')} />
              <Button size={36} onClick={() => void test()}>แสดง Dr/Cr</Button>
              {result && <span style={css('color: #525252')}>{result}</span>}
            </div>
          </section>
          {msg && <div role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #0f62fe; font-size: 14px')}>{msg}</div>}
          <div style={css('display: flex; justify-content: flex-end')}>
            {/* TODO(M4): ลงใหม่ตามสูตร ต้องมีเอกสารที่ลงผ่านสูตร */}
            <Button size={36} onClick={() => setMsg('ลงใหม่ตามสูตรใช้ได้เมื่อมีเอกสารขาย/ซื้อที่ลงผ่านสูตร (M4)')}>ลงใหม่ตามสูตร (เลือกช่วงเอกสาร)</Button>
            <Button kind="primary" size={36} onClick={() => void save()}>บันทึกสูตร</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
