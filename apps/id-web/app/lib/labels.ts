// ป้ายบทบาทตามแบบร่าง ScreenOrgMembers.dc.html / ScreenProfile.dc.html (ตรงกับ @innovera/auth ORG_ROLE_LABEL · ชื่อย่อบทบาทบริษัทตามตารางสมาชิก)
export const ORG_ROLE: Record<string, string> = { owner: 'Owner', admin: 'Admin', billing_admin: 'Billing admin', member: 'Member', guest: 'Guest' };
export const COMPANY_ROLE_SHORT: Record<string, string> = {
  owner: 'Owner', accounting_manager: 'Acct. Manager', accountant: 'Accountant', ar_clerk: 'AR Clerk', petty_cash_holder: 'Petty Cash', viewer: 'Viewer', auditor: 'Auditor', custom: 'กำหนดเอง',
};
export const companyRole = (r: string | null): string => (r ? COMPANY_ROLE_SHORT[r] ?? r : '—');
