// ปุ่มมาตรฐาน 5 แบบ (CLAUDE.md · แบบร่าง): หลัก · รอง · ข้อความ · อันตราย · ใช้ไม่ได้ · สูง 40/36/32 · radius 4px · ชื่อกึ่งกลาง
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { css } from './css.ts';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 40 | 36 | 32;

const BASE = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer';
const SIZE: Record<ButtonSize, string> = { 40: 'height: 40px; padding: 0 16px', 36: 'height: 36px; padding: 0 16px', 32: 'height: 32px; padding: 0 12px' };
const KIND: Record<ButtonKind, string> = {
  primary: 'background: #0f62fe; color: #ffffff; border: 1px solid #0f62fe',
  secondary: 'background: #ffffff; color: #161616; border: 1px solid #8d8d8d',
  ghost: 'background: transparent; color: #0f62fe; border: 1px solid transparent',
  danger: 'background: #ffffff; color: #da1e28; border: 1px solid #da1e28',
};
const DISABLED = 'background: #e0e0e0; color: #6f6f6f; border: 1px solid #e0e0e0; cursor: not-allowed';

export function buttonStyle(kind: ButtonKind, size: ButtonSize = 40, disabled = false, extra = '') {
  return css(`${BASE}; ${SIZE[size]}; ${disabled ? DISABLED : KIND[kind]}${extra ? `; ${extra}` : ''}`);
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  kind?: ButtonKind;
  size?: ButtonSize;
  extra?: string;
  children: ReactNode;
}

export function Button({ kind = 'secondary', size = 40, extra = '', disabled = false, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled} style={buttonStyle(kind, size, disabled, extra)} {...rest}>
      {children}
    </button>
  );
}

/** ลิงก์ที่หน้าตาเป็นปุ่ม (แบบร่างใช้ <a> สำหรับปุ่มที่พาไปหน้าอื่น) */
export function ButtonLink({ href, kind = 'secondary', size = 40, extra = '', children }: { href: string; kind?: ButtonKind; size?: ButtonSize; extra?: string; children: ReactNode }) {
  return (
    <a href={href} style={buttonStyle(kind, size, false, `text-decoration: none${extra ? `; ${extra}` : ''}`)}>
      {children}
    </a>
  );
}
