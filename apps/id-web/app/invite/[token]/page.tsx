// ScreenInviteAccept.dc.html — รับคำเชิญเข้าบริษัท (/invite/<token>) · ดูได้โดยไม่ต้องเข้าสู่ระบบ
import { css } from '@innovera/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { dmy, daysLeft, maskLocal } from '../../lib/fmt';
import { ACCOUNTING_WEB } from '../../lib/id';
import { LogoutLink } from '../../lib/LogoutLink';
import { idGet } from '../../lib/server';
import { IdPage, T } from '../../lib/ui';
import { InviteActions, InviteExpired } from './InviteActions';

export const metadata = { title: 'รับคำเชิญเข้าบริษัท — Innovera ID' };

interface Invite {
  status: 'ok' | 'expired' | 'revoked' | 'accepted' | 'declined'; email: string; role: string; roleLabel: string; kind: 'member' | 'auditor'; orgName: string; companyName: string | null;
  invitedBy: { name: string | null; email: string | null }; planName: string | null; expiresAt: string; policy: { require_2fa: boolean; session_hours: number };
  hasAccount: boolean; emailMatches: boolean | null; viewer: string | null;
}

/** คำอธิบายบทบาท — แบบร่างมีเฉพาะ Accountant · TODO(Wei): คำอธิบายของบทบาทอื่น */
const ROLE_NOTE: Record<string, string> = { accountant: 'สร้าง/ผ่านรายการเอกสาร ดูรายงาน · ไม่มีสิทธิ์จ่ายเงินและตั้งค่า' };
/** TODO(Wei): แบบร่างบอกแค่ "แสดงข้อความและปุ่ม "ขอคำเชิญใหม่"" — ข้อความแต่ละกรณียังไม่ได้กำหนด */
const STATUS_TEXT: Record<Exclude<Invite['status'], 'ok'>, string> = { expired: 'ลิงก์หมดอายุ', revoked: 'คำเชิญถูกเพิกถอน', accepted: 'คำเชิญนี้ถูกใช้แล้ว', declined: 'ปฏิเสธคำเชิญนี้แล้ว' };

