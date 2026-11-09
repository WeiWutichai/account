// บทบาทและสิทธิ์ — ตามแบบร่าง ScreenUsers.dc.html (เมทริกซ์ย่อ) และ ScreenUserEdit.dc.html (พื้นที่ × การกระทำ)
// TODO(Wei) T6: Spec v2 §3.1 ใช้ชุดบทบาทต่างจากแบบร่าง (admin/staff) → ทำตามแบบร่าง รอยืนยัน

export const ORG_ROLES = ['owner', 'admin', 'billing_admin', 'member', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ORG_ROLE_LABEL: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', billing_admin: 'Billing admin', member: 'Member', guest: 'Guest' };

export const COMPANY_ROLES = ['owner', 'accounting_manager', 'accountant', 'ar_clerk', 'petty_cash_holder', 'viewer', 'auditor', 'custom'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];
/** ป้ายตาม ScreenUserEdit (ตัวเลือก "บทบาทในบริษัทนี้") */
export const COMPANY_ROLE_LABEL: Record<CompanyRole, string> = {
  owner: 'Owner', accounting_manager: 'Accountant Manager', accountant: 'Accountant', ar_clerk: 'AR Clerk', petty_cash_holder: 'Petty Cash Holder',
  viewer: 'Viewer', auditor: 'Auditor (อ่านอย่างเดียว)', custom: 'กำหนดเอง…',
};

/** พื้นที่ตามแถวของ ScreenUserEdit */
export const AREAS = ['sales', 'purchase', 'finance', 'approve_pay', 'journal', 'void', 'period', 'reports', 'settings'] as const;
export type Area = (typeof AREAS)[number];
export const ACTIONS = ['read', 'write', 'post', 'void'] as const;
export type Action = (typeof ACTIONS)[number];
export type Grant = Partial<Record<Action, boolean>>;
export type Permissions = Record<Area, Grant>;

const none: Grant = {};
const R: Grant = { read: true };
const RW: Grant = { read: true, write: true };
const RWP: Grant = { read: true, write: true, post: true };
const ALL: Grant = { read: true, write: true, post: true, void: true };

/**
 * ค่าตั้งต้นต่อบทบาท — จากเมทริกซ์ย่อใน ScreenUsers:
 * ขาย ✓✓✓✓—— · ซื้อ/จ่าย ✓✓✓——— · อนุมัติจ่าย ✓✓———— · JV/สูตร/ผัง ✓✓(JV เท่านั้น)——— · ยกเลิก ✓✓———— · ปิดงวด ✓(ปิดอ่อน)———— · รายงาน ✓✓✓(AR)✓✓ · ตั้งค่า ✓(ผู้ใช้)————
 * ข้อจำกัดย่อย (JV เท่านั้น / ปิดอ่อน / AR เท่านั้น / ผู้ใช้เท่านั้น) อยู่ใน LIMITS
 * Petty Cash Holder ไม่อยู่ในเมทริกซ์ย่อ — ใช้ขอบเขต "เงินสดย่อย / ค่าใช้จ่าย" จากตารางผู้ใช้ (TODO Wei ยืนยัน)
 */
export const ROLE_DEFAULTS: Record<Exclude<CompanyRole, 'custom'>, Permissions> = {
  owner: { sales: ALL, purchase: ALL, finance: ALL, approve_pay: RWP, journal: ALL, void: ALL, period: ALL, reports: RW, settings: ALL },
  accounting_manager: { sales: ALL, purchase: ALL, finance: ALL, approve_pay: RWP, journal: ALL, void: ALL, period: RWP, reports: RW, settings: RW },
  accountant: { sales: RWP, purchase: RWP, finance: RWP, approve_pay: none, journal: RWP, void: none, period: R, reports: RW, settings: none },
  ar_clerk: { sales: RW, purchase: none, finance: RW, approve_pay: none, journal: R, void: none, period: R, reports: RW, settings: none },
  petty_cash_holder: { sales: none, purchase: RW, finance: RW, approve_pay: none, journal: none, void: none, period: none, reports: none, settings: none },
  viewer: { sales: R, purchase: R, finance: R, approve_pay: none, journal: R, void: none, period: R, reports: RW, settings: none },
  auditor: { sales: R, purchase: R, finance: R, approve_pay: none, journal: R, void: none, period: R, reports: RW, settings: none },
};
/** ข้อจำกัดย่อยของเมทริกซ์ (ข้อความตามแบบร่าง) */
export const LIMITS: Partial<Record<CompanyRole, Partial<Record<Area, string>>>> = {
  accounting_manager: { period: 'ปิดอ่อน', settings: 'ผู้ใช้' },
  accountant: { journal: 'JV เท่านั้น' },
  ar_clerk: { reports: 'AR เท่านั้น' },
  auditor: { reports: '+ Audit pack' },
};

/** สิทธิ์จริง = ค่าของบทบาท ทับด้วยการปรับรายคน (ScreenUserEdit "ปรับเฉพาะคนนี้ได้") */
export function effectivePermissions(role: CompanyRole, override?: Partial<Record<Area, Grant>> | null): Permissions {
  const base: Permissions = role === 'custom' ? Object.fromEntries(AREAS.map((a) => [a, {}])) as Permissions : ROLE_DEFAULTS[role];
  const out = {} as Permissions;
  for (const a of AREAS) out[a] = { ...base[a], ...(override?.[a] ?? {}) };
  return out;
}
export const can = (p: Permissions, area: Area, action: Action): boolean => p[area][action] === true;

/** สรุปการเปลี่ยนแปลงเทียบกับค่าของบทบาท (กล่อง "สรุปการเปลี่ยนแปลง" ใน ScreenUserEdit) */
export function diffFromRole(role: CompanyRole, p: Permissions): { added: string[]; removed: string[] } {
  const base = effectivePermissions(role);
  const added: string[] = [];
  const removed: string[] = [];
  for (const a of AREAS) for (const x of ACTIONS) {
    const was = base[a][x] === true;
    const now = p[a][x] === true;
    if (now && !was) added.push(`${a}.${x}`);
    if (was && !now) removed.push(`${a}.${x}`);
  }
  return { added, removed };
}

/** บทบาทที่ลงบัญชีได้ตามสถานะงวด (ledger: soft_closed = manager+) */
export function ledgerRole(role: CompanyRole): 'owner' | 'accounting_manager' | 'accountant' | null {
  if (role === 'owner' || role === 'accounting_manager' || role === 'accountant') return role;
  return null;
}
/** ผู้สอบบัญชี (Guest) ไม่นับที่นั่ง — ScreenOrgMembers */
export const countsSeat = (orgRole: OrgRole): boolean => orgRole !== 'guest';
