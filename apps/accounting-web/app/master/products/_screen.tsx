'use client';
// ข้อมูลหลัก / สินค้าและบริการ — design/project/ScreenProducts.dc.html
// จำนวนในแท็บ (ทั้งหมด N · บริการ N · สินค้า N · ค่าใช้จ่าย N) และ "ใช้ใน N เอกสาร" มาจาก API · แท็บ "สินค้าชุด" ไม่มีจำนวนตามแบบร่าง
// "นำเข้า Excel" → เลือกไฟล์ → ตรวจ → ยืนยัน (../_import.tsx · POST /v1/master/products/import) · "เพิ่มรายการ" ในแท็บสินค้าชุดใช้ไม่ได้ (API ปฏิเสธ kind 'kit' เพราะโมดูลสต๊อกปิด)
// TODO(Wei) ScreenProducts.dc.html: แบบร่างแสดงราคาขาย 2 ของ P-1001 = 360.00 แต่ fixtures ไม่มี price_2 ของ P-1001 (360 คือต้นทุน) → แสดงตามข้อมูล (ว่าง)
// TODO(Wei) ScreenProducts.dc.html: แบบร่างไม่มีปุ่มบันทึกในแผงรายละเอียด — แสดง "ยกเลิก" + "บันทึก" เฉพาะเมื่อมีการแก้ไขช่อง
import { Button, css, href, money, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useExcelImport } from '../_import';

type Kind = 'service' | 'goods' | 'expense' | 'kit';
type VatCode = 'vat7' | 'exempt' | 'zero';
export interface Product {
  code: string; name: string; kind: Kind; unit: string | null; price: string | null; price_2: string | null; price_3: string | null; price_4: string | null; price_5: string | null;
  vat: boolean; vat_code: VatCode; default_wht: string | null; sku: string | null; revenue_account: string | null; expense_account: string | null;
}
export interface ProductsOverview { counts: Record<'total' | Kind, number>; rows: Product[] }
export interface ProductDetail { product: Product; usedIn: number; revenueLabel: string | null; expenseLabel: string | null }
interface Props { overview: ProductsOverview; detail: ProductDetail | null; kind: string; accounts: { code: string; name: string }[]; whtTypes: { key: string; rate: string; label: string }[] }

const KIND_TEXT: Record<Kind, string> = { service: 'บริการ', goods: 'สินค้า', expense: 'ค่าใช้จ่าย', kit: 'สินค้าชุด' };
const VAT_TEXT: Record<VatCode, string> = { vat7: 'VAT 7%', exempt: 'ยกเว้น', zero: '0%' };
// ตัวเลือกตามแบบร่าง → ค่าที่เก็บใน product.default_wht (ประเภทเงินได้ใน /v1/wht-types)
const WHT_DEFAULT: [string, string][] = [['hire_of_work', '3% จ้างทำของ'], ['', 'ไม่หัก']];

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const TAB = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #525252; font-family: inherit; font-size: 14px';
const TAB_ON = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600';
const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';

