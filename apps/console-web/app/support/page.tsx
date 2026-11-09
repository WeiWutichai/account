// X4 Support และการเข้าดูข้อมูลลูกค้า ← design/project/ConsoleSupport.dc.html
// หลัก: ลูกค้าเป็นเจ้าของข้อมูล · ทีม Innovera เข้าดูได้เฉพาะเมื่อมี ticket + consent ของ Owner + เวลาจำกัด + บันทึกทุกอย่าง (accounting-api บังคับทุกขั้น)
import { Shell } from '../Shell';
import { Tag } from '../ui';
import { getAudit, getMe, getOverview, getTickets } from '../lib/data';
import { SupportDesk } from './SupportDesk';

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const [tickets, o, audit, me, { ticket }] = await Promise.all([getTickets(), getOverview(), getAudit(), getMe(), searchParams]);
  const open = tickets.filter((t) => t.status !== 'closed').length;
  return (
    <Shell active="support" crumb="Innovera Console / Support / impersonate" status={<Tag tone={open ? 'warning' : 'success'}>{open} ticket เปิด</Tag>}>
      <SupportDesk tickets={tickets} counts={o.counts} audit={audit} role={me.role} initial={ticket ?? null} nowIso={new Date().toISOString()} />
    </Shell>
  );
}
