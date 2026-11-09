'use client';
// ScreenSignup.dc.html — การ์ด "สร้างบัญชี Innovera ID"
import { Button, buttonStyle, css } from '@innovera/ui';
import { useState, type FormEvent } from 'react';
import { call, nextUrl } from '../lib/client';
import { ErrorText, OrDivider, T, withNext } from '../lib/ui';

/** แถบความแข็งแรงรหัสผ่าน 4 ช่อง (แบบร่างแสดง 3/4 สีเขียว) — ตัวตรวจจริงอยู่ที่ id-api (12 ตัวอักษร + รายการรหัสที่รั่วไหล)
 *  TODO(Wei): แบบร่างไม่ได้กำหนดเกณฑ์/สีของแต่ละระดับ → นับ: ยาว ≥12 · ≥16 · มีตัวอักษรหลายชนิด · ≥20 */
function strength(pw: string): number {
  if (!pw) return 0;
  const kinds = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((r) => r.test(pw)).length;
  return [pw.length >= 12, pw.length >= 16, kinds >= 3, pw.length >= 20].filter(Boolean).length;
}

export function SignupForm({ next, dest, lockedEmail }: { next: string | null; dest: string; lockedEmail: string | null }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(lockedEmail ?? '');
  const [password, setPassword] = useState('');
  // PDPA: ความยินยอมต้องติ๊กเอง — แบบร่างแสดงสถานะที่กรอกแล้ว (ติ๊กไว้) · TODO(Wei): ยืนยันว่าค่าเริ่มต้นไม่ติ๊ก
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = strength(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call<{ next: string }>('v1/auth/signup', 'POST', { name, email, password, acceptTerms: terms, marketing });
    if (!r.ok) { setError(r.error); setBusy(false); return; }
    window.location.assign(nextUrl(r.data.next, { next, dest }));
  }

  return (
    <form onSubmit={submit} style={css(T.card(440))}>
      <div><h1 style={css(T.h1)}>สร้างบัญชี Innovera ID</h1><span style={css(T.sub)}>ใช้บัญชีเดียวกับทุกแอป Innovera (ระบบบัญชี, TMS และแอปอื่นในอนาคต) · ทดลองใช้ฟรี 30 วัน ไม่ต้องใส่บัตร</span></div>
      <label style={css(T.label)}>ชื่อ-นามสกุล<input name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} style={css(T.input)} /></label>
      <label style={css(T.label)}>อีเมลที่ใช้ทำงาน<input type="email" name="email" autoComplete="email" required readOnly={!!lockedEmail} value={email} onChange={(e) => setEmail(e.target.value)} style={css(T.input)} /><span style={css(T.sub)}>จะส่งรหัสยืนยัน 6 หลักไปที่อีเมลนี้</span></label>
      <label style={css(T.label)}>รหัสผ่าน<input type="password" name="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} style={css(T.input)} /><span style={css(T.sub)}>อย่างน้อย 12 ตัวอักษร · ระบบตรวจกับรายการรหัสผ่านที่รั่วไหล</span></label>
      <div aria-hidden="true" style={css('display: flex; gap: 4px; height: 4px')}>{[0, 1, 2, 3].map((i) => <span key={i} style={css(`flex: 1; background: ${i < s ? '#0e6027' : '#e0e0e0'}`)} />)}</div>
      {/* TODO(Wei): ยังไม่มีหน้าเงื่อนไขการใช้งาน/นโยบายความเป็นส่วนตัว — แบบร่างลิงก์กลับหน้าเดิม */}
      <label style={css(T.check)}><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={css(T.checkBox)} /> ยอมรับ<a href="/signup" style={css(T.link)}>เงื่อนไขการใช้งาน</a>และ<a href="/signup" style={css(T.link)}>นโยบายความเป็นส่วนตัว</a> (PDPA) · ข้อมูลเก็บในประเทศไทย</label>
      <label style={css(T.check)}><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} style={css(T.checkBox)} /> รับข่าวสารผลิตภัณฑ์ (ยกเลิกได้ทุกเมื่อ)</label>
      <ErrorText>{error}</ErrorText>
      <button type="submit" disabled={busy} style={buttonStyle('primary', 40, false, 'width: 100%')}>สร้างบัญชีและส่งรหัสยืนยัน</button>
      <OrDivider />
      {/* TODO(Phase 2): สมัครด้วย SSO — แสดงตามแบบร่าง ยังไม่ทำงาน */}
      <Button kind="secondary" extra="width: 100%">สมัครด้วย Google Workspace</Button>
      <Button kind="secondary" extra="width: 100%">สมัครด้วย Microsoft 365</Button>
      {/* TODO(Wei): "เปิดลิงก์คำเชิญ" ไม่มีปลายทาง (ลิงก์อยู่ในอีเมล) — ScreenSignup.dc.html ลิงก์ไป ScreenInviteAccept */}
      <div style={css('font-size: 13px; color: #525252; border-top: 1px solid #e0e0e0; padding-top: 16px')}>มีบัญชีแล้ว? <a href={withNext('/login', next)} style={css(T.link)}>เข้าสู่ระบบ</a> · ได้รับคำเชิญจากบริษัท? <a style={css(T.link)}>เปิดลิงก์คำเชิญ</a> แล้วระบบจะพาสมัครด้วยอีเมลที่ถูกเชิญ</div>
    </form>
  );
}
