// ชิ้นส่วนที่ซ้ำกันในแบบร่าง Console*.dc.html — style string คัดลอกจากแบบร่างตรงตัว (แปลงด้วย css() ของ @innovera/ui)
import { css } from '@innovera/ui';
import type { ReactNode } from 'react';
import type { Tone } from './lib/rules';

const BTN = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; text-decoration: none';
export const B = {
  primary: `${BTN}; height: 40px; padding: 0 16px; background: #0f62fe; color: #ffffff; border: 1px solid #0f62fe`,
  secondary: `${BTN}; height: 40px; padding: 0 16px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d`,
  disabled: `${BTN}; height: 40px; padding: 0 16px; background: #e0e0e0; color: #6f6f6f; border: 1px solid #e0e0e0; cursor: not-allowed`,
  secondarySm: `${BTN}; height: 32px; padding: 0 12px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d`,
  ghostSm: `${BTN}; height: 32px; padding: 0 12px; background: transparent; color: #0f62fe; border: 1px solid transparent`,
} as const;

export const ST = {
  h1: 'margin: 0; font-size: 22px; line-height: 30px; font-weight: 600',
  sub: 'font-size: 13px; color: #525252',
  content: 'padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 24px',
  tableBox: 'border: 1px solid #e0e0e0; overflow-x: auto',
  table: (minWidth?: number) => `width: 100%;${minWidth ? ` min-width: ${minWidth}px;` : ''} border-collapse: collapse; font-size: 14px; line-height: 20px`,
  theadRow: 'background: #f4f4f4; color: #525252; font-size: 13px; text-align: left',
  th: 'height: 40px; padding: 0 12px; font-weight: 400',
  tr: 'border-top: 1px solid #e0e0e0',
  td1: 'height: 44px; padding: 0 12px',
  td: 'padding: 0 12px',
  grid2: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px; align-items: start',
  split: 'display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start',
  label: 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252',
  input: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616',
  filter: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px',
  link: 'text-decoration: none',
} as const;

const TONE: Record<Tone, string> = {
  success: 'background: #defbe6; color: #0e6027',
  warning: 'background: #fcf4d6; color: #684e00',
  error: 'background: #fff1f1; color: #a2191f',
  info: 'background: #edf5ff; color: #0043ce',
  neutral: 'background: #e0e0e0; color: #161616',
};
/** ป้ายสถานะในแบบร่าง Console (มีจุดทุกสี รวมสีเทา "ปิดแล้ว"/"ปิด") */
export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span style={css(`display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; ${TONE[tone]}; font-size: 13px; font-weight: 500`)}>
      <span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')} />{children}
    </span>
  );
}
export function P2({ children = 'Phase 2' }: { children?: string }) {
  return <span style={css('display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 4px; background: #e8daff; color: #491d8b; font-size: 12px; font-weight: 500')}>{children}</span>;
}

/** แถบตัวเลขสรุปใต้หัวเรื่อง */
export function Stats({ children }: { children: ReactNode }) {
  return <section style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px 24px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0')}>{children}</section>;
}
export function Stat({ label, value, color = '#161616', note = '' }: { label: string; value: ReactNode; color?: string; note?: ReactNode }) {
  return (
    <div><span style={css('color: #525252; font-size: 13px')}>{label}</span>
      <div style={css(`font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${color}`)}>{value}</div>
      <span style={css('font-size: 13px; color: #525252')}>{note}</span></div>
  );
}

/** กล่องรายการ (หัวข้อตัวหนา + แถวซ้าย/ขวา) */
export function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>{title}</strong>{children}</section>;
}
export function Row({ left, right, color = '#525252' }: { left: ReactNode; right?: ReactNode; color?: string }) {
  return <div style={css('display: flex; justify-content: space-between; gap: 12px')}><span>{left}</span><span style={css(`color: ${color}; text-align: right`)}>{right}</span></div>;
}
export const Note = ({ children }: { children: ReactNode }) => <span style={css('font-size: 13px; color: #525252')}>{children}</span>;

/** หัวเรื่องหน้า */
export function Title({ h1, sub }: { h1: string; sub: ReactNode }) {
  return <div><h1 style={css(ST.h1)}>{h1}</h1><span style={css(ST.sub)}>{sub}</span></div>;
}

/** ปุ่มในแบบร่างที่ยังไม่มี backend — คงหน้าตาตามแบบร่าง แต่กดไม่ได้ (disabled) · เหตุผลอยู่ใน TODO ที่จุดใช้ */
export function Inert({ kind, children }: { kind: keyof typeof B; children: ReactNode }) {
  return <button type="button" disabled aria-disabled="true" style={css(B[kind])}>{children}</button>;
}

/** แท็บตามแบบร่าง · ไม่ส่ง onSelect = แท็บอื่นยังไม่มีเนื้อหาในแบบร่าง (กดไม่ได้ — TODO(Wei) ที่จุดใช้) */
export function Tabs({ tabs, selected, onSelect }: { tabs: string[]; selected: number; onSelect?: (i: number) => void }) {
  return (
    <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
      {tabs.map((t, i) => (
        <button key={t} type="button" role="tab" aria-selected={i === selected} disabled={!onSelect && i !== selected} onClick={onSelect ? () => onSelect(i) : undefined}
          style={css(i === selected ? 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; font-family: inherit; font-size: 14px; font-weight: 600' : 'height: 40px; padding: 0 16px; border: 0; background: transparent; font-family: inherit; font-size: 14px; color: #525252')}>{t}</button>
      ))}
    </div>
  );
}
export const DASH = '—';
