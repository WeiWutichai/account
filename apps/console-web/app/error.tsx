'use client';
// ข้อผิดพลาดจาก /console/v1 (เช่น "เฉพาะทีม Innovera" / "Console ต้องยืนยัน 2FA ทุกครั้งที่เข้าสู่ระบบ") — แบบร่างไม่มีหน้าข้อผิดพลาด
// TODO(Wei): หน้าตาหน้าข้อผิดพลาด/ไม่มีสิทธิ์ของ Console ไม่มีในแบบร่าง
import { css } from '@innovera/ui';

export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={css("padding: 32px; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; color: #161616")}>
      <h1 style={css('margin: 0 0 8px; font-size: 22px; line-height: 30px; font-weight: 600')}>Innovera Console</h1>
      <p role="alert" style={css('margin: 0 0 16px; color: #a2191f')}>{error.message}</p>
      <button type="button" onClick={reset} style={css('height: 40px; padding: 0 16px; border-radius: 4px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d; font-family: inherit; font-size: 14px; cursor: pointer')}>ลองอีกครั้ง</button>
    </main>
  );
}
