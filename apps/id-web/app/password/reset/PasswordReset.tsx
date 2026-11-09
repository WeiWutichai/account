'use client';
// ScreenPasswordReset.dc.html — ขั้น 1 / 3 ลืมรหัสผ่าน · ขั้น 2 / 3 ตรวจอีเมล · ขั้น 3 / 3 ตั้งรหัสผ่านใหม่
import { buttonStyle, css } from '@innovera/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { call, nextUrl } from '../../lib/client';
import { maskLocal } from '../../lib/fmt';
import { ErrorText, T, withNext } from '../../lib/ui';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function ForgotPassword({ next }: { next: string | null }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call<{ resendInS: number }>('v1/auth/password/forgot', 'POST', { email });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setSent(true);
    setWait(r.data.resendInS);
  }

  if (!sent) {
    return (
      <form onSubmit={send} style={css(T.card(400))}>
        <div><div style={css(T.sub)}>ขั้น 1 / 3</div><h1 style={css(T.h2)}>ลืมรหัสผ่าน</h1></div>
        <label style={css(T.label)}>อีเมลของบัญชี Innovera ID<input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={css(T.input)} /></label>
        <span style={css(T.sub)}>ถ้ามีบัญชี ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ (หมดอายุใน 30 นาที ใช้ได้ครั้งเดียว) — ข้อความตอบกลับเหมือนกันไม่ว่าอีเมลจะมีในระบบหรือไม่ เพื่อไม่ให้เดาบัญชีได้</span>
        <ErrorText>{error}</ErrorText>
        <button type="submit" disabled={busy} style={buttonStyle('primary', 40, false, 'width: 100%')}>ส่งลิงก์ตั้งรหัสผ่านใหม่</button>
        <a href={withNext('/login', next)} style={css('font-size: 14px; text-decoration: none')}>← กลับไปเข้าสู่ระบบ</a>
      </form>
    );
  }
  return (
    <section style={css(T.card(400))}>
      <div><div style={css(T.sub)}>ขั้น 2 / 3</div><h1 style={css(T.h2)}>ตรวจอีเมลของคุณ</h1></div>
      <div role="status" style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
        <strong>ส่งแล้วไปที่ {maskLocal(email)}</strong>
        <span style={css('color: #525252')}>กดลิงก์ในอีเมลภายใน 30 นาที · ถ้าไม่พบให้ดูในโฟลเดอร์สแปม</span>
        {/* TODO(Wei): แบบร่างแสดงเฉพาะระหว่างนับถอยหลัง — เมื่อครบเวลาซ่อนบรรทัดนี้และเปิดปุ่ม */}
        {wait > 0 && <span style={css('color: #525252')}>ส่งใหม่ได้ใน <span style={css('font-variant-numeric: tabular-nums')}>{mmss(wait)}</span></span>}
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="button" disabled={wait > 0 || busy} onClick={() => void send()} style={buttonStyle('primary', 40, wait > 0 || busy, 'width: 100%')}>ส่งอีเมลอีกครั้ง</button>
      <span style={css(T.sub)}>ระบบแจ้งเจ้าของบัญชีทุกครั้งที่มีการขอตั้งรหัสผ่านใหม่ และบันทึกใน Audit log ของทุกบริษัทที่ผู้ใช้สังกัด</span>
    </section>
  );
}

export function NewPassword({ token, next, dest }: { token: string; next: string | null; dest: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [logoutOthers, setLogoutOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call<{ next: string }>('v1/auth/password/reset', 'POST', { token, password, confirm, logoutOthers });
    if (!r.ok) { setError(r.error); setBusy(false); return; }
    window.location.assign(nextUrl(r.data.next, { next, dest }));
  }

  return (
    <form onSubmit={submit} style={css(T.card(400))}>
      <div><div style={css(T.sub)}>ขั้น 3 / 3 · เปิดจากลิงก์ในอีเมล</div><h1 style={css(T.h2)}>ตั้งรหัสผ่านใหม่</h1></div>
      <label style={css(T.label)}>รหัสผ่านใหม่<input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} style={css(T.input)} /><span style={css(T.sub)}>อย่างน้อย 12 ตัวอักษร · ห้ามซ้ำกับ 5 รหัสล่าสุด</span></label>
      <label style={css(T.label)}>ยืนยันรหัสผ่านใหม่<input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} style={css(T.input)} /></label>
      <label style={css(T.check)}><input type="checkbox" checked={logoutOthers} onChange={(e) => setLogoutOthers(e.target.checked)} style={css(T.checkBox)} /> ออกจากระบบทุกอุปกรณ์อื่น (แนะนำ)</label>
      <ErrorText>{error}</ErrorText>
      <button type="submit" disabled={busy} style={buttonStyle('primary', 40, false, 'width: 100%')}>บันทึกรหัสผ่านและเข้าสู่ระบบ</button>
      <span style={css(T.sub)}>หลังตั้งใหม่ระบบจะขอรหัส 2FA ตามปกติ · บัญชีที่ใช้ SSO ขององค์กร ให้ตั้งรหัสผ่านที่ผู้ให้บริการ SSO แทน</span>
    </form>
  );
}