const TD = 'height: 36px; color: #525252';
const TR = 'border-top: 1px solid #e0e0e0';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const self = `/invite/${encodeURIComponent(token)}`;
  const r = await idGet<Invite>(`/v1/invites/by-token/${encodeURIComponent(token)}`);
  // access token หมดอายุแต่ยังมี refresh → ต่อ session ก่อน เพื่อรู้ว่าเข้าสู่ระบบด้วยอีเมลไหน
  if (r.ok && !r.data.viewer && /(?:^|;\s*)inn_rt=/u.test((await headers()).get('cookie') ?? '')) redirect(`/refresh?next=${encodeURIComponent(self)}`);
  const inv = r.ok ? r.data : null;
  const right = inv?.viewer
    ? <span style={css(T.headRight)}>{maskLocal(inv.viewer)} · <LogoutLink to={`/login?next=${encodeURIComponent(self)}`}>สลับบัญชี</LogoutLink></span>
    : <a href={`/login?next=${encodeURIComponent(self)}`} style={css(T.headLink)}>เข้าสู่ระบบ</a>;
  const now = new Date();

  return (
    <IdPage self={self} maxWidth={960} right={right}>
      <section style={css(T.card(560))}>
        {!inv ? (
          <div><h1 style={css('margin: 0; font-size: 20px; line-height: 28px; font-weight: 600')}>{r.ok ? '' : r.error}</h1></div>
        ) : (
          <>
            <div style={css('display: flex; gap: 12px; align-items: center')}>
              {/* TODO(Wei): แบบร่างใช้อักษรย่อ "IV" — ใช้ 2 ตัวแรกของชื่อองค์กร */}
              <span aria-hidden="true" style={css('width: 48px; height: 48px; background: #e0e0e0; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px')}>{inv.orgName.slice(0, 2).toUpperCase()}</span>
              <div><div style={css(T.sub)}>คำเชิญจาก {inv.invitedBy.name ?? '—'} · {inv.invitedBy.email ? maskLocal(inv.invitedBy.email) : '—'}</div><h1 style={css('margin: 0; font-size: 20px; line-height: 28px; font-weight: 600')}>เข้าร่วม {inv.companyName ?? inv.orgName}</h1></div>
            </div>
            <table style={css('border-collapse: collapse; font-size: 14px; width: 100%')}><tbody>
              <tr style={css(TR)}><td style={css(`${TD}; width: 40%`)}>องค์กร</td><td>{inv.orgName}{inv.planName ? ` · แผน ${inv.planName}` : ''}</td></tr>
              <tr style={css(TR)}><td style={css(TD)}>แอป</td><td>ระบบบัญชี AccountSystem</td></tr>
              <tr style={css(TR)}><td style={css(TD)}>บทบาทที่จะได้รับ</td><td><strong>{inv.roleLabel}</strong>{ROLE_NOTE[inv.role] ? ` — ${ROLE_NOTE[inv.role]}` : ''}</td></tr>
              <tr style={css(TR)}><td style={css(TD)}>เชิญถึง</td><td>{inv.email}{' '}
                {inv.emailMatches === true && <span style={css('color: #0e6027')}>· ตรงกับบัญชีที่เข้าสู่ระบบอยู่ ✓</span>}
                {/* TODO(Wei): ข้อความกรณีอีเมลไม่ตรง — แบบร่างบอก "แจ้งว่าไม่ตรง · ให้สลับบัญชี" */}
                {inv.emailMatches === false && <span style={css('color: #da1e28')}>· ไม่ตรงกับบัญชีที่เข้าสู่ระบบอยู่ — สลับบัญชี</span>}</td></tr>
              <tr style={css(TR)}><td style={css(TD)}>ข้อกำหนดของบริษัท</td><td>{inv.policy.require_2fa ? 'บังคับ 2FA · ' : ''}เซสชันหมดอายุ {inv.policy.session_hours} ชม. · ข้อมูลลูกค้าอยู่ภายใต้ PDPA ของบริษัทนี้</td></tr>
              <tr style={css(`${TR}; border-bottom: 1px solid #e0e0e0`)}><td style={css(TD)}>ลิงก์หมดอายุ</td><td>{dmy(inv.expiresAt)} (อีก {daysLeft(inv.expiresAt, now)} วัน) · ใช้ได้ครั้งเดียว</td></tr>
            </tbody></table>
            {inv.status === 'ok'
              ? <InviteActions token={token} self={self} loggedIn={!!inv.viewer} hasAccount={inv.hasAccount} email={inv.email} done={`${ACCOUNTING_WEB}/companies`} />
              : <InviteExpired text={STATUS_TEXT[inv.status]} inviter={inv.invitedBy.email} />}
            <div style={css('font-size: 13px; color: #525252; border-top: 1px solid #e0e0e0; padding-top: 16px')}>เมื่อยอมรับ บริษัทนี้จะปรากฏในหน้าเลือกบริษัทของคุณ · ผู้เชิญและเจ้าของบริษัทได้รับแจ้ง · ที่นั่งในแผนถูกใช้ 1 ที่ (ผู้สอบบัญชีไม่นับ) · เจ้าของบริษัทเพิกถอนได้ทุกเมื่อ</div>
          </>
        )}
      </section>
      <section style={css('width: 100%; max-width: 560px; margin: 0 auto; border: 1px solid #e0e0e0; background: #ffffff; padding: 16px 24px; font-size: 14px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box')}>
        <strong>กรณีอื่นของลิงก์คำเชิญ</strong>
        <div style={css('display: flex; justify-content: space-between; gap: 12px; color: #525252')}><span>ยังไม่มี Innovera ID</span><span>พาไปสมัครด้วยอีเมลที่ถูกเชิญ (ล็อกช่องอีเมล)</span></div>
        <div style={css('display: flex; justify-content: space-between; gap: 12px; color: #525252')}><span>เข้าสู่ระบบคนละอีเมล</span><span>แจ้งว่าไม่ตรง · ให้สลับบัญชี</span></div>
        <div style={css('display: flex; justify-content: space-between; gap: 12px; color: #525252')}><span>ที่นั่งเต็ม</span><span><span style={css(T.phase2)}>Phase 2</span> ผู้เชิญได้รับแจ้งให้เพิ่มที่นั่ง · คำเชิญรอ (pending) จนกว่าจะเพิ่ม</span></div>
        <div style={css('display: flex; justify-content: space-between; gap: 12px; color: #525252')}><span>ลิงก์หมดอายุ / ถูกเพิกถอน</span><span>แสดงข้อความและปุ่ม &quot;ขอคำเชิญใหม่&quot;</span></div>
      </section>
    </IdPage>
  );
}
