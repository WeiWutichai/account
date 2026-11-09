// โครงหน้าที่ทุกหน้าใช้ร่วม: Sidebar (ข้อมูลบริษัท/งวดจริง) + main
import { COMPANY_ROLE_LABEL, type CompanyRole } from '@innovera/auth';
import { AppShell, type SidebarBadge } from '@innovera/ui';
import type { ReactNode } from 'react';
import { api, type Context } from './api';

const STATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };

export async function Shell({ active, children }: { active: string; children: ReactNode }) {
  const [ctx, side] = await Promise.all([api<Context>('/v1/context'), api<SidebarInfo>('/v1/sidebar')]);
  const name = side.user.name ?? '[ชื่อผู้ใช้]';
  // ป้ายบทบาท: แบบร่างมีแค่ "เจ้าของ" (Sidebar.dc.html) · บทบาทอื่นใช้ป้ายของ ScreenUserEdit — TODO(Wei): ชื่อบทบาทภาษาไทย
  const role = side.user.role === 'owner' ? 'เจ้าของ' : side.user.role ? COMPANY_ROLE_LABEL[side.user.role] : '';
  const line = [role, side.user.plan ? `แผน ${side.user.plan}` : ''].filter(Boolean).join(' · ');
  const periodLabel = ctx.period ? `งวด ${ctx.period.period_no}/${ctx.period.fiscal_year} ${STATUS[ctx.period.status] ?? ctx.period.status}` : 'ยังไม่มีงวดบัญชี';
  return (
    <AppShell sidebar={{ active, company: ctx.name, branch: ctx.branch, periodLabel, badges: side.badges, user: { initial: [...name.replace(/^\[/u, '')][0] ?? '?', name, line } }}>
      {children}
    </AppShell>
  );
}

interface SidebarInfo { badges: Record<string, SidebarBadge>; user: { name: string | null; role: CompanyRole | null; plan: string | null } }

export async function currentPeriod(): Promise<{ year: number; period: number }> {
  const ctx = await api<Context>('/v1/context');
  return { year: ctx.period?.fiscal_year ?? 2569, period: ctx.period?.period_no ?? 12 };
}
