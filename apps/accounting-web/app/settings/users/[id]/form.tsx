'use client';
// ฟอร์มแก้สิทธิ์ — design/project/ScreenUserEdit.dc.html (ช่องหลัก · ตารางพื้นที่ × การกระทำ · สรุปการเปลี่ยนแปลง · แถบล่าง)
import type { Action, Area, CompanyRole, Permissions } from '@innovera/auth';
import { Button, ButtonLink, css, money, parseThaiDate, S } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ACTION_LIST, AREA_LIST, countDiff, diff, overrideOf, roleBase, type RoleDefaults } from './perm';

interface Initial { role: CompanyRole; scope: string; approvalLimit: string; expires: string; require2fa: boolean; perms: Permissions }

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';
const HELP = 'font-size: 13px; color: #525252';
const CELL = 'padding: 0 12px'; // แบบร่างมี style ซ้ำสองชุดในช่องเดียว — เบราว์เซอร์ใช้ชุดแรก จึงคัดลอกชุดแรก
const CHECK = 'display: inline-flex; gap: 6px; align-items: center';
const ROW_LINE = 'display: flex; justify-content: space-between; gap: 8px';

const AREA_LABEL: Record<Area, string> = {
  sales: 'เอกสารขาย (QO/SO/IV/CN)', purchase: 'เอกสารซื้อและค่าใช้จ่าย (PR/PO/AP/EXP)', finance: 'การเงิน (RV/PV/เช็ค/เงินสดย่อย)', approve_pay: 'อนุมัติจ่าย',
  journal: 'บันทึกรายวัน / ผังบัญชี / สูตร', void: 'ยกเลิก / กลับรายการเอกสารที่ผ่านแล้ว', period: 'ปิดงวด / เปิดงวดคืน', reports: 'รายงานการเงิน / ส่งออก', settings: 'ตั้งค่า / ผู้ใช้ / แอปเชื่อมต่อ',
};
const ACTION_HEAD: Record<Action, string> = { read: 'อ่าน', write: 'สร้าง / แก้', post: 'ผ่านรายการ / อนุมัติ', void: 'ลบ / ยกเลิก' };
/** พื้นที่ที่ช่อง "ลบ / ยกเลิก" แสดง "ไม่มีในบทบาทนี้" เมื่อบทบาทไม่มีสิทธิ์นั้น (ตามแบบร่าง) */
const NO_VOID_TEXT = new Set<Area>(['void', 'period', 'settings']);

const limitNum = (v: string): string => (/^\d+(\.\d{1,2})?$/u.test(v) ? money(v.includes('.') ? v : `${v}.00`).replace(/\.00$/u, '') : v);