/** "1500.0000" → "1,500" · "12.5000" → "12.5" · ว่าง → "—" */
function priceShort(v: string | null): string {
  if (!v) return '—';
  const [i = '0', f = ''] = v.split('.');
  const frac = f.replace(/0+$/u, '');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}${frac ? `.${frac}` : ''}`;
}
/** "1,500 · 1,200 · — · — · —" → ['1500','1200',null,null,null] · ผิดรูปแบบ = null */
export function parsePrices(s: string): (string | null)[] | null {
  const parts = s.split('·').map((x) => x.trim().replace(/,/gu, ''));
  if (parts.length > 5) return null;
  const out: (string | null)[] = [];
  for (const p of parts) {
    if (!p || p === '—' || p === '-') { out.push(null); continue; }
    if (!/^\d+(\.\d{1,4})?$/u.test(p)) return null;
    out.push(p);
  }
  while (out.length < 5) out.push(null);
  return out;
}

interface Form { code: string; name: string; kind: Kind; unit: string; revenue: string; expense: string; vatCode: VatCode; wht: string; prices: string; sku: string }
const formOf = (d: ProductDetail | null, kind: Kind): Form => {
  const p = d?.product;
  return {
    code: p?.code ?? '', name: p?.name ?? '', kind: p?.kind ?? kind, unit: p?.unit ?? '', revenue: d?.revenueLabel ?? '', expense: d?.expenseLabel ?? '',
    vatCode: p?.vat_code ?? 'vat7', wht: p?.default_wht ?? '', sku: p?.sku ?? '',
    prices: p ? [p.price, p.price_2, p.price_3, p.price_4, p.price_5].map(priceShort).join(' · ') : '— · — · — · — · —',
  };
};

export function ProductsScreen({ overview, detail, kind, accounts, whtTypes }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const excel = useExcelImport('products');
  const { counts, rows } = overview;
  const selected = creating ? null : detail?.product.code;
  const rateOf = (k: string | null) => {
    const t = whtTypes.find((x) => x.key === k);
    if (!t) return null;
    const [i = '0', f = ''] = t.rate.split('.');
    const bp = Number(i) * 10000 + Number((f + '0000').slice(0, 4)); // ร้อยละ × 100 (จำนวนเต็ม ไม่ใช่เงิน)
    return `${Math.floor(bp / 100)}${bp % 100 ? `.${String(bp % 100).padStart(2, '0').replace(/0$/u, '')}` : ''}`;
  };
  const taxText = (p: Product) => {
    const base = p.kind === 'expense' && p.vat_code !== 'vat7' ? 'ไม่มี' : VAT_TEXT[p.vat_code];
    const r = p.default_wht ? rateOf(p.default_wht) : null;
    return r ? `${base} · WHT ${r}%` : base;
  };
  const tabs: [string, string][] = [['', `ทั้งหมด ${counts.total}`], ['service', `บริการ ${counts.service}`], ['goods', `สินค้า ${counts.goods}`], ['expense', `ค่าใช้จ่าย ${counts.expense}`], ['kit', 'สินค้าชุด']];
  const link = (p: Record<string, string>) => {
    const s = new URLSearchParams({ ...(kind ? { kind } : {}), ...p });
    for (const [k, v] of [...s.entries()]) if (!v) s.delete(k);
    const t = s.toString();
    return t ? `?${t}` : '?';
  };

  return (
    <>
      <TopBar crumb="ข้อมูลหลัก / สินค้าและบริการ" right={<a href={href('settings')} style={css('color: #525252; text-decoration: none')}>โมดูลสต๊อก: ปิด · เปิดได้ที่ตั้งค่าบริษัท</a>} />
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
          <h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>สินค้าและบริการ</h1>
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            {excel.button}
            <Button size={36} kind="primary" disabled={kind === 'kit'} title={kind === 'kit' ? 'สินค้าชุดใช้ได้เมื่อเปิดโมดูลสต๊อก' : undefined} onClick={() => setCreating(true)}>เพิ่มรายการ</Button>
          </div>
        </div>
        {excel.panel}
        <div role="tablist" style={css('display: flex; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
          {tabs.map(([k, label]) => (
            <button key={k || 'all'} type="button" role="tab" aria-selected={kind === k} onClick={() => { setCreating(false); router.push(link({ kind: k, code: '' })); }} style={css(kind === k ? TAB_ON : TAB)}>{label}</button>
          ))}
        </div>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section role="tabpanel" style={css('flex: 1 1 520px; min-width: 0; border: 1px solid #e0e0e0; overflow-x: auto')}>
            <table style={css('width: 100%; min-width: 640px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
                <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รหัส</th><th style={css('padding: 0 12px; font-weight: 400')}>ชื่อ</th>
                <th style={css('padding: 0 12px; font-weight: 400')}>ประเภท</th><th style={css('padding: 0 12px; font-weight: 400')}>หน่วย</th>
                <th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ราคาขาย 1</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ราคาขาย 2</th>
                <th style={css('padding: 0 12px; font-weight: 400')}>ภาษี</th>
              </tr></thead>
              <tbody>
                {rows.map((p) => {
                  const on = p.code === selected;
                  return (
                    <tr key={p.code} style={css(`border-top: 1px solid #e0e0e0${on ? '; background: #e0e0e0' : ''}`)} aria-current={on ? 'true' : undefined}>
                      <td style={css('height: 40px; padding: 0 12px')}><a href={link({ code: p.code })} style={css('text-decoration: none; font-weight: 500')}>{p.code}</a></td>
                      <td style={css(TD)}>{p.name}</td><td style={css(TD)}>{KIND_TEXT[p.kind]}</td><td style={css(TD)}>{p.unit ?? ''}</td>
                      <td style={css(NUM)}>{money(p.price)}</td><td style={css(NUM)}>{money(p.price_2)}</td>
                      <td style={css(TD)}>{taxText(p)}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={7} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
              </tbody>
            </table>
          </section>
          {creating
            ? <Panel key="new" detail={null} kind={(kind || 'service') as Kind} accounts={accounts} onDone={() => setCreating(false)} link={link} />
            : detail && <Panel key={detail.product.code} detail={detail} kind={detail.product.kind} accounts={accounts} onDone={() => undefined} link={link} />}
        </div>
      </div>
    </>
  );
}

