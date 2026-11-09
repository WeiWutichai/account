// ScreenProfile.dc.html — บัญชีของฉัน (/me)
import { ButtonLink, Tag, css } from '@innovera/ui';
import { dm, deviceLabel, dmy, lastUsed, maskEmail, my } from '../lib/fmt';
import { ACCOUNTING_WEB } from '../lib/id';
import { companyRole, ORG_ROLE } from '../lib/labels';
import { LogoutLink } from '../lib/LogoutLink';
import { idGet } from '../lib/server';
import { IdPage, Phase2, T } from '../lib/ui';
import { BackupCodesButton, InertButton, ProfileForm, RevokeOthersButton, RevokeSessionButton } from './ProfileParts';

export const metadata = { title: 'บัญชีของฉัน — Innovera ID' };

export interface Profile {
  user: { id: string; email: string; display_name: string; email_verified_at: string | null; mfa_enabled: boolean; phone_masked: string | null; locale: 'th' | 'en'; created_at: string };
  passwordChangedAt: string | null; backupCodes: { left: number; issued: number };
  sessions: { id: string; userAgent: string | null; startedAt: string; lastUsedAt: string; current: boolean; trustedUntil: string | null }[];
  orgs: { id: string; name: string; org_role: string; expires_at: string | null; companies: { id: string; name: string; role: string; expiresAt: string | null }[] }[];
}

const NAV = 'display: block; padding: 8px 16px; text-decoration: none; color: #161616';
const SECTION = 'background: #ffffff; border: 1px solid #e0e0e0; padding: 24px; display: flex; flex-direction: column; gap: 12px; font-size: 14px';
const ROW = 'display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid #e0e0e0';
const TH = 'height: 40px; padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';

