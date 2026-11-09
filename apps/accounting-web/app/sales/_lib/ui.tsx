// ชิ้นส่วนหน้าตาที่ฟอร์มขายใช้ร่วม — style string คัดลอกจากแบบร่าง (ScreenInvoice/ScreenQuote/ScreenCreditNote.dc.html)
import { css, Tag, type TagKind } from '@innovera/ui';
import type { ReactNode } from 'react';

export const F = {
  label: 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252',
  label2: 'grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252',
  input: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616',
  inputNum: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616; font-variant-numeric: tabular-nums',
  hint: 'font-size: 13px; color: #525252',
  grid: 'display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px',
  /** ช่องในตารางบรรทัด (ใช้แบบเดียวกับ ScreenJournal) */
  cell: 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; padding: 0 8px; width: 100%; box-sizing: border-box',
  cellNum: 'height: 32px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; padding: 0 8px; width: 100%; box-sizing: border-box; text-align: right; font-variant-numeric: tabular-nums',
  th: 'padding: 0 12px; font-weight: 400',
  thNum: 'padding: 0 12px; font-weight: 400; text-align: right',
  td: 'padding: 0 12px',
  num: 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums',
  page: 'padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box',
  h1: 'margin: 0; font-size: 22px; line-height: 30px; font-weight: 600',
  sticky: 'position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap; gap: 8px',
  tabOn: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600',
  tabOff: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #525252; font-family: inherit; font-size: 14px',
  segOn: 'height: 36px; padding: 0 16px; border: 0; border-radius: 0; background: #0f62fe; color: #ffffff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer',
  segOff: 'height: 36px; padding: 0 16px; border: 0; border-radius: 0; background: #ffffff; color: #161616; font-family: inherit; font-size: 14px; font-weight: 400; cursor: pointer',
} as const;

export function DocHeader({ crumb, tag }: { crumb: ReactNode; tag: { kind: TagKind; text: string } | null }) {
  return (
    <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
      <span style={css('color: #525252')}>{crumb}</span>
      {tag && <Tag kind={tag.kind}>{tag.text}</Tag>}
    </header>
  );
}

export function Msg({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>;
}
