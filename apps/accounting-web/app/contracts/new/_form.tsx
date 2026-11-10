'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ฟอร์มสร้างสัญญา → POST /v1/contracts (ContractInput ใน packages/db/src/contract.ts) · 422 ภาษาไทยแสดงในกล่องข้อความ
// วิธีรับรู้ตั้งต้นตามประเภท (DEFAULT_RECOGNITION) · usage ใช้ราคาต่อหน่วย + หน่วย · ยอด subscription/support = ยอดต่อรอบบิล · license/implementation = ยอดรวมครั้งเดียว
import { Button, css, money, S } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '../../sales/_lib/client';
import { Msg } from '../../sales/_lib/ui';
import { CYCLE_LABEL, DEFAULT_RECOG, KIND_LABEL, RECOG_LABEL, RECOG_OPTIONS, ST, type Cycle, type Kind, type Recognition } from '../_lib';

interface Opt { code: string; name: string }
interface Product extends Opt { price: string | null; vat: boolean; revenueAccount: string | null }
interface Props { today: string; suggestedCode: string; customers: { id: string; code: string; name: string }[]; products: Product[]; revenueAccounts: Opt[] }
interface Line { kind: Kind; recognition: Recognition; description: string; productCode: string; amount: string; unitPrice: string; usageUnit: string; vat: boolean; revenueAccount: string; startDate: string; endDate: string }

const blank = (kind: Kind = 'subscription'): Line => ({ kind, recognition: DEFAULT_RECOG[kind], description: '', productCode: '', amount: '', unitPrice: '', usageUnit: '', vat: true, revenueAccount: '', startDate: '', endDate: '' });
/** '400.0000' → '400.00' (ราคาสินค้า NUMERIC(18,4) → ยอดเงิน 2 ตำแหน่ง เมื่อทศนิยมที่เกินเป็นศูนย์) */
const toMoney = (v: string | null): string => { if (!v) return ''; const [i = '0', f = ''] = v.split('.'); return /^0*$/u.test(f.slice(2)) ? `${i}.${(f + '00').slice(0, 2)}` : v; };
const plusYear = (d: string): string => { const y = Number(d.slice(0, 4)) + 1; const x = new Date(Date.UTC(y, Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) - 1)); return x.toISOString().slice(0, 10); };
const firstOfNextMonth = (d: string): string => { const x = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)); return x.toISOString().slice(0, 10); };

