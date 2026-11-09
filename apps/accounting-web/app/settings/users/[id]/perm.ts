// ตรรกะสิทธิ์ฝั่ง client ของ ScreenUserEdit — ค่าตั้งต้นของบทบาท (ROLE_DEFAULTS) ส่งมาจาก server (@innovera/auth)
// เหตุที่ไม่ import @innovera/auth ตรงในไฟล์ client: index ของแพ็กเกจรวม argon2/bcrypt/node:crypto ซึ่งรันในเบราว์เซอร์ไม่ได้
// สูตรเดียวกับ effectivePermissions / diffFromRole ใน packages/auth/src/roles.ts (ทับค่าบทบาทด้วยการปรับรายคน · เทียบกับค่าบทบาท)
import type { Action, Area, CompanyRole, Grant, Permissions } from '@innovera/auth';

export const AREA_LIST: readonly Area[] = ['sales', 'purchase', 'finance', 'approve_pay', 'journal', 'void', 'period', 'reports', 'settings'];
export const ACTION_LIST: readonly Action[] = ['read', 'write', 'post', 'void'];
export type RoleDefaults = Record<Exclude<CompanyRole, 'custom'>, Permissions>;

export function roleBase(defaults: RoleDefaults, role: CompanyRole): Permissions {
  if (role === 'custom') return Object.fromEntries(AREA_LIST.map((a) => [a, {}])) as Permissions;
  return defaults[role];
}

/** ส่วนที่ต่างจากค่าบทบาท → ส่งเป็น permissions (null = ใช้ค่าบทบาท) · ส่งครบทุกพื้นที่เพื่อให้ "ลดสิทธิ์" มีผล */
export function overrideOf(defaults: RoleDefaults, role: CompanyRole, p: Permissions): Record<Area, Grant> | null {
  const d = diff(defaults, role, p);
  if (role !== 'custom' && d.added.length === 0 && d.removed.length === 0) return null;
  const out = {} as Record<Area, Grant>;
  for (const a of AREA_LIST) out[a] = Object.fromEntries(ACTION_LIST.map((x) => [x, p[a][x] === true])) as Grant;
  return out;
}

export function diff(defaults: RoleDefaults, role: CompanyRole, p: Permissions): { added: [Area, Action][]; removed: [Area, Action][] } {
  const base = roleBase(defaults, role);
  const added: [Area, Action][] = [];
  const removed: [Area, Action][] = [];
  for (const a of AREA_LIST) for (const x of ACTION_LIST) {
    const was = base[a][x] === true;
    const now = p[a][x] === true;
    if (now && !was) added.push([a, x]);
    if (was && !now) removed.push([a, x]);
  }
  return { added, removed };
}

/** จำนวนช่องสิทธิ์ที่ต่างกันระหว่างสองชุด (แถบล่าง "เปลี่ยน N รายการ") */
export function countDiff(a: Permissions, b: Permissions): number {
  let n = 0;
  for (const ar of AREA_LIST) for (const x of ACTION_LIST) if ((a[ar][x] === true) !== (b[ar][x] === true)) n += 1;
  return n;
}
