'use client';
// Sidebar ร่วม 1 ตัว (9 กลุ่ม พับได้) — ถอดจาก design/project/Sidebar.dc.html ตรงตัว · ป้ายน้ำเงิน = ต้องทำ · เหลือง = ใกล้กำหนด
import { useState } from 'react';
import { css } from './css.ts';
import { href } from './routes.ts';

export interface SidebarBadge { count: number; tone: 'act' | 'warn'; hint?: string }
export interface SidebarProps {
  active: string;
  company: string;
  branch: string;
  periodLabel: string; // เช่น "งวด 11/2569 เปิด"
  user: { initial: string; name: string; line: string };
  badges?: Readonly<Record<string, SidebarBadge>>;
}

const ICON = {
  home: 'M2 8l6-5 6 5v6H10v-4H6v4H2z',
  sales: 'M2 3h12v8H6l-3 3V3zM5 6h6M5 8.5h4',
  buy: 'M2 3h2l2 8h7l1.5-6H5M7 14a1 1 0 100-2 1 1 0 000 2zM12 14a1 1 0 100-2 1 1 0 000 2z',
  fin: 'M2 5h12v8H2zM2 7.5h12M5 11h3',
  gl: 'M4 2h8v12H4zM6 5h4M6 7.5h4M6 10h2',
  tax: 'M3 2h7l3 3v9H3zM10 2v3h3M5.5 9.5l5-3M6 7a.5.5 0 100-1 .5.5 0 000 1zM10 10a.5.5 0 100-1 .5.5 0 000 1z',
  rep: 'M2 13h12M4 11V7M7.5 11V4M11 11V8.5',
  master: 'M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 14c0-2.5 2.2-4 5-4s5 1.5 5 4',
  set: 'M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
};

interface Item { id: string; label: string }
interface Group { id: string; title: string; icon: string; collapsed?: boolean; items: Item[] }

const GROUPS: Group[] = [
  { id: 'sales', title: 'ขาย', icon: ICON.sales, items: [{ id: 'quote', label: 'ใบเสนอราคา / ใบสั่งขาย' }, { id: 'invoice', label: 'ใบแจ้งหนี้ / ใบกำกับภาษี' }, { id: 'creditnote', label: 'ใบลดหนี้ / ใบเพิ่มหนี้' }, { id: 'deposit', label: 'เงินมัดจำ' }] },
  { id: 'buy', title: 'ซื้อ', icon: ICON.buy, items: [{ id: 'po', label: 'ใบขอซื้อ / ใบสั่งซื้อ' }, { id: 'purchase', label: 'บิลซื้อ' }, { id: 'purchasecn', label: 'ใบลดหนี้ / ใบเพิ่มหนี้ (ซื้อ)' }, { id: 'expense', label: 'ค่าใช้จ่าย' }] },
  { id: 'fin', title: 'การเงิน', icon: ICON.fin, items: [{ id: 'bn', label: 'วางบิล / รับวางบิล' }, { id: 'receipt', label: 'รับชำระ' }, { id: 'payment', label: 'จ่ายชำระ' }, { id: 'cheque', label: 'ทะเบียนเช็ค' }, { id: 'pettycash', label: 'เงินสดย่อย' }, { id: 'bank', label: 'กระทบยอดธนาคาร' }] },
  { id: 'gl', title: 'บัญชี', icon: ICON.gl, items: [{ id: 'journal', label: 'บันทึกรายวัน' }, { id: 'ledger', label: 'บัญชีแยกประเภท' }, { id: 'coa', label: 'ผังบัญชี' }, { id: 'formula', label: 'สูตรลงบัญชี' }, { id: 'assets', label: 'ทะเบียนทรัพย์สิน' }] },
  { id: 'tax', title: 'ภาษีและปิดงวด', icon: ICON.tax, items: [{ id: 'tax', label: 'ภาษี ภ.พ.30 / ภ.ง.ด.' }, { id: 'recon', label: 'ตรวจความถูกต้อง' }, { id: 'close', label: 'ปิดงวด / ปิดปี' }] },
  { id: 'rep', title: 'รายงาน', icon: ICON.rep, items: [{ id: 'reports', label: 'งบการเงิน' }, { id: 'aging', label: 'อายุลูกหนี้ / เจ้าหนี้' }] },
  { id: 'master', title: 'ข้อมูลหลัก', icon: ICON.master, items: [{ id: 'contacts', label: 'ลูกค้า / ผู้ขาย' }, { id: 'products', label: 'สินค้า / บริการ' }] },
  // Phase 2A — กลุ่มชั่วคราว (ไม่มีใน Sidebar.dc.html · Wei สั่งให้ใช้งานได้ก่อน 2026-11-10) · TODO(Wei): ย้ายตามแบบร่างเมื่อออกแบบเสร็จ
  { id: 'p2a', title: 'โมดูลเพิ่มเติม (ชั่วคราว)', icon: ICON.master, items: [{ id: 'inventory', label: 'สินค้าคงคลัง' }, { id: 'stockdocs', label: 'รับ / เบิก / โอน / ตรวจนับ' }, { id: 'fx', label: 'สกุลเงิน และสาขา' }, { id: 'contracts', label: 'สัญญา / รายได้รับล่วงหน้า' }, { id: 'foreigntax', label: 'ภ.พ.36 / ภ.ง.ด.54' }, { id: 'modules', label: 'เปิดโมดูล และค่าตั้งที่รอยืนยัน' }] },
  { id: 'set', title: 'ตั้งค่า', icon: ICON.set, collapsed: true, items: [{ id: 'settings', label: 'ข้อมูลบริษัท' }, { id: 'docsettings', label: 'ตั้งค่าเอกสาร' }, { id: 'users', label: 'ผู้ใช้และสิทธิ์' }, { id: 'apps', label: 'แอปที่เชื่อมต่อ' }, { id: 'mcp', label: 'การเชื่อมต่อ AI (MCP)' }, { id: 'audit', label: 'ประวัติการใช้งาน' }] },
];
const TONES = { act: ['#d0e2ff', '#0043ce'], warn: ['#fcf4d6', '#684e00'] } as const;
const BADGE = 'min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums';

