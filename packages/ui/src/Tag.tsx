// ป้ายสถานะ (StatusTag) · สีมาคู่คำเสมอ · ตามแบบร่าง
import { css } from './css.ts';

export type TagKind = 'success' | 'warning' | 'error' | 'info' | 'neutral';
const KIND: Record<TagKind, string> = {
  success: 'background: #defbe6; color: #0e6027',
  warning: 'background: #fcf4d6; color: #684e00',
  error: 'background: #fff1f1; color: #a2191f',
  info: 'background: #edf5ff; color: #0043ce',
  neutral: 'background: #e0e0e0; color: #161616',
};

export function Tag({ kind, children }: { kind: TagKind; children: string }) {
  return (
    <span style={css(`display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; ${KIND[kind]}; font-size: 13px; font-weight: 500`)}>
      {kind !== 'neutral' && <span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')} />}
      {children}
    </span>
  );
}
