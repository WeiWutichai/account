'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ชิ้นส่วนชั่วคราวของ Phase 2A ที่ใช้ร่วม: ป้าย "หน้าชั่วคราว" · คำกำกับ "(ชั่วคราว)" · ป้าย "รอยืนยัน (ผู้สอบบัญชี)"
// · ช่องสกุลเงิน/อัตรา/สาขา/คลังบนฟอร์มเอกสาร (แสดงเฉพาะเมื่อเปิดโมดูล — ปิดโมดูล = ไม่ render อะไรเลย)
import { css, money } from '@innovera/ui';
import { useEffect, useRef, useState } from 'react';
import { divRound, parseDec } from '../sales/_lib/num';
import type { DocFxFields, P2A } from './types';

export const P2A_LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
export const P2A_INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';

/** ป้ายบนหน้าใหม่ที่ยังไม่มีแบบร่าง */
export function TempBanner() {
  return (
    <div role="note" style={css('padding: 12px 16px; border: 1px solid #f1c21b; border-left: 3px solid #f1c21b; background: #fcf4d6; color: #161616; font-size: 14px')}>
      หน้าชั่วคราว — ยังไม่มีแบบร่าง (Phase 2A)
    </div>
  );
}
/** คำกำกับช่องที่เพิ่มเข้าไปในหน้าที่มีแบบร่างแล้ว */
export function TempHint() {
  return <span style={css('font-size: 12px; color: #6f6f6f; font-weight: 400')}> (ชั่วคราว)</span>;
}
/** ป้ายเหลือง "รอยืนยัน (ผู้สอบบัญชี)" */
export function PendingAuditor() {
  return <span style={css('display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; background: #fcf4d6; color: #684e00; font-size: 13px; font-weight: 500; white-space: nowrap')}>
    <span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')} />รอยืนยัน (ผู้สอบบัญชี)</span>;
}

/** อัตรา '33.250000' → '33.25' (คงอย่างน้อย 2 ตำแหน่ง) */
export function rateText(r: string | null | undefined): string {
  if (!r) return '';
  const [i = '0', f = ''] = r.split('.');
  return `${i}.${f.replace(/0+$/u, '').padEnd(2, '0')}`;
}
/** ยอด × อัตรา → บาท (ปัด 2 ตำแหน่ง half-up · BigInt) */
export function toThb(amount: string | null | undefined, rate: string | null | undefined): string | null {
  const a = parseDec(amount, 2);
  const r = parseDec(rate, 6);
  if (a === null || r === null || r <= 0n) return null;
  const c = divRound(a * r, 1_000_000n);
  const s = (c < 0n ? -c : c).toString().padStart(3, '0');
  return `${c < 0n ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

export interface DocFx {
  on: boolean; p2a: P2A; editable: boolean;
  currency: string; rate: string; branch: string; warehouse: string; rateNote: string | null;
  setCurrency: (v: string) => void; setRate: (v: string) => void; setBranch: (v: string) => void; setWarehouse: (v: string) => void;
  /** ฟิลด์ที่ส่งไป API (เฉพาะโมดูลที่เปิด · ปิด = {} → พฤติกรรม Phase 1) */
  payload: (withWarehouse?: boolean) => Record<string, string | null>;
  foreign: boolean;
}

/** สถานะช่อง P2A ของเอกสาร · อัตราเติมจาก GET /v1/fx/rates/on ตามสกุล+วันที่ (จนกว่าผู้ใช้จะแก้เอง) */
export function useDocFx(p2a: P2A, doc: DocFxFields | null, isoDate: string | null, editable: boolean, onChange?: () => void): DocFx {
  const m = p2a.modules;
  const [currency, setCur] = useState(doc?.currency ?? 'THB');
  const [rate, setRateRaw] = useState(doc?.fx_rate ? rateText(doc.fx_rate) : '');
  const [branch, setBranch] = useState(doc?.branch_code ?? '00000');
  const [warehouse, setWarehouse] = useState(doc?.warehouse_id ?? '');
  const [rateNote, setRateNote] = useState<string | null>(null);
  const manual = useRef(Boolean(doc?.fx_rate));
  const foreign = currency !== 'THB';
  useEffect(() => {
    if (!m.multi_currency || !editable || !foreign || !isoDate || manual.current) return;
    const ctl = new AbortController();
    void fetch(`/api/proxy/fx/rates/on?currency=${encodeURIComponent(currency)}&date=${isoDate}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = (await r.json()) as { rate?: string; error?: string };
        if (r.ok && j.rate) { setRateRaw(rateText(j.rate)); setRateNote(`อัตรา ณ ${isoDate} จากทะเบียนอัตรา`); } else { setRateRaw(''); setRateNote(j.error ?? 'ยังไม่มีอัตรา ณ วันที่นี้'); }
      }).catch(() => undefined);
    return () => ctl.abort();
  }, [currency, isoDate, foreign, editable, m.multi_currency]);
  return {
    on: m.multi_currency || m.branches || m.inventory, p2a, editable, currency, rate, branch, warehouse, rateNote, foreign: m.multi_currency && foreign,
    setCurrency: (v) => { manual.current = false; setCur(v); if (v === 'THB') { setRateRaw(''); setRateNote(null); } onChange?.(); },
    setRate: (v) => { manual.current = true; setRateRaw(v); setRateNote(null); onChange?.(); },
    setBranch: (v) => { setBranch(v); onChange?.(); }, setWarehouse: (v) => { setWarehouse(v); onChange?.(); },
    payload: (withWarehouse = true) => ({
      ...(m.multi_currency ? { currency, fxRate: currency === 'THB' ? null : (rate.replace(/,/gu, '').trim() || null) } : {}),
      ...(m.branches ? { branchCode: branch } : {}),
      ...(m.inventory && withWarehouse ? { warehouseId: warehouse || null } : {}),
    }),
  };
}

