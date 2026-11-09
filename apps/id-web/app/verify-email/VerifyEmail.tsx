'use client';
// TODO(Wei) T7: แบบร่างไม่มีหน้ายืนยันอีเมล — การ์ดตาม ScreenTwoFactor.dc.html · หัวข้อ "ยืนยันอีเมล" จากขั้น 2 ของ ScreenSignup · ปุ่มส่งใหม่ตามแบบ ScreenPasswordReset ขั้น 2
import { buttonStyle, css } from '@innovera/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { call, nextUrl } from '../lib/client';
import { CodeInput } from '../lib/CodeInput';
import { ErrorText, T, withNext } from '../lib/ui';

const COOLDOWN_S = 60; // id-api LIMITS.resendCooldownS

export function VerifyEmail({ next, dest }: { next: string | null; dest: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(COOLDOWN_S);

  useEffect(() => {
    void call<{ email: string }>('v1/auth/pending?stage=verify').then((r) => {
      if (r.ok) setEmail(r.data.email);
      else { setError(r.error); setExpired(true); }
    });
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call<{ next: string }>('v1/auth/verify-email', 'POST', { code });
    if (!r.ok) { setError(r.error); setExpired(r.code === 'pending_expired'); setBusy(false); return; }
    window.location.assign(nextUrl(r.data.next, { next, dest }));
  }
  async function resend() {
    setError(null);
    const r = await call('v1/auth/verify-email/resend', 'POST');
    if (!r.ok) setError(r.error);
    setWait(COOLDOWN_S);
  }

  return (
    <form onSubmit={submit} style={css(T.card(460))}>
      <div><h1 style={css(T.h1)}>ยืนยันอีเมล</h1><span style={css(T.sub)}>{email ? `${email} · ` : ''}จะส่งรหัสยืนยัน 6 หลักไปที่อีเมลนี้</span></div>
      <CodeInput value={code} onChange={setCode} />
      <ErrorText>{error}</ErrorText>
      {expired && <a href={withNext('/login', next)} style={css('font-size: 14px; text-decoration: none')}>← กลับไปเข้าสู่ระบบ</a>}
      <button type="submit" disabled={busy || code.length !== 6} style={buttonStyle('primary', 40, busy || code.length !== 6, 'width: 100%')}>ยืนยันอีเมล</button>
      <div style={css('display: flex; flex-direction: column; gap: 6px; font-size: 14px; border-top: 1px solid #e0e0e0; padding-top: 16px')}>
        {wait > 0
          ? <span style={css('color: #525252')}>ส่งใหม่ได้ใน <span style={css('font-variant-numeric: tabular-nums')}>{`${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`}</span></span>
          : <button type="button" onClick={resend} style={css(T.linkButton)}>ส่งอีเมลอีกครั้ง</button>}
      </div>
    </form>
  );
}
