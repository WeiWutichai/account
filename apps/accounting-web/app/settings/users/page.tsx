// G2 ผู้ใช้และสิทธิ์ — design/project/ScreenUsers.dc.html (ข้อมูลจาก Innovera ID: id-api /v1/companies/:id/users)
import { COMPANY_ROLE_LABEL, COMPANY_ROLES } from '@innovera/auth';
import { css, href, S, thaiDate } from '@innovera/ui';
import { bkkThaiDate, maskEmail, planLabel } from '../../lib/id';
import { Shell } from '../../lib/shell';
import { lastUsedText, limitText, loadUsers, matrix, MATRIX_ROLES, roleLabel, scopeText } from './data';
import { UsersView, type InviteRow, type UserRow } from './view';

export default async function UsersPage() {
  const { data, me } = await loadUsers();
  const rows: UserRow[] = data.users.map((u) => {
    const guest = u.org_role === 'guest';
    const sub = [maskEmail(u.email), ...(u.id === me.id ? ['Innovera ID'] : []), ...(guest ? ['ภายนอก'] : []), ...(u.expires_at ? [`หมดอายุ ${thaiDate(u.expires_at.slice(0, 10))}`] : [])].join(' · ');
    return {
      id: u.id, name: `${u.display_name}${u.org_role === 'owner' && u.company_role === 'owner' ? ' (เจ้าของ)' : ''}`, sub,
      role: roleLabel(u.company_role), scope: scopeText(u), limit: limitText(u), mfa: u.mfa_enabled, lastUsed: lastUsedText(u.last_login_at, u.id === me.id),
      action: u.company_role === 'owner' || u.id === me.id ? 'none' : guest || u.company_role === 'auditor' ? 'revoke' : 'edit', muted: guest,
    };
  });
  const invites: InviteRow[] = data.invites.map((i) => ({ id: i.id, email: i.email, role: roleLabel(i.role), invited: bkkThaiDate(i.created_at).slice(0, 5), expires: bkkThaiDate(i.expires_at).slice(0, 5) }));
  // ตัวเลือกบทบาทของคำเชิญ: ลำดับตามตัวเลือกใน ScreenUserEdit (ไม่มี Owner · กำหนดเองทำที่หน้าแก้ไข)
  const roleOptions = (['ar_clerk', 'accountant', 'accounting_manager', 'petty_cash_holder', 'viewer', 'auditor'] as const)
    .filter((r) => COMPANY_ROLES.includes(r)).map((r) => ({ value: r, label: COMPANY_ROLE_LABEL[r] }));
  const seats = `ใช้ ${data.seats.used} จาก ${data.seats.limit ?? '—'} ที่นั่ง (แผน ${planLabel(data.seats.plan)})`;
  return (
    <Shell active="users">
      <header style={css(S.topbar)}><span style={css(S.crumb)}>ตั้งค่า / ผู้ใช้และสิทธิ์</span><span style={css('color: #525252')}>{seats}</span></header>
      <div style={css(S.content)}>
        <UsersView
          orgId={data.orgId} rows={rows} invites={invites} roleOptions={roleOptions} orgMembersHref={href('orgMembers')}
          matrixHeads={MATRIX_ROLES.map((r) => r.head)} matrix={matrix()}
        />
      </div>
    </Shell>
  );
}