/** ช่อง สกุลเงิน · อัตรา · สาขา · คลัง — วางในกริด 4 คอลัมน์ของฟอร์มเดิม · ไม่มีโมดูลที่เปิด = ไม่แสดง */
export function DocFxFields({ fx, withWarehouse = false, idPrefix }: { fx: DocFx; withWarehouse?: boolean; idPrefix: string }) {
  const { p2a, editable } = fx;
  const m = p2a.modules;
  if (!m.multi_currency && !m.branches && !(m.inventory && withWarehouse)) return null;
  const IN = css(P2A_INPUT);
  const branches = p2a.branches.some((b) => b.code === fx.branch) ? p2a.branches : [...p2a.branches, { code: fx.branch, name: fx.branch === '00000' ? 'สำนักงานใหญ่' : fx.branch, address: null, tax_id: null, files_separately: true, active: true }];
  return (
    <>
      {m.multi_currency && <label style={css(P2A_LABEL)}><span>สกุลเงิน<TempHint /></span>
        <select id={`${idPrefix}-currency`} disabled={!editable} value={fx.currency} onChange={(e) => fx.setCurrency(e.target.value)} style={IN}>
          <option value="THB">THB บาท</option>
          {p2a.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
          {fx.currency !== 'THB' && !p2a.currencies.some((c) => c.code === fx.currency) && <option value={fx.currency}>{fx.currency}</option>}
        </select></label>}
      {m.multi_currency && fx.currency !== 'THB' && <label style={css(P2A_LABEL)}><span>อัตราแลกเปลี่ยน (บาท/1 {fx.currency})<TempHint /></span>
        <input id={`${idPrefix}-rate`} readOnly={!editable} inputMode="decimal" value={fx.rate} onChange={(e) => fx.setRate(e.target.value)} style={css(`${P2A_INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} />
        {fx.rateNote && <span style={css('font-size: 12px; color: #525252')}>{fx.rateNote}</span>}</label>}
      {m.branches && <label style={css(P2A_LABEL)}><span>สาขา<TempHint /></span>
        <select id={`${idPrefix}-branch`} disabled={!editable} value={fx.branch} onChange={(e) => fx.setBranch(e.target.value)} style={IN}>
          {branches.map((b) => <option key={b.code} value={b.code}>{b.code} {b.name}</option>)}
        </select></label>}
      {m.inventory && withWarehouse && <label style={css(P2A_LABEL)}><span>คลังสินค้า<TempHint /></span>
        <select id={`${idPrefix}-warehouse`} disabled={!editable} value={fx.warehouse} onChange={(e) => fx.setWarehouse(e.target.value)} style={IN}>
          <option value="">คลังตั้งต้น</option>
          {p2a.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
        </select></label>}
    </>
  );
}

/** แถวสรุปยอดบาทใต้ยอดรวม (เอกสารสกุลต่างประเทศเท่านั้น) — ลงบัญชีแล้วใช้ยอดบาทที่บันทึก (grand_total_thb) */
export function FxTotalRows({ currency, rate, grand, grandThb, labelStyle, numStyle }: {
  currency: string; rate: string | null | undefined; grand: string | null | undefined; grandThb?: string | null; labelStyle: string; numStyle: string;
}) {
  if (currency === 'THB') return null;
  const thb = grandThb ?? toThb(grand, rate);
  return (
    <>
      <tr><td style={css(labelStyle)}>สกุลเงิน{rate ? ` · อัตรา ${rateText(rate)}` : ''}<TempHint /></td><td style={css(numStyle)}>{currency}</td></tr>
      <tr><td style={css(labelStyle)}>ยอดรวมเป็นบาท{grandThb ? '' : ' (ประมาณ)'}<TempHint /></td><td style={css(numStyle)}>{thb ? money(thb) : '—'}</td></tr>
    </>
  );
}