function Panel({ detail, kind, accounts, onDone, link }: { detail: ProductDetail | null; kind: Kind; accounts: { code: string; name: string }[]; onDone: () => void; link: (p: Record<string, string>) => string }) {
  const router = useRouter();
  const p = detail?.product ?? null;
  const isNew = !p;
  const initial = formOf(detail, kind);
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = isNew || (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== initial[k]);

  const accountCode = (label: string): string | null | false => {
    const t = label.trim();
    if (!t) return null;
    const code = /^(\d{7})\b/u.exec(t)?.[1];
    return code && accounts.some((a) => a.code === code) ? code : false;
  };

  async function save() {
    setErr(null);
    const revenue = accountCode(f.revenue);
    const expense = accountCode(f.expense);
    if (revenue === false || expense === false) { setErr('บัญชีไม่อยู่ในผังบัญชี'); return; }
    const prices = parsePrices(f.prices);
    if (!prices) { setErr('ราคาขาย 1–5 ไม่ถูกต้อง (คั่นด้วย · ช่องว่างใช้ —)'); return; }
    const body = {
      code: f.code.trim(), name: f.name.trim(), kind: f.kind, unit: f.unit.trim() || null, prices, vatCode: f.vatCode, defaultWht: f.wht || null, sku: f.sku.trim() || null,
      revenueAccount: revenue, expenseAccount: expense,
    };
    setBusy(true);
    const res = await fetch(isNew ? '/api/proxy/master/products' : `/api/proxy/master/products/${encodeURIComponent(p.code)}`, { method: isNew ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = (await res.json()) as { code?: string; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setErr(Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ')); return; }
    if (isNew && r.code) { onDone(); router.push(link({ code: r.code })); }
    router.refresh();
  }
  function cancel() {
    if (isNew) { onDone(); return; }
    setF(initial); setErr(null);
  }

  return (
    <section style={css('flex: 1 1 360px; min-width: 0; border: 1px solid #e0e0e0')}>
      <div style={css('padding: 16px; border-bottom: 1px solid #e0e0e0')}>
        <h2 style={css('margin: 0; font-size: 18px; font-weight: 600')}>{p ? `${p.code} ${p.name}` : 'เพิ่มรายการ'}</h2>
        {p && <span style={css('font-size: 13px; color: #525252')}>{`${KIND_TEXT[p.kind]} · ใช้ใน ${detail?.usedIn ?? 0} เอกสาร`}</span>}
      </div>
      <div style={css('padding: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px')}>
        {/* TODO(Wei) ScreenProducts.dc.html: แบบร่างไม่มีฟอร์ม "เพิ่มรายการ" — รายการใหม่ต้องมี รหัส/ชื่อ/ประเภท/หน่วย จึงเพิ่ม 4 ช่องนี้เฉพาะตอนสร้าง */}
        {isNew && <>
          <label style={css(LABEL)}>รหัส<input value={f.code} onChange={(e) => set('code', e.target.value)} style={css(INPUT)} /></label>
          <label style={css(LABEL)}>ชื่อ<input value={f.name} onChange={(e) => set('name', e.target.value)} style={css(INPUT)} /></label>
          <label style={css(LABEL)}>ประเภท<select value={f.kind} onChange={(e) => set('kind', e.target.value as Kind)} style={css(INPUT)}>
            {(['service', 'goods', 'expense'] as Kind[]).map((k) => <option key={k} value={k}>{KIND_TEXT[k]}</option>)}
          </select></label>
          <label style={css(LABEL)}>หน่วย<input value={f.unit} onChange={(e) => set('unit', e.target.value)} style={css(INPUT)} /></label>
        </>}
        <label style={css(LABEL)}>บัญชีรายได้<input value={f.revenue} list="product-accounts" onChange={(e) => set('revenue', e.target.value)} style={css(INPUT)} /></label>
        <label style={css(LABEL)}>บัญชีซื้อ/ต้นทุน<input value={f.expense} list="product-accounts" onChange={(e) => set('expense', e.target.value)} style={css(INPUT)} /></label>
        <label style={css(LABEL)}>รหัสภาษีขาย<select value={f.vatCode} onChange={(e) => set('vatCode', e.target.value as VatCode)} style={css(INPUT)}>
          {(Object.keys(VAT_TEXT) as VatCode[]).map((k) => <option key={k} value={k}>{VAT_TEXT[k]}</option>)}
        </select></label>
        <label style={css(LABEL)}>WHT ตั้งต้น (เมื่อซื้อ)<select value={f.wht} onChange={(e) => set('wht', e.target.value)} style={css(INPUT)}>
          {/* ค่าที่เก็บไว้แต่ไม่อยู่ในตัวเลือกของแบบร่าง → แสดงค่าดิบ ไม่ทับข้อมูล */}
          {f.wht && !WHT_DEFAULT.some(([v]) => v === f.wht) && <option value={f.wht}>{f.wht}</option>}
          {WHT_DEFAULT.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
        </select></label>
        <label style={css(LABEL)}>ราคาขาย 1–5<input value={f.prices} onChange={(e) => set('prices', e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
        <label style={css(LABEL)}>บาร์โค้ด / SKU<input value={f.sku} placeholder="—" onChange={(e) => set('sku', e.target.value)} style={css(INPUT)} /></label>
        <datalist id="product-accounts">{accounts.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
      </div>
      {err && <div role="alert" style={css('margin: 0 16px 16px; padding: 8px 12px; border-left: 3px solid #da1e28; background: #fff1f1; font-size: 14px')}>{err}</div>}
      {dirty && (
        <div style={css('display: flex; gap: 8px; justify-content: flex-end; padding: 0 16px 16px')}>
          <Button size={32} onClick={cancel}>ยกเลิก</Button>
          <Button size={32} kind="primary" disabled={busy} onClick={() => void save()}>บันทึก</Button>
        </div>
      )}
      <div style={css('padding: 12px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>สต๊อก จุดสั่งซื้อ ต้นทุนถัวเฉลี่ย และสินค้าชุด จะปรากฏเมื่อเปิดโมดูลสต๊อก</div>
    </section>
  );
}
