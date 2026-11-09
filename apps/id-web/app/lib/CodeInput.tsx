'use client';
// ช่องรหัส 6 หลัก (ScreenTwoFactor.dc.html) · พิมพ์แล้วเลื่อนช่องถัดไป · วางรหัสทั้งชุดได้ · Backspace ย้อนกลับ
import { css } from '@innovera/ui';
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { T } from './ui';

export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const set = (i: number, d: string) => {
    const arr = [...digits];
    arr[i] = d;
    onChange(arr.join('').slice(0, 6));
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) { set(i - 1, ''); refs.current[i - 1]?.focus(); e.preventDefault(); }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData('text').replace(/\D/gu, '').slice(0, 6);
    if (!t) return;
    e.preventDefault();
    onChange(t);
    refs.current[Math.min(t.length, 5)]?.focus();
  };
  return (
    <div style={css('display: flex; gap: 8px; justify-content: space-between')}>
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} aria-label={`หลักที่ ${i + 1}`} maxLength={1} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} value={d}
          onChange={(e) => { const v = e.target.value.replace(/\D/gu, '').slice(-1); set(i, v); if (v && i < 5) refs.current[i + 1]?.focus(); }}
          onKeyDown={(e) => onKey(i, e)} onPaste={onPaste} style={css(T.digit(!!d))} />
      ))}
    </div>
  );
}