export function ContractForm({ today, suggestedCode, customers, products, revenueAccounts }: Props) {
  const router = useRouter();
  const start0 = `${today.slice(0, 7)}-01`;
  const [h, setH] = useState({ code: suggestedCode, contactId: customers[0]?.id ?? '', startDate: start0, endDate: plusYear(start0), billingCycle: 'annual' as Cycle, autoRenew: false, notes: '' });
  const [lines, setLines] = useState<Line[]>([blank('subscription')]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const upd = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setKind = (i: number, kind: Kind) => upd(i, { kind, recognition: DEFAULT_RECOG[kind] });
  const pickProduct = (i: number, code: string) => {
    const p = products.find((x) => x.code === code);
    const l = lines[i]!;
    upd(i, { productCode: code, ...(p ? { description: l.description || p.name, vat: p.vat, revenueAccount: p.revenueAccount ?? l.revenueAccount, ...(l.kind === 'usage' ? { unitPrice: l.unitPrice || (p.price ?? '') } : { amount: l.amount || toMoney(p.price) }) } : {}) });
  };

  async function save() {
    setBusy(true); setMsg(null);
    const body = {
      code: h.code.trim(), contactId: h.contactId, startDate: h.startDate, endDate: h.endDate, billingCycle: h.billingCycle, autoRenew: h.autoRenew, notes: h.notes.trim() || null,
      lines: lines.map((l) => ({
        kind: l.kind, recognition: l.recognition, description: l.description.trim(), productCode: l.productCode || null,
        ...(l.kind === 'usage' ? { unitPrice: l.unitPrice.replace(/,/gu, ''), usageUnit: l.usageUnit.trim() || null } : { amount: l.amount.replace(/,/gu, '') }),
        vat: l.vat, revenueAccount: l.revenueAccount || null, startDate: l.startDate || null, endDate: l.endDate || null,
      })),
    };
    const r = await call<{ id: string }>('contracts', 'POST', body);
    if (!r.ok) { setBusy(false); setMsg({ kind: 'err', text: r.error }); return; }
    router.push(`/contracts/${r.data.id}`);
  }

  const missing = !h.code.trim() || !h.contactId || lines.some((l) => !l.description.trim() || (l.kind === 'usage' ? !l.unitPrice.trim() : !l.amount.trim()));
  return (
    <>
      <section aria-labelledby="h-head" style={css(ST.box)}>
        <h2 id="h-head" style={css(ST.h2)}>ข้อมูลสัญญา</h2>
        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px 24px; align-items: end')}>
          <label style={css(ST.label)}>เลขที่สัญญา<input value={h.code} onChange={(e) => setH({ ...h, code: e.target.value })} placeholder="เช่น CT-001" style={css(ST.input)} /></label>
          <label style={css(ST.label)}>ลูกค้า<select value={h.contactId} onChange={(e) => setH({ ...h, contactId: e.target.value })} style={css(ST.input)}>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
          <label style={css(ST.label)}>วันเริ่มสัญญา<input type="date" value={h.startDate} onChange={(e) => setH({ ...h, startDate: e.target.value })} style={css(ST.input)} /></label>
          <label style={css(ST.label)}>วันสิ้นสุดสัญญา<input type="date" value={h.endDate} onChange={(e) => setH({ ...h, endDate: e.target.value })} style={css(ST.input)} /></label>
          <label style={css(ST.label)}>รอบบิล<select value={h.billingCycle} onChange={(e) => setH({ ...h, billingCycle: e.target.value as Cycle })} style={css(ST.input)}>
            {(Object.keys(CYCLE_LABEL) as Cycle[]).map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}</select></label>
          <label style={css('display: flex; align-items: center; gap: 8px; font-size: 14px; height: 40px')}><input type="checkbox" checked={h.autoRenew} onChange={(e) => setH({ ...h, autoRenew: e.target.checked })} /> ต่ออายุอัตโนมัติ</label>
          <label style={css(`${ST.label}; grid-column: 1 / -1`)}>หมายเหตุ<input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} style={css(ST.input)} /></label>
        </div>
        <span style={css('font-size: 13px; color: #525252')}>ช่วงสัญญา: <button type="button" onClick={() => { const s = firstOfNextMonth(today); setH({ ...h, startDate: s, endDate: plusYear(s) }); }} style={css('border: 0; background: none; color: #0f62fe; font: inherit; cursor: pointer; padding: 0')}>เริ่มเดือนหน้า 1 ปี</button></span>
      </section>

      <section aria-labelledby="h-lines" style={css('display: flex; flex-direction: column; gap: 12px')}>
        <h2 id="h-lines" style={css(ST.h2)}>รายการในสัญญา</h2>
        <div style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 1400px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(`${S.thFirst}; width: 32px`)}>#</th><th style={css(S.th)}>ประเภท</th><th style={css(S.th)}>วิธีรับรู้รายได้</th><th style={css(S.th)}>สินค้า/บริการ</th><th style={css(S.th)}>รายละเอียด</th>
              <th style={css(`${S.th}; text-align: right`)}>ยอด / ราคาต่อหน่วย</th><th style={css(S.th)}>หน่วย (usage)</th><th style={css(S.th)}>VAT 7%</th><th style={css(S.th)}>บัญชีรายได้</th><th style={css(S.th)}>เริ่ม (ถ้าต่างจากสัญญา)</th><th style={css(S.th)}>สิ้นสุด</th><th style={css(S.th)}></th>
            </tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i} style={css(S.tr)}>
                <td style={css('height: 48px; padding: 0 12px; color: #525252')}>{i + 1}</td>
                <td style={css('padding: 0 6px; width: 190px')}><select aria-label={`ประเภท บรรทัด ${i + 1}`} value={l.kind} onChange={(e) => setKind(i, e.target.value as Kind)} style={css(ST.cell)}>
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                <td style={css('padding: 0 6px; width: 180px')}><select aria-label={`วิธีรับรู้ บรรทัด ${i + 1}`} value={l.recognition} onChange={(e) => upd(i, { recognition: e.target.value as Recognition })} style={css(ST.cell)}>
                  {RECOG_OPTIONS[l.kind].map((r) => <option key={r} value={r}>{RECOG_LABEL[r]}</option>)}</select></td>
                <td style={css('padding: 0 6px; width: 170px')}><select aria-label={`สินค้า บรรทัด ${i + 1}`} value={l.productCode} onChange={(e) => pickProduct(i, e.target.value)} style={css(ST.cell)}>
                  <option value="">— ไม่ระบุ —</option>{products.map((p) => <option key={p.code} value={p.code}>{p.code} {p.name}</option>)}</select></td>
                <td style={css('padding: 0 6px; min-width: 200px')}><input aria-label={`รายละเอียด บรรทัด ${i + 1}`} value={l.description} onChange={(e) => upd(i, { description: e.target.value })} style={css(ST.cell)} /></td>
                <td style={css('padding: 0 6px; width: 130px')}>{l.kind === 'usage'
                  ? <input aria-label={`ราคาต่อหน่วย บรรทัด ${i + 1}`} inputMode="decimal" placeholder="ต่อหน่วย" value={l.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} style={css(ST.cellNum)} />
                  : <input aria-label={`ยอด บรรทัด ${i + 1}`} inputMode="decimal" placeholder={l.kind === 'subscription' || l.kind === 'support' ? 'ต่อรอบบิล' : 'ยอดรวม'} value={l.amount} onChange={(e) => upd(i, { amount: e.target.value })} style={css(ST.cellNum)} />}</td>
                <td style={css('padding: 0 6px; width: 90px')}>{l.kind === 'usage' ? <input aria-label={`หน่วย บรรทัด ${i + 1}`} value={l.usageUnit} onChange={(e) => upd(i, { usageUnit: e.target.value })} placeholder="เช่น ครั้ง" style={css(ST.cell)} /> : <span style={css('color: #a8a8a8')}>—</span>}</td>
                <td style={css('padding: 0 12px')}><input type="checkbox" aria-label={`VAT บรรทัด ${i + 1}`} checked={l.vat} onChange={(e) => upd(i, { vat: e.target.checked })} /></td>
                <td style={css('padding: 0 6px; width: 200px')}><select aria-label={`บัญชีรายได้ บรรทัด ${i + 1}`} value={l.revenueAccount} onChange={(e) => upd(i, { revenueAccount: e.target.value })} style={css(ST.cell)}>
                  <option value="">ตามสินค้า/สูตร</option>{revenueAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td>
                <td style={css('padding: 0 6px; width: 140px')}><input type="date" aria-label={`วันเริ่ม บรรทัด ${i + 1}`} value={l.startDate} onChange={(e) => upd(i, { startDate: e.target.value })} style={css(ST.cell)} /></td>
                <td style={css('padding: 0 6px; width: 140px')}><input type="date" aria-label={`วันสิ้นสุด บรรทัด ${i + 1}`} value={l.endDate} onChange={(e) => upd(i, { endDate: e.target.value })} style={css(ST.cell)} /></td>
                <td style={css('padding: 0 6px')}>{lines.length > 1 && <Button kind="ghost" size={32} onClick={() => setLines(lines.filter((_, j) => j !== i))}>ลบ</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <Button key={k} kind="ghost" size={32} onClick={() => setLines([...lines, blank(k)])}>+ {KIND_LABEL[k]}</Button>)}
        </div>
        <span style={css('font-size: 13px; color: #525252')}>
          ยอดต่อรอบบิลรวม (subscription/support): {money(sumCents(lines.filter((l) => l.kind === 'subscription' || l.kind === 'support').map((l) => l.amount)))} · ยอดครั้งเดียว: {money(sumCents(lines.filter((l) => l.kind === 'license' || l.kind === 'implementation').map((l) => l.amount)))}
          {' '}· ตามช่วงเวลา → ใบแจ้งหนี้ลง Cr 2170100 รายได้รับล่วงหน้า แล้วรับรู้รายเดือน · ตามความสำเร็จของงาน → ออกบิลเมื่อบันทึกงานเสร็จ
        </span>
      </section>
      <Msg msg={msg} />
      <div style={css('display: flex; gap: 8px')}>
        <Button kind="primary" disabled={busy || missing} onClick={() => void save()}>บันทึกสัญญา</Button>
        <Button kind="secondary" onClick={() => router.push('/contracts')}>ยกเลิก</Button>
      </div>
    </>
  );
}

/** รวมยอดเงินแบบสตางค์ (BigInt · ไม่ใช้ float) · ช่องว่าง/รูปแบบผิด = 0 */
function sumCents(vs: string[]): string {
  let t = 0n;
  for (const v of vs) {
    const m = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(v.replace(/,/gu, '').trim());
    if (m) t += BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  }
  return `${t / 100n}.${String(t % 100n).padStart(2, '0')}`;
}
