// โครงหน้าที่ทุกหน้าใช้ร่วม: Sidebar (ข้อมูลบริษัท/งวดจริง) + main
import { AppShell } from '@innovera/ui';
import type { ReactNode } from 'react';
import { api, type Context } from './api';

const STATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };

export async function Shell({ active, children }: { active: string; children: ReactNode }) {
  const ctx = await api<Context>('/v1/context');
  const periodLabel = ctx.period ? `งวด ${ctx.period.period_no}/${ctx.period.fiscal_year} ${STATUS[ctx.period.status] ?? ctx.period.status}` : 'ยังไม่มีงวดบัญชี';
  return (
    // TODO(M3): ชื่อผู้ใช้/บทบาท/แผน จาก Innovera ID
    <AppShell sidebar={{ active, company: ctx.name, branch: ctx.branch, periodLabel, user: { initial: 'ช', name: '[ชื่อผู้ใช้]', line: 'เจ้าของ · แผน Business' } }}>
      {children}
    </AppShell>
  );
}

export async function currentPeriod(): Promise<{ year: number; period: number }> {
  const ctx = await api<Context>('/v1/context');
  return { year: ctx.period?.fiscal_year ?? 2569, period: ctx.period?.period_no ?? 12 };
}
