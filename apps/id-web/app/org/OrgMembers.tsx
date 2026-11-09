'use client';
// ScreenOrgMembers.dc.html — แท็บ · ตัวกรอง · ตารางสมาชิก (+ คำเชิญที่รอตอบรับ)
import { Button, Tag, css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { call } from '../lib/client';
import { deviceLabel, dm, dmy, lastUsed, maskEmail, maskLocal } from '../lib/fmt';
import { companyRole, ORG_ROLE } from '../lib/labels';
import { ErrorText, T } from '../lib/ui';
import type { OrgOverview } from './data';

type Tab = 'members' | 'roles' | 'policy' | 'log';
const TAB_ON = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; font-family: inherit; font-size: 14px; font-weight: 600';
const TAB_OFF = 'height: 40px; padding: 0 16px; border: 0; background: transparent; font-family: inherit; font-size: 14px; color: #525252';
const FILTER = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 14px';
const TH = 'height: 40px; padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';
const SUB = 'font-size: 13px; color: #525252';
const ROLES = ['owner', 'admin', 'billing_admin', 'member', 'guest'];
const NEUTRAL_TAG = 'display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; background: #e0e0e0; color: #161616; font-size: 13px; font-weight: 500';
const DOT = 'width: 8px; height: 8px; border-radius: 999px; background: currentColor';
const DANGER_LINK = 'text-decoration: none; color: #da1e28';

/** ป้ายเหตุการณ์ในบันทึกการเข้าสู่ระบบ · TODO(Wei): แบบร่างไม่มีเนื้อหาแท็บนี้ */
const EVENT: Record<string, string> = {
  login_ok: 'รหัสผ่านถูกต้อง', login_fail: 'รหัสผ่านผิด', mfa_ok: 'ยืนยัน 2FA สำเร็จ', mfa_fail: 'รหัส 2FA ผิด', locked: 'ล็อกชั่วคราว', logout: 'ออกจากระบบ',
  password_reset_requested: 'ขอตั้งรหัสผ่านใหม่', password_reset: 'ตั้งรหัสผ่านใหม่', refresh_reuse: 'พบการใช้ session ซ้ำ (เพิกถอนแล้ว)', mfa_enabled: 'เปิด 2FA', backup_code_used: 'ใช้รหัสสำรอง',
};

export function OrgTabs({ org, meId, accountingWeb }: { org: OrgOverview; meId: string; accountingWeb: string }) {
  const [tab, setTab] = useState<Tab>('members');
  const count = org.members.length + org.invites.length;
  const tabs: [Tab, string][] = [['members', `สมาชิก (${count})`], ['roles', 'บทบาทองค์กร'], ['policy', 'นโยบายความปลอดภัย'], ['log', 'บันทึกการเข้าสู่ระบบ']];
  return (
    <>
      <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={css(tab === k ? TAB_ON : TAB_OFF)}>{label}</button>)}
      </div>
      {tab === 'members' && <Members org={org} meId={meId} accountingWeb={accountingWeb} />}
      {/* TODO(Wei): แบบร่างไม่มีเนื้อหาของแท็บ "บทบาทองค์กร" — คำอธิบายบทบาทอยู่ในกล่อง "บทบาทระดับองค์กร" ด้านล่างแล้ว */}
      {tab === 'roles' && <p style={css(SUB)}>บทบาทระดับองค์กร (แยกจากบทบาทในบริษัท) — ดูคำอธิบายด้านล่าง</p>}
      {tab === 'policy' && <Policy org={org} />}
      {tab === 'log' && <LoginLog orgId={org.org.id} />}
    </>
  );
}

