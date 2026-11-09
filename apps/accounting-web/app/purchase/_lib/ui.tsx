// ชิ้นส่วนหน้าตาที่ฟอร์มซื้อใช้ร่วม — style string คัดลอกจากแบบร่าง (ScreenPurchaseOrder/Bill/Expense/CreditNote.dc.html)
import { css, Tag, type TagKind } from '@innovera/ui';
import type { ReactNode } from 'react';
import { call, type Result } from '../../sales/_lib/client.ts';

export const P = {
  segOn: 'height: 32px; padding: 0 12px; border: 0; border-radius: 0; background: #0f62fe; color: #ffffff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer',
  segOff: 'height: 32px; padding: 0 12px; border: 0; border-radius: 0; background: #ffffff; color: #161616; font-family: inherit; font-size: 14px; font-weight: 400; cursor: pointer',
  seg: 'display: inline-flex; border: 1px solid #8d8d8d; border-radius: 4px; overflow: hidden',
  input: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616',
  inputNum: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616; font-variant-numeric: tabular-nums',
  cellSel: 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px',
  box: 'border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column',
  footerEnd: 'position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: flex-end; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0',
  footerBetween: 'position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap; gap: 8px',
  sumTd: 'height: 32px',
  sumNum: 'text-align: right; font-variant-numeric: tabular-nums',
  sumTotal: 'height: 40px; font-weight: 600; font-size: 16px',
  sumTotalNum: 'text-align: right; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums',
} as const;

/** แถบบน: crumb ซ้าย · (ตัวสลับประเภท) + ป้ายสถานะขวา */
export function PHeader({ crumb, toggle, tag }: { crumb: ReactNode; toggle?: ReactNode; tag: { kind: TagKind; text: string } }) {
  return (
    <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
      <span style={css('color: #525252')}>{crumb}</span>
      {toggle ? <div style={css('display: flex; align-items: center; gap: 12px')}>{toggle}<Tag kind={tag.kind}>{tag.text}</Tag></div> : <Tag kind={tag.kind}>{tag.text}</Tag>}
    </header>
  );
}

/** ตัวสลับ 2 ทาง (PR/PO · CNR/DNR) */
export function Seg<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} style={css(P.seg)}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} disabled={disabled && value !== v} onClick={() => { if (!disabled) onChange(v); }} style={css(value === v ? P.segOn : P.segOff)}>{text}</button>
      ))}
    </div>
  );
}

/** ป้าย "รอยืนยัน" ของค่าที่รอผู้สอบบัญชี (CLAUDE.md) */
export const Pending = () => <Tag kind="warning">รอยืนยัน</Tag>;

/** อนุมัติเอกสารซื้อ = POST purchases/:id/approve · ส่งขออนุมัติ/ปฏิเสธ = documents/:id/… */
export function docAction<T>(id: string, action: 'approve' | 'submit' | 'reject', body?: unknown): Promise<Result<T>> {
  return call<T>(action === 'approve' ? `purchases/${id}/approve` : `documents/${id}/${action}`, 'POST', body);
}