export default async function ProfilePage() {
  const r = await idGet<Profile>('/v1/me/profile', { self: '/me' });
  if (!r.ok) return <IdPage self="/me" maxWidth={1200}><p role="alert" style={css(T.error)}>{r.error}</p></IdPage>;
  const p = r.data;
  const u = p.user;
  const now = new Date();
  const owned = p.orgs.find((o) => o.org_role === 'owner');
  const right = <span style={css(T.headRight)}>{u.display_name} · {maskEmail(u.email)} · <LogoutLink to="/login">ออกจากระบบ</LogoutLink></span>;

  return (
    <IdPage self="/me" maxWidth={1200} right={right}>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px')}><div><h1 style={css(T.h1)}>บัญชีของฉัน — Innovera ID</h1><span style={css(T.sub)}>ข้อมูลที่นี่ใช้ร่วมทุกแอปและทุกบริษัท · สิทธิ์ในแต่ละบริษัทแก้ที่บริษัทนั้น</span></div><a href={`${ACCOUNTING_WEB}/companies`} style={css('font-size: 14px; text-decoration: none')}>← กลับไปเลือกบริษัท</a></div>
      <div style={css('display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start')}>
        <nav aria-label="บัญชีของฉัน" style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 8px 0; font-size: 14px')}>
          <a href="/me" aria-current="page" style={css('display: block; padding: 8px 16px 8px 13px; text-decoration: none; color: #161616; background: #e0e0e0; border-left: 3px solid #0f62fe; font-weight: 600')}>โปรไฟล์</a>
          <a href="/me#security" style={css(NAV)}>ความปลอดภัย</a>
          <a href="/me#sessions" style={css(NAV)}>อุปกรณ์และเซสชัน</a>
          <a href="/org" style={css(NAV)}>องค์กรและบริษัท</a>
          <a href={`${ACCOUNTING_WEB}/settings/apps`} style={css(NAV)}>แอปที่เชื่อมบัญชี</a>
          <a href="/org/plan" style={css('display: block; padding: 8px 16px; text-decoration: none; color: #525252')}>การสมัครใช้งานของฉัน <Phase2 /></a>
          {/* TODO(Wei): แบบร่างไม่มีหน้า "การแจ้งเตือน" และ "ดาวน์โหลดข้อมูล / ลบบัญชี" (ลิงก์กลับ ScreenProfile) */}
          <a href="/me#notifications" style={css(NAV)}>การแจ้งเตือน</a>
          <div style={css('margin: 8px 16px 0; padding-top: 8px; border-top: 1px solid #e0e0e0')}><a href="/me#data" style={css('display: block; padding: 8px 0; text-decoration: none; color: #da1e28')}>ดาวน์โหลดข้อมูล / ลบบัญชี</a></div>
        </nav>
        <div style={css('display: flex; flex-direction: column; gap: 24px')}>
          <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 24px; display: flex; flex-direction: column; gap: 16px')}>
            <div style={css('display: flex; gap: 16px; align-items: center')}>
              <span aria-hidden="true" style={css('width: 64px; height: 64px; border-radius: 999px; background: #d0e2ff; color: #0043ce; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 24px')}>{u.display_name.slice(0, 1).toUpperCase()}</span>
              <div><div style={css('font-weight: 600; font-size: 16px')}>{u.display_name}</div><div style={css(T.sub)}>Innovera ID ตั้งแต่ {my(u.created_at)}{owned ? ` · เจ้าของ ${owned.name}` : ''}</div></div>
              {/* TODO(Wei): ยังไม่มีที่เก็บรูปโปรไฟล์ (ไม่มีคอลัมน์/ที่เก็บไฟล์ใน M3) */}
              <div style={css('margin-left: auto')}><InertButton size={32}>เปลี่ยนรูป</InertButton></div>
            </div>
            <ProfileForm user={u} />
          </section>
          <section id="security" style={css(SECTION)}>
            <strong style={css('font-size: 15px')}>ความปลอดภัย</strong>
            <div style={css(ROW)}><div>รหัสผ่าน<div style={css(T.sub)}>เปลี่ยนล่าสุด {p.passwordChangedAt ? dmy(p.passwordChangedAt) : '—'}</div></div><ButtonLink href="/password/reset" kind="secondary" size={32}>เปลี่ยนรหัสผ่าน</ButtonLink></div>
            <div style={css(ROW)}>
              <div>ยืนยันตัวตน 2 ชั้น (TOTP) {u.mfa_enabled ? <Tag kind="success">เปิดอยู่</Tag> : <Tag kind="warning">ยังไม่เปิด</Tag>}<div style={css(T.sub)}>Authenticator · รหัสสำรองเหลือ {p.backupCodes.left}/{p.backupCodes.issued || 10}</div></div>
              <div style={css('display: flex; gap: 8px')}>
                <BackupCodesButton enabled={u.mfa_enabled} />
                {/* TODO(Wei): แบบร่างไม่มีหน้าจัดการ 2FA ที่เปิดอยู่แล้ว (ปิด/รีเซ็ตแอป) → ลิงก์ไป ScreenTwoFactor ส่วนตั้งค่า */}
                <ButtonLink href="/2fa?stage=setup&next=%2Fme" kind="secondary" size={32}>จัดการ</ButtonLink>
              </div>
            </div>
            {/* TODO(Phase 2): Passkey / Security key — แสดงตามแบบร่าง ยังไม่ทำงาน */}
            <div style={css(ROW)}><div>Passkey / Security key<div style={css(T.sub)}>ยังไม่ได้ตั้งค่า · ใช้แทนรหัสผ่าน + 2FA ได้</div></div><InertButton size={32}>เพิ่ม passkey</InertButton></div>
            {/* TODO(Phase 2): SSO Google Workspace — ยังไม่มีการเชื่อม SSO ใน v1 · แบบร่างมีแต่สถานะ "เชื่อมแล้ว" → แสดง "ยังไม่ได้ตั้งค่า" (คำจากแถว Passkey) · TODO(Wei) ยืนยันข้อความ */}
            <div style={css(ROW)}><div>เข้าสู่ระบบด้วย Google Workspace<div style={css(T.sub)}>ยังไม่ได้ตั้งค่า</div></div><InertButton size={32} danger>ยกเลิกการเชื่อม</InertButton></div>
          </section>
          <section id="sessions" style={css('background: #ffffff; border: 1px solid #e0e0e0; overflow-x: auto')}>
            <div style={css('padding: 12px 24px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center')}><strong style={css('font-size: 15px')}>อุปกรณ์และเซสชันที่เข้าสู่ระบบอยู่ ({p.sessions.length})</strong><RevokeOthersButton disabled={p.sessions.length < 2} /></div>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css(TH)}>อุปกรณ์</th><th style={css(TH)}>ตำแหน่ง (โดยประมาณ)</th><th style={css(TH)}>แอป</th><th style={css(TH)}>ใช้ล่าสุด</th><th style={css(TH)}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การกระทำ</span></th></tr></thead>
              <tbody>
                {p.sessions.map((s) => (
                  <tr key={s.id} style={css('border-top: 1px solid #e0e0e0')}>
                    <td style={css('height: 40px; padding: 0 12px')}>{s.current ? <><strong>{deviceLabel(s.userAgent)}</strong> <span style={css('color: #0e6027; font-size: 13px')}>อุปกรณ์นี้</span></> : deviceLabel(s.userAgent)}
                      {s.trustedUntil && <div style={css(T.sub)}>เชื่อถือ 30 วัน · หมด {dm(s.trustedUntil)}</div>}</td>
                    {/* TODO(Wei): id-api เก็บแค่ hash ของ IP (ไม่มีข้อมูลตำแหน่ง) → แสดง "—" */}
                    <td style={css(TD)}>—</td>
                    {/* v1 มีแอปเดียวที่ใช้ Innovera ID (TMS/OAuth client มาใน M7) */}
                    <td style={css(TD)}>ระบบบัญชี</td>
                    <td style={css(TD)}>{s.current ? 'ตอนนี้' : lastUsed(s.lastUsedAt, now)}</td>
                    <td style={css(TD)}>{!s.current && <RevokeSessionButton id={s.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section style={css(SECTION)}>
            <strong style={css('font-size: 15px')}>องค์กรและบริษัทที่เข้าถึง</strong>
            {p.orgs.map((o) => {
              const admin = o.org_role === 'owner' || o.org_role === 'admin';
              const until = o.expires_at ?? o.companies.find((c) => c.expiresAt)?.expiresAt ?? null;
              const label = o.org_role === 'guest'
                ? `· ${[...new Set(o.companies.map((c) => companyRole(c.role)))].join(', ') || ORG_ROLE.guest} ใน ${o.companies.length} บริษัท${until ? ` · ถึง ${dmy(until)}` : ''}`
                : `· ${ORG_ROLE[o.org_role] ?? o.org_role} · ${o.companies.length} บริษัท`;
              return (
                <div key={o.id} style={css('display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #e0e0e0')}>
                  <span>{o.name} <span style={css('color: #525252')}>{label}</span></span>
                  {admin
                    ? <a href={`/org?id=${o.id}`} style={css(T.link)}>จัดการสมาชิกองค์กร</a>
                    // TODO(Wei): ยังไม่มี endpoint/หน้ายืนยัน "ออกจากองค์กร" (แบบร่างลิงก์ไป ScreenOrgMembers)
                    : <a style={css('text-decoration: none; color: #da1e28')}>ออกจากองค์กร</a>}
                </div>
              );
            })}
          </section>
          <section style={css('border: 1px dashed #a56eff; background: #ffffff; padding: 16px 24px; font-size: 13px; color: #525252; display: flex; flex-direction: column; gap: 6px')}><span><Phase2>Phase 2 · Subscription</Phase2> <strong style={css('color: #161616')}>&quot;การสมัครใช้งานของฉัน&quot;</strong></span><span>สำหรับผู้ใช้ที่เป็นผู้ชำระเงิน (billing contact) ขององค์กร: แผนปัจจุบัน สถานะ (trialing/active/past_due) วันต่ออายุ ใบแจ้งหนี้ และปุ่มอัปเกรด — v1 แสดงลิงก์ไปหน้า <a href="/org/plan" style={css(T.link)}>แผนและการเรียกเก็บเงิน</a> เท่านั้น · บทบาท <code>billing_admin</code> เตรียมไว้ในระบบสิทธิ์องค์กรแล้ว</span></section>
        </div>
      </div>
    </IdPage>
  );
}
