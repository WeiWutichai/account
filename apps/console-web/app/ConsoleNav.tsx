// เมนู Console — ถอดจาก design/project/ConsoleNav.dc.html ตรงตัว (ลำดับ กลุ่ม ป้าย ลิงก์) · ใช้ร่วมทุกหน้าผ่าน Shell
import { css } from '@innovera/ui';

export type NavId = 'overview' | 'tenants' | 'billing' | 'support' | 'flags' | 'reference' | 'ops' | 'team';
type ToneId = 'act' | 'warn' | 'p2';
interface Item { id: NavId; label: string; href: string; group?: string; tone?: ToneId }

const LIST: Item[] = [
  { id: 'overview', label: 'ภาพรวมแพลตฟอร์ม', href: '/' },
  { id: 'tenants', label: 'องค์กร (tenants)', href: '/tenants', group: 'ลูกค้า', tone: 'warn' },
  { id: 'billing', label: 'Subscription & billing', href: '/billing', tone: 'p2' },
  { id: 'support', label: 'Support / impersonate', href: '/support', tone: 'act' },
  { id: 'flags', label: 'แอปและ feature flags', href: '/flags', group: 'แพลตฟอร์ม' },
  { id: 'reference', label: 'ข้อมูลอ้างอิงกลาง', href: '/reference' },
  { id: 'ops', label: 'Ops / งานค้าง', href: '/ops', tone: 'warn' },
  { id: 'team', label: 'ทีม Innovera และ Audit', href: '/team', group: 'ภายใน' },
];
const TONES: Record<ToneId, string> = { act: '#78a9ff', warn: '#f1c21b', p2: '#be95ff' };
const BADGE = 'min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; color: #161616; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums';

export interface NavUser { initial: string; name: string; line: string }

/** badges: ตัวเลขจริงจาก API (0 = ไม่แสดงป้าย) · billing แสดง "P2" เสมอตามแบบร่าง */
export function ConsoleNav({ active, badges, user, env }: { active: NavId; badges: Partial<Record<NavId, number>>; user: NavUser; env: string }) {
  return (
    <nav className="cn" aria-label="เมนู Console" style={css("box-sizing: border-box; width: 100%; height: 100%; min-height: 1000px; background: #161616; color: #f4f4f4; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 14px; display: flex; flex-direction: column")}>
      <style>{'.cn a{color:#f4f4f4;text-decoration:none}.cn .it:hover{background:#393939}.cn a:focus-visible,.cn button:focus-visible{outline:2px solid #78a9ff;outline-offset:-2px}'}</style>
      <div style={css('height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid #393939')}>
        <span aria-hidden="true" style={css('width: 28px; height: 28px; border-radius: 6px; background: #0f62fe; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px')}>IN</span>
        <span style={css('line-height: 1.2')}><span style={css('font-weight: 600; font-size: 15px; display: block')}>Innovera Console</span><span style={css('font-size: 11px; color: #a8a8a8')}>back-office · เฉพาะทีม Innovera</span></span>
      </div>
      {/* สภาพแวดล้อมจริงของ deployment (แบบร่างแสดง production) */}
      <div style={css('margin: 12px 12px 4px; padding: 8px 12px; border: 1px solid #393939; border-radius: 6px; font-size: 12px; color: #c6c6c6; display: flex; justify-content: space-between; gap: 8px')}><span>สภาพแวดล้อม</span><span style={css(`color: ${env === 'production' ? '#42be65' : '#f1c21b'}; font-weight: 600`)}>{env}</span></div>
      <div style={css('display: flex; flex-direction: column; padding: 8px 8px 12px; overflow-y: auto; gap: 1px')}>
        {LIST.map((x) => {
          const on = x.id === active;
          const n = x.tone === 'p2' ? 'P2' : badges[x.id] ? String(badges[x.id]) : '';
          const badge = n && x.tone ? <span style={css(`${BADGE}; background: ${TONES[x.tone]}`)}>{n}</span> : null;
          return (
            <span key={x.id} style={css('display: contents')}>
              {x.group && <span style={css('font-size: 11px; color: #8d8d8d; padding: 12px 10px 4px; letter-spacing: .3px; text-transform: uppercase')}>{x.group}</span>}
              {on
                ? <a href={x.href} aria-current="page" style={css('display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 0 10px 0 9px; border-left: 3px solid #78a9ff; border-radius: 0 6px 6px 0; background: #393939; color: #ffffff; font-weight: 600')}>{x.label}{badge}</a>
                : <a className="it" href={x.href} style={css('display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 0 10px 0 12px; border-radius: 6px; color: #e0e0e0')}>{x.label}{badge}</a>}
            </span>
          );
        })}
      </div>
      <div style={css('margin-top: auto; display: flex; gap: 10px; align-items: center; padding: 12px 16px; border-top: 1px solid #393939; font-size: 13px')}>
        <span aria-hidden="true" style={css('width: 32px; height: 32px; border-radius: 999px; background: #393939; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-weight: 600')}>{user.initial}</span>
        <span style={css('line-height: 1.35; flex: 1; min-width: 0')}>{user.name}<br /><span style={css('color: #a8a8a8')}>{user.line}</span></span>
        {/* ออกจากระบบต้องเป็น POST (เพิกถอน refresh token ที่ id-api) — แบบร่างเป็นลิงก์ไป ScreenLogin */}
        <form method="post" action="/logout" style={css('display: contents')}>
          <button type="submit" aria-label="ออกจากระบบ" style={css('display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 6px; background: none; border: 0; padding: 0; cursor: pointer')}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#c6c6c6" strokeWidth="1.5" aria-hidden="true"><path d="M6 3H3v10h3M10 5l3 3-3 3M13 8H6" /></svg></button>
        </form>
      </div>
    </nav>
  );
}
