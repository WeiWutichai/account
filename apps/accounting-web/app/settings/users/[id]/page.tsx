// G2 แก้ไขผู้ใช้และสิทธิ์ — design/project/ScreenUserEdit.dc.html
// TODO(Wei): แบบร่างนี้ติ๊กค่าตั้งต้นของ AR Clerk ต่างจากเมทริกซ์ย่อใน ScreenUsers.dc.html (เช่น แถวเอกสารซื้อ ✓ ทั้งที่เมทริกซ์ให้ AR Clerk "—", อนุมัติจ่าย ≤ 200,000, บันทึกรายวัน JV)
//   → ค่าตั้งต้นยึด ROLE_DEFAULTS ใน packages/auth/src/roles.ts (ตามเมทริกซ์) · รอ Wei ยืนยัน
import { COMPANY_ROLE_LABEL, effectivePermissions, LIMITS, ROLE_DEFAULTS, type CompanyRole } from '@innovera/auth';
import { css, href, S, Tag, thaiDate } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { maskEmail } from '../../../lib/id';
import { Shell } from '../../../lib/shell';
import { loadUsers, roleLabel, SCOPES } from '../data';
import { EditForm } from './form';

// ลำดับตัวเลือก "บทบาทในบริษัทนี้" ตามแบบร่าง (Owner แสดงเฉพาะเมื่อผู้ใช้นี้เป็น Owner อยู่แล้ว)
const ROLE_ORDER: CompanyRole[] = ['ar_clerk', 'accountant', 'accounting_manager', 'petty_cash_holder', 'viewer', 'auditor', 'custom'];

export default async function UserEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await loadUsers();
  const u = data.users.find((x) => x.id === id);
  if (!u) notFound();
  const roles = (u.company_role === 'owner' ? (['owner', ...ROLE_ORDER] as CompanyRole[]) : ROLE_ORDER).map((r) => ({ value: r, label: COMPANY_ROLE_LABEL[r] }));
  return (
    <Shell active="users">
      <header style={css(S.topbar)}>
        <span style={css(S.crumb)}><a href={href('users')} style={css('text-decoration: none')}>ผู้ใช้และสิทธิ์</a> / {u.display_name} / แก้ไข</span>
        {u.mfa_enabled ? <Tag kind="success">ใช้งานอยู่</Tag> : <Tag kind="warning">ใช้งานอยู่ · 2FA ยังไม่เปิด</Tag>}
      </header>
      <EditForm
        user={{ id: u.id, name: u.display_name, who: `${u.display_name} · ${maskEmail(u.email)}`, mfa: u.mfa_enabled }}
        initial={{
          role: u.company_role, scope: u.scope, // ช่องว่าง = ไม่จำกัด (id-api รับ null/ว่าง)
          approvalLimit: u.approval_limit ?? (u.effective.approve_pay.post ? '' : '0.00'),
          expires: u.expires_at ? thaiDate(u.expires_at.slice(0, 10)) : 'ไม่จำกัด', require2fa: u.require_2fa,
          perms: effectivePermissions(u.company_role, u.permissions),
        }}
        roles={roles} scopes={SCOPES} defaults={ROLE_DEFAULTS} limits={LIMITS}
        others={u.otherCompanies.map((o) => ({ id: o.id, name: o.name_th, role: roleLabel(o.company_role) }))}
        usersHref={href('users')}
      />
    </Shell>
  );
}