function Members({ org, meId, accountingWeb }: { org: OrgOverview; meId: string; accountingWeb: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [no2fa, setNo2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const n = org.companies.length;
  const text = q.trim().toLowerCase();
  const ci = org.companies.findIndex((c) => c.id === company);

  const members = org.members.filter((m) => (!text || m.email.includes(text) || m.display_name.toLowerCase().includes(text)) && (!role || m.org_role === role)
    && (ci < 0 || m.companies[ci] !== null) && (!no2fa || !m.mfa_enabled));
  const invites = org.invites.filter((i) => (!text || i.email.includes(text)) && (!role || i.org_role === role) && (!company || i.company_id === company) && !no2fa);

  async function resend(i: OrgOverview['invites'][number]) {
    if (!i.company_id) return;
    setError(null);
    const r = await call('v1/invites', 'POST', { orgId: org.org.id, companyId: i.company_id, email: i.email, role: i.role, kind: i.kind, ...(i.access_until ? { accessUntil: i.access_until } : {}) });
    if (!r.ok) setError(r.error);
    router.refresh();
  }
  async function revoke(id: string) {
    setError(null);
    const r = await call(`v1/invites/${id}`, 'DELETE');
    if (!r.ok) setError(r.error);
    router.refresh();
  }

  return (
    <>
      <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
        <input aria-label="ค้นหาชื่อ / อีเมล" placeholder="ค้นหาชื่อ / อีเมล" value={q} onChange={(e) => setQ(e.target.value)} style={css(`${FILTER}; width: 280px`)} />
        <select aria-label="บริษัท" value={company} onChange={(e) => setCompany(e.target.value)} style={css(FILTER)}><option value="">ทุกบริษัท</option>{org.companies.map((c) => <option key={c.id} value={c.id}>{c.name_th}</option>)}</select>
        <select aria-label="บทบาทองค์กร" value={role} onChange={(e) => setRole(e.target.value)} style={css(FILTER)}><option value="">ทุกบทบาทองค์กร</option>{ROLES.map((r) => <option key={r} value={r}>{ORG_ROLE[r]}</option>)}</select>
        <label style={css('display: flex; align-items: center; gap: 8px')}><input type="checkbox" checked={no2fa} onChange={(e) => setNo2fa(e.target.checked)} /> เฉพาะที่ยังไม่เปิด 2FA</label>
      </div>
      <ErrorText>{error}</ErrorText>
      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; overflow-x: auto')}>
        <table style={css('width: 100%; min-width: 1000px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
          <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css(TH)}>สมาชิก</th><th style={css(TH)}>บทบาทองค์กร</th><th style={css(TH)}>บริษัทที่เข้าถึง · บทบาทในบริษัท</th><th style={css(TH)}>สถานะ</th><th style={css(TH)}>ใช้งานล่าสุด</th><th style={css(TH)}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การกระทำ</span></th></tr></thead>
          <tbody>
            {members.map((m) => {
              const has = m.companies.filter((c) => c !== null).length;
              return (
                <tr key={m.id} style={css('border-top: 1px solid #e0e0e0')}>
                  <td style={css('height: 40px; padding: 0 12px')}><div style={css('font-weight: 500')}>{m.display_name}</div><div style={css(SUB)}>{maskEmail(m.email)}</div></td>
                  <td style={css(TD)}>{ORG_ROLE[m.org_role] ?? m.org_role}</td>
                  <td style={css(TD)}>{has === n && n > 1 ? `ทั้ง ${n} บริษัท` : `${has} บริษัท`}<div style={css(SUB)}>{m.companies.map(companyRole).join(' · ')}</div></td>
                  <td style={css(TD)}>{m.org_role === 'guest'
                    ? <span style={css(NEUTRAL_TAG)}><span style={css(DOT)} />ภายนอก · ไม่นับที่นั่ง</span>
                    : m.mfa_enabled ? <Tag kind="success">2FA ✓</Tag> : <Tag kind="warning">2FA ยังไม่เปิด</Tag>}</td>
                  <td style={css(TD)}>{m.id === meId ? 'ตอนนี้' : lastUsed(m.last_login_at, now, false)}</td>
                  <td style={css(TD)}><a href={`${accountingWeb}/settings/users/${m.id}`} style={css(T.link)}>สิทธิ์ต่อบริษัท</a> · {/* TODO(M7): "ถอดออก" ไปหน้า ScreenRevoke.dc.html (M7) — ยังไม่มี */}<a style={css(DANGER_LINK)}>ถอดออก</a></td>
                </tr>
              );
            })}
            {invites.map((i) => (
              <tr key={i.id} style={css('border-top: 1px solid #e0e0e0')}>
                <td style={css('height: 40px; padding: 0 12px')}><div style={css('font-weight: 500')}>{maskLocal(i.email)}</div><div style={css(SUB)}>— (ยังไม่ตอบรับ)</div></td>
                <td style={css(TD)}>{ORG_ROLE[i.org_role] ?? i.org_role}</td>
                <td style={css(TD)}>{i.company_id ? 1 : 0} บริษัท<div style={css(SUB)}>{companyRole(i.role)} (รอ)</div></td>
                <td style={css(TD)}><Tag kind="info">รอตอบรับ</Tag></td>
                <td style={css(TD)}>เชิญ {dm(i.created_at)} · หมด {dm(i.expires_at)}</td>
                <td style={css('padding: 0 12px; white-space: nowrap')}><Button kind="ghost" size={32} onClick={() => void resend(i)}>ส่งคำเชิญอีกครั้ง</Button> · <button type="button" onClick={() => void revoke(i.id)} style={css(`${T.linkButton}; color: #da1e28`)}>ยกเลิกคำเชิญ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** TODO(Wei): แบบร่างไม่มีเนื้อหาแท็บ "นโยบายความปลอดภัย" — แสดงค่าปัจจุบันอย่างเดียว (แก้นโยบายยังไม่มีแบบ) */
function Policy({ org }: { org: OrgOverview }) {
  const row = 'display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-top: 1px solid #e0e0e0';
  return (
    <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
      <strong>นโยบายความปลอดภัย</strong>
      <div style={css(row)}><span>ยืนยันตัวตน 2 ชั้น (2FA)</span><span style={css('color: #525252')}>{org.org.policy.require_2fa ? 'บังคับทุกผู้ใช้' : 'ไม่บังคับ'}</span></div>
      <div style={css(row)}><span>เซสชันหมดอายุ</span><span style={css('color: #525252')}>{org.org.policy.session_hours} ชม.</span></div>
      <div style={css(row)}><span>SSO (SAML)</span><span style={css('color: #684e00')}>Enterprise เท่านั้น</span></div>
    </section>
  );
}

interface LoginEvent { id: string; at: string; email: string; event: string; user_agent: string | null }

/** TODO(Wei): แบบร่างไม่มีเนื้อหาแท็บ "บันทึกการเข้าสู่ระบบ" — ตารางรูปแบบเดียวกับตารางสมาชิก */
function LoginLog({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<LoginEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void call<LoginEvent[]>(`v1/orgs/${orgId}/login-events`).then((r) => (r.ok ? setRows(r.data) : setError(r.error)));
  }, [orgId]);
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <section style={css('background: #ffffff; border: 1px solid #e0e0e0; overflow-x: auto')}>
        <table style={css('width: 100%; min-width: 1000px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
          <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css(TH)}>เวลา</th><th style={css(TH)}>สมาชิก</th><th style={css(TH)}>เหตุการณ์</th><th style={css(TH)}>อุปกรณ์</th></tr></thead>
          <tbody>
            {(rows ?? []).map((e) => (
              <tr key={e.id} style={css('border-top: 1px solid #e0e0e0')}>
                <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{dmy(e.at)} {new Date(e.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}</td>
                <td style={css(TD)}>{maskEmail(e.email)}</td>
                <td style={css(TD)}>{EVENT[e.event] ?? e.event}</td>
                <td style={css(TD)}>{deviceLabel(e.user_agent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
