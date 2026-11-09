'use client';
// ส่วนที่กดได้ของ ScreenProfile.dc.html — ฟอร์มโปรไฟล์ · รหัสสำรองใหม่ · ออกจากระบบอุปกรณ์
import { Button, buttonStyle, css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { call } from '../lib/client';
import { ErrorText, T } from '../lib/ui';

/** ปุ่มตามแบบร่างที่ยังไม่มีการทำงานใน v1 (Phase 2 / ยังไม่มีข้อมูล) */
export function InertButton({ size, danger, children }: { size: 32 | 40; danger?: boolean; children: ReactNode }) {
  return <Button kind={danger ? 'danger' : 'secondary'} size={size}>{children}</Button>;
}

export function ProfileForm({ user }: { user: { email: string; display_name: string; email_verified_at: string | null; phone_masked: string | null; locale: 'th' | 'en' } }) {
  const router = useRouter();
  const [name, setName] = useState(user.display_name);
  const [locale, setLocale] = useState(user.locale);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call('v1/me/profile', 'PUT', { displayName: name, locale });
    setBusy(false);
    // TODO(Wei): แบบร่างไม่มีข้อความหลังบันทึก
    setMsg(r.ok ? { ok: true, text: 'บันทึกแล้ว' } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <form onSubmit={save} style={css('display: flex; flex-direction: column; gap: 16px')}>
      <div style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
        <label style={css(T.label)}>ชื่อที่แสดง<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={css(T.input)} /></label>
        {/* TODO(Wei): app_user มีชื่อเดียว (display_name — ช่อง "ชื่อ-นามสกุล" ตอนสมัคร) · ยังไม่มีคอลัมน์ชื่อบนเอกสาร/ลายเซ็นแยก (ต้องเพิ่ม migration ใน packages/db) → แสดงอย่างเดียว */}
        <label style={css(T.label)}>ชื่อ-นามสกุล (บนเอกสาร/ลายเซ็น)<input readOnly value={user.display_name} style={css(T.input)} /></label>
        {/* TODO(Wei): เปลี่ยนอีเมลหลัก ("ต้องยืนยันอีเมลใหม่ทั้งสองฝั่ง") ยังไม่มีขั้นตอนใน M3 → แสดงอย่างเดียว */}
        <label style={css(T.label)}>อีเมลหลัก (ใช้เข้าสู่ระบบ)<input readOnly value={user.email} style={css(T.input)} />{user.email_verified_at && <span style={css(T.sub)}>ยืนยันแล้ว ✓ · เปลี่ยนต้องยืนยันอีเมลใหม่ทั้งสองฝั่ง</span>}</label>
        {/* TODO(Phase 2): SMS สำรอง 2FA — app_user.phone_masked (ยังไม่มีขั้นตอนยืนยันเบอร์) */}
        <label style={css(T.label)}>โทรศัพท์ (SMS สำรอง 2FA)<input readOnly value={user.phone_masked ?? ''} style={css(T.input)} />{user.phone_masked && <span style={css(T.sub)}>ยืนยันแล้ว ✓</span>}</label>
        <label style={css(T.label)}>ภาษา<select value={locale} onChange={(e) => setLocale(e.target.value === 'en' ? 'en' : 'th')} style={css(T.input)}><option value="th">ไทย</option><option value="en">English</option></select></label>
        {/* TODO(Wei): ยังไม่มีคอลัมน์เขตเวลา — แบบร่างมีตัวเลือกเดียว */}
        <label style={css(T.label)}>เขตเวลา<select style={css(T.input)}><option>Asia/Bangkok (UTC+7)</option></select></label>
      </div>
      {msg && (msg.ok ? <p role="status" style={css('margin: 0; font-size: 13px; color: #0e6027')}>{msg.text}</p> : <ErrorText>{msg.text}</ErrorText>)}
      <div style={css('display: flex; justify-content: flex-end; gap: 8px')}><button type="submit" disabled={busy} style={buttonStyle('primary', 40)}>บันทึกโปรไฟล์</button></div>
    </form>
  );
}

/** "รหัสสำรองใหม่" — ชุดเดิมใช้ไม่ได้ทันที · แสดงรหัสชุดใหม่ครั้งเดียว (รูปแบบกล่องรหัสจาก ScreenTwoFactor) */
export function BackupCodesButton({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function regen() {
    // TODO(Wei): แบบร่างไม่มีกล่องยืนยันก่อนออกรหัสชุดใหม่
    if (!window.confirm('ออกรหัสสำรองชุดใหม่? รหัสชุดเดิมจะใช้ไม่ได้ทันที')) return;
    const r = await call<{ backupCodes: string[] }>('v1/me/backup-codes', 'POST');
    if (!r.ok) { setError(r.error); return; }
    setCodes(r.data.backupCodes);
    router.refresh();
  }
  return (
    <>
      <Button kind="secondary" size={32} disabled={!enabled} onClick={() => void regen()}>รหัสสำรองใหม่</Button>
      {(codes || error) && (
        <div role="dialog" aria-label="รหัสสำรองชุดใหม่" style={css('position: fixed; inset: 0; background: rgba(22, 22, 22, 0.5); display: flex; align-items: center; justify-content: center; z-index: 10')}>
          <div style={css(T.card(460))}>
            <h2 style={css(T.h2)}>รหัสสำรอง 10 ชุด</h2>
            <ErrorText>{error}</ErrorText>
            {codes && <><span style={css(T.sub)}>บันทึก<strong>รหัสสำรอง 10 ชุด</strong>ไว้ในที่ปลอดภัย (แสดงครั้งเดียว)</span><div style={css(T.codesGrid)}>{codes.map((c) => <span key={c}>{c}</span>)}</div></>}
            <div style={css('display: flex; justify-content: flex-end')}><Button kind="primary" onClick={() => { setCodes(null); setError(null); }}>ปิด</Button></div>
          </div>
        </div>
      )}
    </>
  );
}

export function RevokeSessionButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <Button kind="ghost" size={32} disabled={busy} onClick={async () => { setBusy(true); await call(`v1/me/sessions/${id}`, 'DELETE'); router.refresh(); }}>ออกจากระบบ</Button>;
}

export function RevokeOthersButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  return (
    <button type="button" disabled={disabled} onClick={async () => { await call('v1/me/sessions/revoke-others', 'POST'); router.refresh(); }} style={buttonStyle('danger', 32)}>ออกจากระบบทุกอุปกรณ์อื่น</button>
  );
}
