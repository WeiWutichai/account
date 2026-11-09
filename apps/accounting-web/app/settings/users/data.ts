// ข้อมูลผู้ใช้ของบริษัทจาก id-api + การแปลงเป็นข้อความตามแบบร่าง ScreenUsers / ScreenUserEdit (ฝั่ง server เท่านั้น)
import 'server-only';
import { AREAS, COMPANY_ROLE_LABEL, LIMITS, ROLE_DEFAULTS, type Area, type CompanyRole, type Grant, type Permissions } from '@innovera/auth';
import { money, thaiDate } from '@innovera/ui';
import { bkkDay, companyId, idApi, type Me } from '../../lib/id';

export interface CompanyUser {
  id: string; email: string; display_name: string; mfa_enabled: boolean; last_login_at: string | null;
  company_role: CompanyRole; scope: string; approval_limit: string | null; expires_at: string | null;
  permissions: Partial<Record<Area, Grant>> | null; org_role: string | null; effective: Permissions;
  otherCompanies: { user_id: string; id: string; name_th: string; company_role: CompanyRole }[];
  require_2fa: boolean; // company_membership.require_2fa (id-api companyUsers)
}
export interface Invite { id: string; email: string; role: CompanyRole; kind: string; created_at: string; expires_at: string }
export interface UsersPayload { orgId: string; myRole: CompanyRole; seats: { used: number; limit: number | null; plan: string | null }; users: CompanyUser[]; invites: Invite[] }

export async function loadUsers(): Promise<{ data: UsersPayload; me: Me['user']; companyId: string }> {
  const co = await companyId();
  if (!co) throw new Error('กรุณาเลือกบริษัท');
  const [data, me] = await Promise.all([idApi<UsersPayload>(`/v1/companies/${encodeURIComponent(co)}/users`), idApi<Me>('/v1/me')]);
  return { data, me: me.user, companyId: co };
}

export const roleLabel = (r: string): string => COMPANY_ROLE_LABEL[r as CompanyRole] ?? r;

/** ขอบเขตข้อมูล (มิติ) — ค่าในฐาน ↔ ตัวเลือกของ ScreenUserEdit · TODO(Wei): ตัวเลือกสาขา/โครงการในแบบร่างเป็นตัวอย่าง ควรมาจากมิติจริงของบริษัท */
export const SCOPES: { value: string; label: string }[] = [
  { value: 'all', label: 'ทั้งบริษัท' },
  { value: 'branch:bkk', label: 'เฉพาะสาขากรุงเทพ' },
  { value: 'project:own', label: 'เฉพาะโครงการที่รับผิดชอบ' },
];

/** คอลัมน์ "ขอบเขต" ใน ScreenUsers */
export function scopeText(u: CompanyUser): string {
  if (u.scope !== 'all') return SCOPES.find((s) => s.value === u.scope)?.label ?? u.scope;
  if (u.org_role === 'owner' && u.company_role === 'owner') return 'ทุกบริษัทในองค์กร';
  return ['บริษัทนี้', ...u.otherCompanies.map((o) => o.name_th)].join(' + ');
}

/** วงเงินแบบร่าง "≤ 1,000,000" (ไม่แสดง .00 เมื่อเป็นจำนวนเต็ม) */
export const limitNum = (v: string): string => money(v).replace(/\.00$/u, '');

/** คอลัมน์ "วงเงินอนุมัติ" ใน ScreenUsers */
export function limitText(u: CompanyUser): string {
  const hasLimit = u.approval_limit !== null && Number(u.approval_limit) > 0;
  if (hasLimit) return `≤ ${limitNum(u.approval_limit!)}`;
  if (u.effective.approve_pay.post && u.approval_limit === null) return 'ไม่จำกัด';
  if (AREAS.some((a) => u.effective[a].post)) return 'จัดทำเท่านั้น';
  return '—';
}

const BKK_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** คอลัมน์ "ใช้งานล่าสุด": ตอนนี้ (ผู้ใช้ที่เปิดหน้า) · วันนี้ HH:MM · เมื่อวาน · DD/MM/YYYY */
export function lastUsedText(iso: string | null, self: boolean, now = new Date()): string {
  if (self) return 'ตอนนี้';
  if (!iso) return '—';
  const d = new Date(iso);
  const day = bkkDay(d);
  if (day === bkkDay(now)) return `วันนี้ ${BKK_TIME.format(d)}`;
  if (day === bkkDay(new Date(now.getTime() - 86_400_000))) return 'เมื่อวาน';
  return thaiDate(day);
}

/** แถวของ "เมทริกซ์สิทธิ์ (ย่อ)" ใน ScreenUsers — คำนวณจาก ROLE_DEFAULTS / LIMITS ของ @innovera/auth */
export const MATRIX_ROLES: { role: Exclude<CompanyRole, 'custom'>; head: string }[] = [
  { role: 'owner', head: 'Owner' }, { role: 'accounting_manager', head: 'Acct. Manager' }, { role: 'accountant', head: 'Accountant' },
  { role: 'ar_clerk', head: 'AR Clerk' }, { role: 'viewer', head: 'Viewer' }, { role: 'auditor', head: 'Auditor' },
];
const MATRIX_ROWS: { label: string; area: Area; action: 'read' | 'write' | 'post' }[] = [
  { label: 'สร้าง/แก้เอกสารขาย', area: 'sales', action: 'write' },
  { label: 'สร้าง/แก้เอกสารซื้อ และจ่ายเงิน', area: 'purchase', action: 'write' },
  { label: 'อนุมัติจ่าย (ตามวงเงิน)', area: 'approve_pay', action: 'post' },
  { label: 'ลงบันทึกรายวัน / แก้สูตรลงบัญชี / ผังบัญชี', area: 'journal', action: 'write' },
  { label: 'ยกเลิก / กลับรายการที่ผ่านแล้ว', area: 'void', action: 'post' },
  { label: 'ปิดงวด / เปิดงวดคืน', area: 'period', action: 'post' },
  { label: 'ดูรายงานการเงิน / ส่งออก', area: 'reports', action: 'read' },
  { label: 'ตั้งค่าบริษัท / ผู้ใช้ / แอปเชื่อมต่อ / แผนและบิล', area: 'settings', action: 'write' },
];
export function matrix(): { label: string; cells: (string | null)[] }[] {
  return MATRIX_ROWS.map((r) => ({
    label: r.label,
    cells: MATRIX_ROLES.map(({ role }) => {
      if (ROLE_DEFAULTS[role][r.area][r.action] !== true) return null;
      const lim = LIMITS[role]?.[r.area];
      return lim ? (lim.startsWith('+') ? `✓ ${lim}` : lim) : '✓';
    }),
  }));
}
