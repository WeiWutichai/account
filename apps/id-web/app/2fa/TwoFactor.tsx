'use client';
// ScreenTwoFactor.dc.html — การ์ด "ยืนยันตัวตน 2 ชั้น" และ "ตั้งค่า 2FA"
import { Button, buttonStyle, css } from '@innovera/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call, nextUrl } from '../lib/client';
import { CodeInput } from '../lib/CodeInput';
import { maskEmail } from '../lib/fmt';
import { ErrorText, T, withNext } from '../lib/ui';

export function MfaCard({ next, dest, trustDefault }: { next: string | null; dest: string; trustDefault: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState<string | null>(null); // null = ใช้รหัสจากแอป
  const [trust, setTrust] = useState(trustDefault);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call<{ email: string }>('v1/auth/pending?stage=mfa').then((r) => {
      if (r.ok) setEmail(r.data.email);
      else { setError(r.error); setExpired(true); }
    });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call<{ next: string }>('v1/auth/2fa/verify', 'POST', backup === null ? { code, trust } : { backupCode: backup, trust });
    if (!r.ok) { setError(r.error); setExpired(r.code === 'pending_expired'); setBusy(false); return; }
    window.location.assign(nextUrl(r.data.next, { next, dest }));
  }

  return (
    <form onSubmit={submit} style={css(T.card(460))}>
      <div><h1 style={css(T.h1)}>ยืนยันตัวตน 2 ชั้น</h1><span style={css(T.sub)}>เข้าสู่ระบบในชื่อ {email} · เปิดแอป Authenticator แล้วกรอกรหัส 6 หลัก</span></div>
      {backup === null
        ? <CodeInput value={code} onChange={setCode} />
        // TODO(Wei): แบบร่างไม่มีช่องกรอกรหัสสำรอง → ใช้ช่องกรอกมาตรฐานของแบบร่าง
        : <label style={css(T.label)}>รหัสสำรอง (backup code)<input autoComplete="one-time-code" value={backup} onChange={(e) => setBackup(e.target.value)} style={css(T.input)} /></label>}
      <span style={css(T.sub)}>รหัสเปลี่ยนทุก 30 วินาที · ผิดได้ 5 ครั้งแล้วล็อก 15 นาที</span>
      <label style={css('display: flex; gap: 8px; align-items: center; font-size: 14px')}><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> เชื่อถืออุปกรณ์นี้ 30 วัน (ไม่ถามรหัสอีกบนเบราว์เซอร์นี้)</label>
      <ErrorText>{error}</ErrorText>
      {expired && <a href={withNext('/login', next)} style={css('font-size: 14px; text-decoration: none')}>← กลับไปเข้าสู่ระบบ</a>}
      <button type="submit" disabled={busy} style={buttonStyle('primary', 40, false, 'width: 100%')}>ยืนยันและเข้าสู่ระบบ</button>
      <div style={css('display: flex; flex-direction: column; gap: 6px; font-size: 14px; border-top: 1px solid #e0e0e0; padding-top: 16px')}>
        <span style={css('color: #525252')}>ไม่มีโทรศัพท์อยู่กับตัว?</span>
        <button type="button" onClick={() => { setBackup(backup === null ? '' : null); setError(null); }} style={css(T.linkButton)}>ใช้รหัสสำรอง (backup code) 1 ใน 10 ชุด</button>
        {/* TODO(Phase 2): ส่งรหัสทาง SMS (ไม่อยู่ใน M3) · เบอร์มาจาก app_user.phone_masked — แสดงตามแบบร่าง ยังไม่ทำงาน */}
        <a style={css(T.link)}>ส่งรหัสทาง SMS ไปที่ 08x-xxx-x123</a>
        {/* TODO(Wei): แบบร่างลิงก์ไป ScreenOrgMembers แต่ผู้ใช้ยังไม่ได้เข้าสู่ระบบ — ยังไม่มีช่องทางติดต่อผู้ดูแลองค์กร */}
        <a style={css('text-decoration: none; color: #525252')}>ติดต่อผู้ดูแลองค์กรเพื่อรีเซ็ต 2FA</a>
      </div>
    </form>
  );
}

interface Setup { secret: string; account: string; qr: string }

