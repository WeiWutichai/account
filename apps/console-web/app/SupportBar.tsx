'use client';
// แถบสีแดงบนทุกหน้าระหว่างเซสชันเข้าดู — ConsoleSupport.dc.html ขั้นที่ 3: แถบสีแดงบนทุกหน้า "กำลังดูในฐานะ Innovera Support"
// TODO(Wei): แบบร่างระบุแค่ข้อความ ไม่มีหน้าตาแถบ (สี/ความสูง/ตำแหน่ง/เวลาคงเหลือ) — ใช้สีอันตราย #da1e28 ของระบบออกแบบ
import { css } from '@innovera/ui';
import { useEffect, useState } from 'react';
import { ACCESS_EVENT, activeAccess, loadAccess, type AccessState } from './lib/client';

const left = (endsAt: string, now: number) => {
  const s = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function SupportBar() {
  const [a, setA] = useState<AccessState | undefined>();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const read = () => { setNow(Date.now()); setA(activeAccess(loadAccess())); };
    read();
    const t = window.setInterval(read, 1000);
    window.addEventListener(ACCESS_EVENT, read);
    window.addEventListener('storage', read);
    return () => { window.clearInterval(t); window.removeEventListener(ACCESS_EVENT, read); window.removeEventListener('storage', read); };
  }, []);
  if (!a?.endsAt) return null;
  return (
    <div role="status" style={css('display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; padding: 0 32px; background: #da1e28; color: #ffffff; font-size: 14px; font-weight: 600')}>
      <span>กำลังดูในฐานะ Innovera Support · {a.org} · อ่านอย่างเดียว</span>
      <span style={css('font-variant-numeric: tabular-nums')}>เหลือ {left(a.endsAt, now)} · <a href="/support" style={css('color: #ffffff')}>Support</a></span>
    </div>
  );
}
