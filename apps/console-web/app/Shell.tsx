// โครงหน้า Console ตามแบบร่าง (ช่องเมนู 256px + main · หัวหน้า 48px มี breadcrumb และป้ายสถานะ) · <dc-import name="ConsoleNav" active="…"> = จุดวาง ConsoleNav
import { css, S } from '@innovera/ui';
import type { ReactNode } from 'react';
import { ConsoleNav, type NavId } from './ConsoleNav';
import { getMe, getOverview, getSessionEmail, getTenants } from './lib/data';
import { needsAttention } from './lib/rules';
import { SupportBar } from './SupportBar';

const ENV = process.env.INNOVERA_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');

export async function Shell({ active, crumb, status, children }: { active: NavId; crumb: string; status?: ReactNode; children: ReactNode }) {
  const [me, overview, tenants, email] = await Promise.all([getMe(), getOverview(), getTenants(), getSessionEmail()]);
  const name = email ?? me.userId;
  // TODO(backend): GET /console/v1/me ไม่คืนชื่อที่แสดง/วิธียืนยันตัวตน — แบบร่างแสดง "Wei" + "superadmin · 2FA + hardware key" · ตอนนี้ใช้อีเมลจาก token + บทบาทจริง
  // TODO(Wei): บทบาทในฐานข้อมูลคือ support/engineer/billing/ops/admin แต่แบบร่าง (ConsoleNav, ConsoleTeam) ใช้ "superadmin" และ "read-only (reference)" — ยืนยันชื่อบทบาท
  const user = { initial: (name[0] ?? '?').toUpperCase(), name, line: `${me.role} · 2FA` };
  const badges = { tenants: tenants.filter((t) => needsAttention(t)).length, support: overview.counts.tickets_open, ops: overview.counts.dead_webhooks };
  return (
    <div style={css(S.shell)}>
      <div style={css(S.sidebarSlot)}><ConsoleNav active={active} badges={badges} user={user} env={ENV} /></div>
      <main style={css(S.main)}>
        <SupportBar />
        <header style={css(S.topbar)}><span style={css(S.crumb)}>{crumb}</span>{status}</header>
        {children}
      </main>
    </div>
  );
}
