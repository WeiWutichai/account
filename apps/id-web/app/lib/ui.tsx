// โครงหน้าและ style string ที่ใช้ร่วมกันของหน้า Innovera ID — คัดลอกจากแบบร่างตรงตัว
// (ScreenSignup / ScreenTwoFactor / ScreenPasswordReset / ScreenInviteAccept / ScreenProfile / ScreenOrgMembers / ScreenPlan .dc.html)
import { css } from '@innovera/ui';
import type { ReactNode } from 'react';

export const T = {
  page: "min-height: 1000px; background: #f4f4f4; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; display: flex; flex-direction: column",
  header: 'height: 48px; background: #161616; color: #f4f4f4; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; font-size: 14px',
  brandWrap: 'display: flex; align-items: center; gap: 12px',
  logo: 'width: 24px; height: 24px; background: #0f62fe; display: inline-block',
  brand: 'font-weight: 600',
  tagline: 'color: #a8a8a8',
  headRight: 'color: #c6c6c6',
  headLink: 'color: #c6c6c6; text-decoration: none',
  main: 'flex: 1; display: flex; justify-content: center; padding: 48px 32px; box-sizing: border-box',
  footer: 'padding: 16px 32px; font-size: 13px; color: #525252; text-align: center',
  link: 'text-decoration: none',
  card: (max: number) => `width: 100%; max-width: ${max}px; margin: 0 auto; background: #ffffff; border: 1px solid #e0e0e0; padding: 32px; display: flex; flex-direction: column; gap: 20px; box-sizing: border-box`,
  h1: 'margin: 0; font-size: 22px; line-height: 30px; font-weight: 600',
  h2: 'margin: 0; font-size: 18px; line-height: 26px; font-weight: 600',
  sub: 'font-size: 13px; color: #525252',
  label: 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252',
  input: 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616',
  check: 'display: flex; gap: 8px; align-items: flex-start; font-size: 14px',
  checkBox: 'margin-top: 5px',
  orRow: 'display: flex; align-items: center; gap: 12px; color: #8d8d8d; font-size: 13px',
  orLine: 'flex: 1; height: 1px; background: #e0e0e0',
  phase2: 'display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 4px; background: #e8daff; color: #491d8b; font-size: 12px; font-weight: 500',
  phase2Box: 'width: 100%; max-width: 440px; margin: 0 auto; border: 1px dashed #a56eff; padding: 12px 16px; font-size: 13px; color: #525252; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box',
  steps: 'margin: 0; padding: 0; list-style: none; display: flex; font-size: 13px',
  stepOn: 'flex: 1; padding: 8px 12px 8px 0; border-top: 2px solid #0f62fe; font-weight: 600',
  stepOff: 'flex: 1; padding: 8px 12px 8px 0; border-top: 2px solid #e0e0e0; color: #525252',
  digit: (filled: boolean) => `width: 48px; height: 56px; text-align: center; font-size: 24px; font-variant-numeric: tabular-nums; border: 0; border-bottom: 2px solid ${filled ? '#0f62fe' : '#8d8d8d'}; background: #f4f4f4; font-family: inherit`,
  mono: "font-family: 'IBM Plex Mono', monospace; color: #161616",
  codesGrid: "margin-top: 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; background: #f4f4f4; padding: 12px; font-variant-numeric: tabular-nums",
  // ไม่มีในแบบร่าง: ข้อความ error จาก API (สีอันตรายของระบบออกแบบ)
  error: 'margin: 0; font-size: 13px; color: #da1e28',
  // ปุ่มที่หน้าตาเป็นลิงก์ (การกระทำ ไม่ใช่การนำทาง)
  linkButton: 'background: none; border: 0; padding: 0; margin: 0; font: inherit; color: #0f62fe; cursor: pointer; text-align: left',
} as const;

/** หัวหน้า Innovera ID (โลโก้ + ชื่อ + คำโปรย) · ด้านขวาแล้วแต่หน้า */
export function IdHeader({ right, brand = 'Innovera ID', tagline = 'บัญชีเดียว ใช้ได้ทุกแอป Innovera' }: { right?: ReactNode; brand?: string; tagline?: string }) {
  return (
    <header style={css(T.header)}>
      <div style={css(T.brandWrap)}><span style={css(T.logo)} /><span style={css(T.brand)}>{brand}</span><span style={css(T.tagline)}>{tagline}</span></div>
      {right}
    </header>
  );
}

/** ท้ายหน้า · TODO(Wei): ยังไม่มีหน้านโยบายความเป็นส่วนตัว/เงื่อนไขการใช้งาน และภาษา EN (แบบร่างลิงก์กลับหน้าเดิม) → ลิงก์กลับหน้าเดิมเหมือนแบบร่าง */
export function IdFooter({ self }: { self: string }) {
  return (
    <footer style={css(T.footer)}>© Innovera · <a href={self} style={css(T.link)}>นโยบายความเป็นส่วนตัว</a> · <a href={self} style={css(T.link)}>เงื่อนไขการใช้งาน</a> · ภาษา: ไทย / <a href={self} style={css(T.link)}>EN</a></footer>
  );
}

/** โครงหน้า: header · main (กึ่งกลาง max-width) · footer */
export function IdPage({ self, right, maxWidth, children, header, footer = true }: { self: string; right?: ReactNode; maxWidth: number; children: ReactNode; header?: ReactNode; footer?: boolean }) {
  return (
    <div style={css(T.page)}>
      {header ?? <IdHeader right={right} />}
      <main style={css(T.main)}>
        <div style={css(`width: 100%; max-width: ${maxWidth}px; display: flex; flex-direction: column; gap: 24px`)}>{children}</div>
      </main>
      {footer && <IdFooter self={self} />}
    </div>
  );
}

/** ขั้นตอนสมัคร (ScreenSignup) */
export function SignupSteps({ active }: { active: 1 | 2 | 3 | 4 }) {
  const steps = ['1 บัญชี Innovera ID', '2 ยืนยันอีเมล', '3 องค์กรและบริษัทแรก', '4 เลือกแผน'];
  return <ol style={css(T.steps)}>{steps.map((s, i) => <li key={s} style={css(i + 1 === active ? T.stepOn : T.stepOff)} {...(i + 1 === active ? { 'aria-current': 'step' as const } : {})}>{s}</li>)}</ol>;
}

export function OrDivider() {
  return <div style={css(T.orRow)}><span style={css(T.orLine)} />หรือ<span style={css(T.orLine)} /></div>;
}

export function Phase2({ children = 'Phase 2' }: { children?: string }) {
  return <span style={css(T.phase2)}>{children}</span>;
}

export function ErrorText({ children }: { children: string | null }) {
  return children ? <p role="alert" style={css(T.error)}>{children}</p> : null;
}

/** query string ต่อท้าย: ส่ง next ต่อไปทุกขั้น */
export const withNext = (path: string, next: string | null | undefined): string =>
  next ? `${path}${path.includes('?') ? '&' : '?'}next=${encodeURIComponent(next)}` : path;

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? v[0] : v) ?? null;
