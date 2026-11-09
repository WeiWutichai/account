'use client';
// ScreenInviteAccept.dc.html — ปุ่ม "ปฏิเสธคำเชิญ" / "ยอมรับและเข้าร่วม" · ยังไม่เข้าสู่ระบบ: มีบัญชี → เข้าสู่ระบบ · ไม่มีบัญชี → สมัครด้วยอีเมลที่ถูกเชิญ (ล็อกช่องอีเมล)
import { buttonStyle, css } from '@innovera/ui';
import { useState } from 'react';
import { call } from '../../lib/client';
import { ErrorText } from '../../lib/ui';

export function InviteActions({ token, self, loggedIn, hasAccount, email, done }: { token: string; self: string; loggedIn: boolean; hasAccount: boolean; email: string; done: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enter = hasAccount ? `/login?next=${encodeURIComponent(self)}` : `/signup?email=${encodeURIComponent(email)}&next=${encodeURIComponent(self)}`;

  async function act(kind: 'accept' | 'decline') {
    if (!loggedIn) { window.location.assign(enter); return; }
    setBusy(true);
    setError(null);
    const r = await call(`v1/invites/by-token/${encodeURIComponent(token)}/${kind}`, 'POST');
    if (!r.ok) { setError(r.error); setBusy(false); return; }
    // TODO(Wei): แบบร่างไม่ได้กำหนดหน้าหลังปฏิเสธ → กลับไปหน้าเลือกบริษัทเหมือนกรณียอมรับ
    window.location.assign(done);
  }

  return (
    <>
      <ErrorText>{error}</ErrorText>
      <div style={css('display: flex; gap: 8px')}>
        <button type="button" disabled={busy} onClick={() => void act('decline')} style={buttonStyle('secondary', 40, false, 'flex: 1')}>ปฏิเสธคำเชิญ</button>
        <button type="button" disabled={busy} onClick={() => void act('accept')} style={buttonStyle('primary', 40, false, 'flex: 2')}>ยอมรับและเข้าร่วม</button>
      </div>
    </>
  );
}

/** ลิงก์หมดอายุ / ถูกเพิกถอน: ข้อความ + ปุ่ม "ขอคำเชิญใหม่" (เปิดอีเมลถึงผู้เชิญ) */
export function InviteExpired({ text, inviter }: { text: string; inviter: string | null }) {
  return (
    <>
      <p role="alert" style={css('margin: 0; font-size: 14px; color: #da1e28')}>{text}</p>
      {inviter
        ? <a href={`mailto:${inviter}?subject=${encodeURIComponent('ขอคำเชิญใหม่ — Innovera')}`} style={buttonStyle('primary', 40, false, 'text-decoration: none; width: 100%')}>ขอคำเชิญใหม่</a>
        : <button type="button" disabled style={buttonStyle('primary', 40, true, 'width: 100%')}>ขอคำเชิญใหม่</button>}
    </>
  );
}
