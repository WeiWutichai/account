// โครงหน้าแอป (Sidebar 256px + main) และแถบบน 48px — ตามแบบร่างทุกหน้า
import type { ReactNode } from 'react';
import { css } from './css.ts';
import { Sidebar, type SidebarProps } from './Sidebar.tsx';
import { S } from './styles.ts';

export function AppShell({ sidebar, children }: { sidebar: SidebarProps; children: ReactNode }) {
  return (
    <div style={css(S.shell)}>
      <div style={css(S.sidebarSlot)}><Sidebar {...sidebar} /></div>
      <main style={css(S.main)}>{children}</main>
    </div>
  );
}

export function TopBar({ crumb, right }: { crumb: string; right?: ReactNode }) {
  return (
    <header style={css(S.topbar)}>
      <span style={css(S.crumb)}>{crumb}</span>
      {right}
    </header>
  );
}
