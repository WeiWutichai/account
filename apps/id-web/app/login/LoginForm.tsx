'use client';
// ScreenLogin.dc.html — การ์ดเข้าสู่ระบบ
import { Button, buttonStyle, css } from '@innovera/ui';
import { useState, type FormEvent } from 'react';
import { call, nextUrl } from '../lib/client';
import { ErrorText, OrDivider, T, withNext } from '../lib/ui';

const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';

export function LoginForm({ next, dest }: { next: string | null; dest: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call<{ next: string }>('v1/auth/login', 'POST', { email, password });
    if (!r.ok) { setError(r.error); setBusy(false); return; }
    // "จำอุปกรณ์นี้ 30 วัน" → ส่งต่อเป็นค่าเริ่มต้นของ "เชื่อถืออุปกรณ์นี้ 30 วัน" ในขั้น 2FA (id-api ตั้ง cookie อุปกรณ์ตอนยืนยัน 2FA)
    window.location.assign(nextUrl(r.data.next, { next, dest, trust: remember }));
  }

  return (
    <form onSubmit={submit} style={css('width: 100%; max-width: 400px; background: #ffffff; border: 1px solid #e0e0e0; padding: 32px; display: flex; flex-direction: column; gap: 20px; box-sizing: border-box')}>
      <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>เข้าสู่ระบบ</h1><span style={css('font-size: 13px; color: #525252')}>ใช้ Innovera ID เดียวกับ TMS</span></div>
      <label style={css(T.label)}>อีเมล<input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={css(INPUT)} /></label>
      <label style={css(T.label)}><span style={css('display: flex; justify-content: space-between')}>รหัสผ่าน<a href={withNext('/password/reset', next)} style={css(T.link)}>ลืมรหัสผ่าน</a></span><input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={css(INPUT)} /></label>
      <label style={css('display: flex; align-items: center; gap: 8px; font-size: 14px')}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> จำอุปกรณ์นี้ 30 วัน</label>
      <ErrorText>{error}</ErrorText>
      <button type="submit" disabled={busy} style={buttonStyle('primary', 40, false, 'width: 100%')}>ดำเนินการต่อ</button>
      <OrDivider />
      {/* TODO(Phase 2): SSO Google Workspace / Microsoft 365 (docs/technical-plan-M3.md §ไม่อยู่ใน M3) — แสดงตามแบบร่าง ยังไม่ทำงาน */}
      <Button kind="secondary">เข้าสู่ระบบด้วย Google Workspace</Button>
      <Button kind="secondary">เข้าสู่ระบบด้วย Microsoft 365</Button>
      <div style={css('font-size: 13px; color: #525252; border-top: 1px solid #e0e0e0; padding-top: 16px; display: flex; flex-direction: column; gap: 8px')}>
        <span>หลังเข้าสู่ระบบจะขอรหัส 2FA จากแอป Authenticator (บังคับสำหรับทุกบริษัทที่เปิดไว้)</span>
        <span>ยังไม่มีบัญชี? <a href={withNext('/signup', next)} style={css(T.link)}>สมัครและสร้างบริษัทแรก (ทดลองใช้ 30 วัน)</a></span>
        {/* TODO(Wei): "เปิดลิงก์คำเชิญ" ไม่มีปลายทางที่แน่นอน (ลิงก์อยู่ในอีเมลคำเชิญ /invite/<token>) — ScreenLogin.dc.html ลิงก์ไป ScreenInviteAccept */}
        <span>ได้รับคำเชิญจากบริษัท? <a style={css(T.link)}>เปิดลิงก์คำเชิญ</a> แล้วเข้าสู่ระบบด้วยอีเมลที่ถูกเชิญ</span>
      </div>
    </form>
  );
}