function Badge({ b, on }: { b: SidebarBadge | undefined; on: boolean }) {
  if (!b || !b.count) return null;
  const [bg, fg] = on ? ['#0f62fe', '#ffffff'] : TONES[b.tone];
  return <span title={b.hint} style={css(`${BADGE}; background: ${bg}; color: ${fg}`)}>{b.count}</span>;
}

export function Sidebar({ active, company, branch, periodLabel, user, badges = {} }: SidebarProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const homeOn = active === 'home';
  return (
    <nav className="sn" aria-label="เมนูหลัก" style={css("box-sizing: border-box; width: 100%; height: 100%; min-height: 1000px; background: #f4f4f4; border-right: 1px solid #e0e0e0; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 14px; display: flex; flex-direction: column")}>
      <style>{`.sn a{color:#161616;text-decoration:none}.sn .it:hover{background:#e8e8e8;color:#161616}.sn .gh:hover{background:#e8e8e8}.sn a:focus-visible,.sn button:focus-visible,.sn input:focus-visible{outline:2px solid #0f62fe;outline-offset:-2px}`}</style>
      <div style={css('height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 16px; background: #ffffff; border-bottom: 1px solid #e0e0e0')}>
        <span aria-hidden="true" style={css('width: 28px; height: 28px; border-radius: 6px; background: #0f62fe; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px')}>AS</span>
        <span style={css('font-weight: 600; font-size: 15px')}>AccountSystem</span>
      </div>
      <a href={href('companies')} aria-label="สลับบริษัท" style={css('display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 12px 12px 4px; padding: 8px 12px; border: 1px solid #e0e0e0; border-radius: 6px; background: #ffffff')}>
        <span style={css('line-height: 1.35; min-width: 0')}>
          <span style={css('display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{company}</span>
          <span style={css('font-size: 12px; color: #525252')}>{branch} · {periodLabel}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#525252" strokeWidth="1.5" aria-hidden="true"><path d="M5 6l3-3 3 3M5 10l3 3 3-3" /></svg>
      </a>
      <label style={css('display: flex; align-items: center; gap: 8px; margin: 8px 12px 4px; height: 36px; padding: 0 10px; border: 1px solid #c6c6c6; border-radius: 6px; background: #ffffff')}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#525252" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
        <span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden')}>ค้นหาเมนูหรือเลขที่เอกสาร</span>
        <input placeholder="ค้นหาเมนู / เลขที่เอกสาร" style={css('flex: 1; min-width: 0; border: 0; background: transparent; font-family: inherit; font-size: 13px; color: #161616; outline: none')} />
        <kbd style={css('font-family: inherit; font-size: 11px; color: #525252; border: 1px solid #c6c6c6; border-radius: 4px; padding: 0 4px')}>⌘K</kbd>
      </label>
      <div style={css('display: flex; flex-direction: column; padding: 4px 8px 12px; overflow-y: auto')}>
        <a className={homeOn ? undefined : 'it'} href={href('home')} {...(homeOn ? { 'aria-current': 'page' as const } : {})}
          style={css(`display: flex; align-items: center; gap: 10px; min-height: 36px; margin-top: 4px; padding: 0 10px; border-radius: 6px; font-weight: 600${homeOn ? '; background: #e5effe; color: #0043ce' : ''}`)}>
          <span aria-hidden="true" style={css(`display: inline-flex; width: 20px; justify-content: center${homeOn ? '' : '; color: #525252'}`)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={ICON.home} /></svg></span>
          <span style={css('flex: 1')}>หน้าแรก · งานที่ต้องทำ</span>
          <Badge b={badges['home']} on={homeOn} />
        </a>
        {GROUPS.map((g) => {
          const hasActive = g.items.some((x) => x.id === active);
          const expanded = open[g.id] ?? (hasActive || !g.collapsed);
          const badged = g.items.map((x) => badges[x.id]).filter((b): b is SidebarBadge => Boolean(b && b.count));
          const sum = badged.reduce((a, b) => a + b.count, 0);
          const [sbg, sfg] = badged.some((b) => b.tone === 'act') ? TONES.act : TONES.warn;
          return (
            <div key={g.id}>
              <button className="gh" aria-expanded={expanded} onClick={() => setOpen({ ...open, [g.id]: !expanded })}
                style={css(`display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; margin-top: 6px; padding: 0 10px; border: 0; border-radius: 6px; background: ${hasActive && !expanded ? '#e5effe' : 'transparent'}; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left`)}>
                <span aria-hidden="true" style={css(`display: inline-flex; width: 20px; justify-content: center; color: ${hasActive ? '#0f62fe' : '#525252'}`)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={g.icon} /></svg></span>
                <span style={css('flex: 1')}>{g.title}</span>
                {!expanded && sum > 0 && <span style={css(`${BADGE}; background: ${sbg}; color: ${sfg}`)}>{sum}</span>}
                <span aria-hidden="true" style={css(`display: inline-flex; color: #6f6f6f; transform: ${expanded ? 'rotate(0deg)' : 'rotate(-90deg)'}; transition: transform .15s`)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M4 6l4 4 4-4" /></svg></span>
              </button>
              {expanded && (
                <div style={css('position: relative; margin: 2px 0 2px 19px; padding-left: 11px; border-left: 1px solid #c6c6c6; display: flex; flex-direction: column; gap: 1px')}>
                  {g.items.map((x) => x.id === active ? (
                    <a key={x.id} href={href(x.id)} aria-current="page" style={css('position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 0 10px; border-radius: 6px; background: #e5effe; color: #0043ce; font-weight: 600; font-size: 13.5px')}>
                      <span aria-hidden="true" style={css('position: absolute; left: -12px; top: 50%; width: 10px; height: 1px; background: #0f62fe')} />
                      <span aria-hidden="true" style={css('position: absolute; left: -14px; top: 50%; width: 5px; height: 5px; margin-top: -2px; border-radius: 999px; background: #0f62fe')} />
                      {x.label}<Badge b={badges[x.id]} on />
                    </a>
                  ) : (
                    <a key={x.id} className="it" href={href(x.id)} style={css('position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 0 10px; border-radius: 6px; color: #393939; font-size: 13.5px')}>
                      <span aria-hidden="true" style={css('position: absolute; left: -12px; top: 50%; width: 8px; height: 1px; background: #c6c6c6')} />
                      {x.label}<Badge b={badges[x.id]} on={false} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={css('margin-top: auto; display: flex; gap: 10px; align-items: center; padding: 12px 16px; border-top: 1px solid #e0e0e0; background: #ffffff; font-size: 13px')}>
        <span aria-hidden="true" style={css('width: 32px; height: 32px; border-radius: 999px; background: #d0e2ff; color: #0043ce; display: inline-flex; align-items: center; justify-content: center; font-weight: 600')}>{user.initial}</span>
        <a href={href('profile')} style={css('line-height: 1.35; flex: 1; min-width: 0')}>{user.name}<br /><span style={css('color: #525252')}>{user.line}</span></a>
        <a href={href('login')} aria-label="ออกจากระบบ" style={css('display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 6px')}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#525252" strokeWidth="1.5" aria-hidden="true"><path d="M6 3H3v10h3M10 5l3 3-3 3M13 8H6" /></svg></a>
      </div>
    </nav>
  );
}