export function SetupCard({ next, dest }: { next: string | null; dest: string }) {
  const [who, setWho] = useState<{ email: string; company: string | null } | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [after, setAfter] = useState<string>(dest);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // เรียกครั้งเดียว (StrictMode เรียก effect ซ้ำ) — ทุกครั้งที่เรียก id-api สร้างคีย์ใหม่
    if (started.current) return;
    started.current = true;
    void (async () => {
      const p = await call<{ email: string; company: string | null }>('v1/auth/pending?stage=setup');
      if (p.ok) setWho(p.data);
      else {
        // ตั้งค่าจากหน้าโปรไฟล์ (มี session แล้ว ไม่มี pending)
        const me = await call<{ user: { email: string } }>('v1/me');
        if (!me.ok) { setError(p.error); return; }
        setWho({ email: maskEmail(me.data.user.email), company: null });
      }
      const s = await call<Setup>('v1/auth/2fa/setup', 'POST');
      if (s.ok) setSetup(s.data);
      else setError(s.error);
    })();
  }, []);

  async function enable() {
    if (codes) { window.location.assign(after); return; }
    setBusy(true);
    setError(null);
    const r = await call<{ backupCodes: string[]; next: string }>('v1/auth/2fa/enable', 'POST', { code: code.trim() });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCodes(r.data.backupCodes);
    setAfter(r.data.next === 'profile' ? '/me' : nextUrl(r.data.next, { next, dest }));
  }
  function download() {
    if (!codes) return;
    const blob = new Blob([`Innovera ID — รหัสสำรอง (${setup?.account ?? ''})\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'innovera-id-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section style={css(T.card(460))}>
      <div><div style={css(T.sub)}>ครั้งแรก / เปิดใช้งาน</div><h1 style={css(T.h2)}>ตั้งค่า 2FA</h1>
        {/* TODO(Wei): ผู้สมัครใหม่ที่ยังไม่มีบริษัทก็ถูกบังคับ 2FA (id-api requires2fa) แต่แบบร่างมีแต่ข้อความ "บริษัท [ชื่อบริษัท] บังคับใช้…" → ไม่มีบริษัทให้ตัดส่วนชื่อบริษัทออก */}
        <span style={css(T.sub)}>{who?.company ? `${who.company.startsWith('บริษัท') ? who.company : `บริษัท ${who.company}`} บังคับใช้ 2FA ทุกผู้ใช้ — ต้องตั้งค่าก่อนใช้งานต่อ` : 'บังคับใช้ 2FA ทุกผู้ใช้ — ต้องตั้งค่าก่อนใช้งานต่อ'}</span></div>
      <ol style={css('margin: 0; padding: 0 0 0 20px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
        <li>ติดตั้งแอป Authenticator (Google Authenticator, Microsoft Authenticator, 1Password ฯลฯ)</li>
        <li>สแกน QR นี้ หรือพิมพ์คีย์ด้วยตนเอง<div style={css('display: flex; gap: 16px; align-items: center; margin-top: 8px')}>
          {/* QR เป็น SVG ที่ id-api สร้างจาก otpauth URI (ไลบรารี qrcode) — ไม่มีข้อมูลจากผู้ใช้ */}
          <span role="img" aria-label="QR สำหรับแอป Authenticator" style={css('width: 120px; height: 120px; flex: 0 0 auto; display: inline-block')} dangerouslySetInnerHTML={{ __html: setup?.qr ?? '' }} />
          <div style={css(T.sub)}>คีย์: <code style={css(T.mono)}>{setup?.secret ?? ''}</code><br />บัญชี: Innovera ID ({who?.email ?? setup?.account ?? ''})<br />TOTP · SHA-1 · 6 หลัก · 30 วินาที</div></div></li>
        <li>กรอกรหัสจากแอปเพื่อยืนยัน<div style={css('margin-top: 8px')}><label style={css(T.label)}>รหัส 6 หลัก<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/gu, ''))} readOnly={!!codes} style={css(T.input)} /></label></div></li>
        <li>บันทึก<strong>รหัสสำรอง 10 ชุด</strong>ไว้ในที่ปลอดภัย (แสดงครั้งเดียว){codes && <div style={css(T.codesGrid)}>{codes.map((c) => <span key={c}>{c}</span>)}</div>}</li>
      </ol>
      <ErrorText>{error}</ErrorText>
      <div style={css('display: flex; gap: 8px')}>
        <Button kind="secondary" onClick={download}>ดาวน์โหลดรหัสสำรอง</Button>
        {/* TODO(Wei): แบบร่างไม่ได้กำหนดปุ่มหลังเปิดใช้แล้ว (ต้องให้ผู้ใช้เห็นรหัสสำรองก่อนไปต่อ) → เปลี่ยนชื่อเป็น "ดำเนินการต่อ" */}
        <button type="button" onClick={enable} disabled={busy || (!codes && (!setup || code.length !== 6))} style={buttonStyle('primary', 40)}>{codes ? 'ดำเนินการต่อ' : 'เปิดใช้ 2FA'}</button>
      </div>
    </section>
  );
}
