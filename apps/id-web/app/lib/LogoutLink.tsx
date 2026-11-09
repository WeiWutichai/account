'use client';
// ออกจากระบบ (หัวหน้า ScreenProfile "ออกจากระบบ" · ScreenInviteAccept "สลับบัญชี") — POST เท่านั้น แล้วไปหน้าเข้าสู่ระบบ
import { css } from '@innovera/ui';
import { call } from './client';

export function LogoutLink({ to, children }: { to: string; children: string }) {
  return (
    <button type="button" onClick={async () => { await call('v1/auth/logout', 'POST'); window.location.assign(to); }}
      style={css('background: none; border: 0; padding: 0; margin: 0; font: inherit; color: #c6c6c6; text-decoration: none; cursor: pointer')}>{children}</button>
  );
}