export function EditForm({ user, initial, roles, scopes, defaults, limits, others, usersHref }: {
  user: { id: string; name: string; who: string; mfa: boolean }; initial: Initial;
  roles: { value: CompanyRole; label: string }[]; scopes: { value: string; label: string }[];
  defaults: RoleDefaults; limits: Partial<Record<CompanyRole, Partial<Record<Area, string>>>>;
  others: { id: string; name: string; role: string }[]; usersHref: string;
}) {
  const router = useRouter();
  const [role, setRole] = useState<CompanyRole>(initial.role);
  const [scope, setScope] = useState(initial.scope);
  const [limit, setLimit] = useState(initial.approvalLimit);
  const [expires, setExpires] = useState(initial.expires);
  const [require2fa, setRequire2fa] = useState(initial.require2fa);
  const [perms, setPerms] = useState<Permissions>(initial.perms);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const label = (r: CompanyRole) => roles.find((x) => x.value === r)?.label ?? r;
  const base = roleBase(defaults, role);
  const d = useMemo(() => diff(defaults, role, perms), [defaults, role, perms]);
  const changes = (role !== initial.role ? 1 : 0) + (scope !== initial.scope ? 1 : 0) + (limit !== initial.approvalLimit ? 1 : 0)
    + (expires !== initial.expires ? 1 : 0) + (require2fa !== initial.require2fa ? 1 : 0) + countDiff(perms, initial.perms);

  function changeRole(r: CompanyRole) {
    setRole(r);
    if (r !== 'custom') setPerms(roleBase(defaults, r)); // เปลี่ยนบทบาท = เริ่มจากค่าของบทบาทใหม่ · "กำหนดเอง…" เริ่มจากสิทธิ์ที่ติ๊กอยู่
  }
  const toggle = (a: Area, x: Action, on: boolean) => setPerms({ ...perms, [a]: { ...perms[a], [x]: on } });

  /** ข้อความข้างช่องติ๊ก — ตำแหน่งตามแบบร่าง (แสดงคงที่ไม่ขึ้นกับการติ๊ก) · ช่องอื่นเป็นช่องติ๊กเปล่าพร้อม aria-label */
  function cellText(a: Area, x: Action): string | null {
    if (x === 'read') return a === 'approve_pay' || a === 'void' || a === 'settings' ? null : 'ดู';
    if (x === 'write') {
      if (a === 'reports') return 'ส่งออก';
      if (a === 'journal') return limits[role]?.journal ?? (role === 'owner' || role === 'accounting_manager' ? 'สร้าง/แก้ร่าง' : 'JV เท่านั้น');
      return a === 'sales' || a === 'purchase' || a === 'finance' ? 'สร้าง/แก้ร่าง' : null;
    }
    if (x === 'post') {
      if (a === 'approve_pay') return `วงเงิน ≤ ${limitNum(limit || '0')}`;
      return a === 'sales' || a === 'purchase' ? 'ผ่านรายการ' : null;
    }
    return null;
  }

  function cell(a: Area, x: Action) {
    const name = `${AREA_LABEL[a]} · ${ACTION_HEAD[x]}`;
    const on = perms[a][x] === true;
    if (x === 'void' && NO_VOID_TEXT.has(a) && base[a].void !== true && !on) return <td key={x} style={css('padding: 0 12px; color: #6f6f6f')}>ไม่มีในบทบาทนี้</td>;
    const box = <input type="checkbox" checked={on} aria-label={name} onChange={(e) => toggle(a, x, e.target.checked)} />;
    const text = cellText(a, x);
    return <td key={x} style={css(CELL)}>{text ? <label style={css(CHECK)}>{box} {text}</label> : box}</td>;
  }

  const permText = (list: [Area, Action][], sign: string) => list.map(([a, x]) => `${sign} ${ACTION_HEAD[x]}: ${AREA_LABEL[a]}`);

  async function save() {
    setMsg(null);
    const exp = expires.trim();
    let expiresAt: string | null = null;
    if (exp && exp !== 'ไม่จำกัด') {
      expiresAt = parseThaiDate(exp);
      if (!expiresAt) { setMsg('วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)'); return; }
    }
    setBusy(true);
    try {
      const res = await fetch(`/settings/users/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, scope, approvalLimit: limit.trim().replace(/,/gu, ''), expiresAt, require2fa, permissions: overrideOf(defaults, role, perms) }),
      });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(b.error ?? `HTTP ${res.status}`); return; }
      router.push(usersHref);
      router.refresh();
    } finally { setBusy(false); }
  }
  // TODO(M7): ScreenRevoke.dc.html (หน้ายืนยันเพิกถอน) ยังไม่สร้าง → ยืนยันด้วยกล่องของเบราว์เซอร์ก่อน
  async function revoke() {
    if (!window.confirm(`เพิกถอนการเข้าถึงบริษัทนี้ — ${user.name}`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/settings/users/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(b.error ?? `HTTP ${res.status}`); return; }
      router.push(usersHref);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <>
      <div style={css(S.contentForm)}>
        <div><h1 style={css(S.h1)}>แก้ไขสิทธิ์: {user.name}</h1><span style={css(S.sub)}>สิทธิ์เป็นของบริษัทนี้เท่านั้น · ผู้ใช้หนึ่งคนมีบทบาทต่างกันในแต่ละบริษัทได้</span></div>
        {msg && <div role="alert" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #da1e28; font-size: 14px')}>{msg}</div>}

        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css(LABEL)}>ผู้ใช้ (Innovera ID)<input value={user.who} readOnly style={css(INPUT)} /><span style={css(HELP)}>ชื่อและอีเมลแก้ได้ที่โปรไฟล์ Innovera ID ของผู้ใช้เอง</span></label>
              <label style={css(LABEL)}>บทบาทในบริษัทนี้<select value={role} onChange={(e) => changeRole(e.target.value as CompanyRole)} style={css(INPUT)}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
              <label style={css(LABEL)}>ขอบเขตข้อมูล (มิติ)<select value={scope} onChange={(e) => setScope(e.target.value)} style={css(INPUT)}>{scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}{!scopes.some((s) => s.value === scope) && <option value={scope}>{scope}</option>}</select></label>
              <label style={css(LABEL)}>วงเงินอนุมัติจ่าย<input value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /><span style={css(HELP)}>0 = จัดทำได้แต่อนุมัติไม่ได้</span></label>
              <label style={css(LABEL)}>เข้าถึงได้ถึงวันที่<input value={expires} onChange={(e) => setExpires(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /><span style={css(HELP)}>ตั้งวันสิ้นสุดสำหรับพนักงานชั่วคราว/ผู้สอบบัญชี</span></label>
              <label style={css(LABEL)}>บังคับ 2FA<select value={require2fa ? 'on' : 'off'} onChange={(e) => setRequire2fa(e.target.value === 'on')} style={css(INPUT)}><option value="on">บังคับ (ตามนโยบายบริษัท)</option><option value="off">ไม่บังคับ</option></select></label>
            </section>
            <section style={css(S.tableBox)}>
              <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center')}>
                <strong style={css('font-weight: 600')}>สิทธิ์รายละเอียด (เริ่มจากบทบาท {label(role)} — ปรับเฉพาะคนนี้ได้)</strong>
                <Button kind="ghost" size={32} extra="text-decoration: none" onClick={() => setPerms(roleBase(defaults, role))}>รีเซ็ตเป็นค่าของบทบาท</Button>
              </div>
              <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css(S.theadRow)}>
                  <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>พื้นที่</th>
                  <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>{ACTION_HEAD.read}</th>
                  <th style={css('padding: 0 12px; font-weight: 400; text-align: center')}>{ACTION_HEAD.write}</th>
                  <th style={css('padding: 0 12px; font-weight: 400; text-align: center')}>{ACTION_HEAD.post}</th>
                  <th style={css('padding: 0 12px; font-weight: 400; text-align: center')}>{ACTION_HEAD.void}</th>
                </tr></thead>
                <tbody>
                  {AREA_LIST.map((a) => (
                    <tr key={a} style={css(S.tr)}>
                      <td style={css('height: 40px; padding: 0 12px')}>{AREA_LABEL[a]}</td>
                      {ACTION_LIST.map((x) => cell(a, x))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section aria-live="polite" style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>สรุปการเปลี่ยนแปลง</strong>
              <div style={css(ROW_LINE)}><span>บทบาท</span>{role === initial.role ? <span>{label(role)} <span style={css('color: #525252')}>(ไม่เปลี่ยน)</span></span> : <span>{label(initial.role)} → {label(role)}</span>}</div>
              <div style={css(ROW_LINE)}><span>เพิ่มสิทธิ์</span>{d.added.length ? <span style={css('color: #0e6027; text-align: right')}>{permText(d.added, '+').map((t) => <span key={t} style={css('display: block')}>{t}</span>)}</span> : <span style={css('color: #525252')}>—</span>}</div>
              <div style={css(ROW_LINE)}><span>ลดสิทธิ์</span>{d.removed.length ? <span style={css('color: #a2191f; text-align: right')}>{permText(d.removed, '−').map((t) => <span key={t} style={css('display: block')}>{t}</span>)}</span> : <span style={css('color: #525252')}>—</span>}</div>
              <div style={css(ROW_LINE)}><span>2FA</span>{user.mfa ? <span style={css('color: #0e6027')}>✓</span> : <span style={css(require2fa ? 'color: #a2191f' : 'color: #525252')}>{require2fa ? 'ยังไม่เปิด — จะบังคับตั้งค่าเมื่อเข้าสู่ระบบครั้งถัดไป' : 'ยังไม่เปิด'}</span>}</div>
              <div style={css(ROW_LINE)}><span>มีผล</span><span style={css('color: #525252')}>ทันที · session ปัจจุบันจะรีเฟรชสิทธิ์</span></div>
            </section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>การแบ่งหน้าที่ (SoD) ที่ระบบเตือน</strong><span style={css('color: #525252')}>ผู้ที่ “สร้าง” เอกสารจ่ายไม่ควร “อนุมัติจ่าย” เอกสารเดียวกัน · ระบบยังอนุญาตให้ตั้งค่าได้ แต่จะบล็อกการอนุมัติเอกสารที่ตนเองสร้างและบันทึกใน Audit log</span></section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
              <strong>บริษัทอื่นที่ผู้ใช้นี้เข้าถึง</strong>
              {others.length
                ? others.map((o) => <div key={o.id} style={css('display: flex; justify-content: space-between; color: #525252')}><span>{o.name}</span><span>{o.role}</span></div>)
                : <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>—</span></div>}
              <span style={css('font-size: 13px; color: #525252')}>สิทธิ์กำหนดแยกต่อบริษัท · แก้ที่บริษัทนั้น</span>
            </section>
            <div><Button kind="danger" disabled={busy} onClick={() => void revoke()}>เพิกถอนการเข้าถึงบริษัทนี้</Button></div>
          </aside>
        </div>
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}>
        <span style={css('font-size: 13px; color: #525252')}>เปลี่ยน {changes} รายการ</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <ButtonLink href={usersHref}>ยกเลิก</ButtonLink>
          <Button kind="primary" disabled={busy} onClick={() => void save()}>บันทึกสิทธิ์</Button>
        </div>
      </div>
    </>
  );
}
