'use client';
// ผู้ใช้และสิทธิ์ — design/project/ScreenUsers.dc.html (แท็บ · ตารางผู้ใช้ · เมทริกซ์สิทธิ์ย่อ)
import { Button, css, parseThaiDate, S } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface UserRow { id: string; name: string; sub: string; role: string; scope: string; limit: string; mfa: boolean; lastUsed: string; action: 'none' | 'edit' | 'revoke'; muted: boolean }
export interface InviteRow { id: string; email: string; role: string; invited: string; expires: string }
type Tab = 'users' | 'roles' | 'approval' | 'invites';

const TAB = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 36px; padding: 0 16px; background: transparent; color: #0f62fe; border: 1px solid transparent';
const TH = 'padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';
const GRAY = 'padding: 0 12px; color: #525252';
const NUM = 'padding: 0 12px; font-variant-numeric: tabular-nums';
const LINK_RED = 'text-decoration: none; color: #da1e28; background: none; border: 0; padding: 0; font: inherit; cursor: pointer';
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';

function UsersHead() {
  return (
    <thead><tr style={css(S.theadRow)}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>ผู้ใช้</th><th style={css(TH)}>บทบาทในบริษัทนี้</th><th style={css(TH)}>ขอบเขต</th><th style={css(TH)}>วงเงินอนุมัติ</th><th style={css(TH)}>2FA</th><th style={css(TH)}>ใช้งานล่าสุด</th><th style={css(TH)}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การทำงาน</span></th></tr></thead>
  );
}

export function UsersView({ orgId, rows, invites, roleOptions, orgMembersHref, matrixHeads, matrix }: {
  orgId: string; rows: UserRow[]; invites: InviteRow[]; roleOptions: { value: string; label: string }[]; orgMembersHref: string;
  matrixHeads: string[]; matrix: { label: string; cells: (string | null)[] }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('users');
  const [invite, setInvite] = useState<null | 'member' | 'auditor'>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roleOptions[0]?.value ?? 'viewer');
  const [until, setUntil] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openInvite = (kind: 'member' | 'auditor') => { setInvite(kind); setMsg(null); setEmail(''); setUntil(''); setRole(kind === 'auditor' ? 'auditor' : (roleOptions[0]?.value ?? 'viewer')); };

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(b.error ?? `HTTP ${res.status}`); return false; }
      router.refresh();
      return true;
    } finally { setBusy(false); }
  }
  async function sendInvite() {
    let accessUntil: string | undefined;
    if (until.trim()) {
      const iso = parseThaiDate(until);
      if (!iso) { setMsg('วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)'); return; }
      accessUntil = iso;
    }
    const ok = await call('/settings/users/api/invites', 'POST', { orgId, email, role, kind: invite === 'auditor' ? 'auditor' : 'member', ...(accessUntil ? { accessUntil } : {}) });
    if (ok) { setInvite(null); setTab('invites'); }
  }
  // TODO(M7): ScreenRevoke.dc.html (หน้ายืนยันเพิกถอน) ยังไม่สร้าง → ยืนยันด้วยกล่องของเบราว์เซอร์ก่อน
  async function revoke(r: UserRow) { if (window.confirm(`เพิกถอนการเข้าถึงบริษัทนี้ — ${r.name}`)) await call(`/settings/users/api/users/${encodeURIComponent(r.id)}`, 'DELETE'); }
  async function cancelInvite(i: InviteRow) { if (window.confirm(`ยกเลิกคำเชิญ — ${i.email}`)) await call(`/settings/users/api/invites/${encodeURIComponent(i.id)}`, 'DELETE'); }

  const tabStyle = (t: Tab) => css(tab === t ? `${TAB}; border-bottom: 2px solid #0f62fe` : TAB);

  return (
    <>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
        <div><h1 style={css(S.h1)}>ผู้ใช้และสิทธิ์</h1><span style={css(S.sub)}>1 Innovera ID ใช้ได้หลายบริษัท (<a href={orgMembersHref} style={css('text-decoration: none')}>จัดการสมาชิกระดับองค์กร</a>) · สิทธิ์กำหนดต่อบริษัท · ผู้สอบบัญชีภายนอกเชิญแบบอ่านอย่างเดียวได้ไม่นับที่นั่ง</span></div>
        <div style={css('display: flex; gap: 8px')}>
          <Button size={36} onClick={() => openInvite('auditor')}>เชิญผู้สอบบัญชี</Button>
          <Button size={36} kind="primary" onClick={() => openInvite('member')}>+ เชิญผู้ใช้</Button>
        </div>
      </div>

      {/* TODO(Wei) T9: แบบร่างไม่มีฟอร์ม/กล่องเชิญผู้ใช้ — ใช้ช่องและป้ายจาก ScreenUserEdit (บทบาทในบริษัทนี้ · เข้าถึงได้ถึงวันที่) ในกล่องแบบเดียวกับตาราง */}
      {invite && (
        <section aria-label={invite === 'auditor' ? 'เชิญผู้สอบบัญชี' : 'เชิญผู้ใช้'} style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 16px 24px; align-items: end')}>
          <label style={css(LABEL)}>อีเมล<input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} style={css(INPUT)} /></label>
          <label style={css(LABEL)}>บทบาทในบริษัทนี้<select value={role} disabled={invite === 'auditor'} onChange={(e) => setRole(e.target.value)} style={css(INPUT)}>{roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label style={css(LABEL)}>เข้าถึงได้ถึงวันที่<input value={until} placeholder="ไม่จำกัด" onChange={(e) => setUntil(e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          <div style={css('display: flex; gap: 8px')}>
            <Button onClick={() => setInvite(null)}>ยกเลิก</Button>
            <Button kind="primary" disabled={busy || !email.trim()} onClick={() => void sendInvite()}>{invite === 'auditor' ? 'เชิญผู้สอบบัญชี' : '+ เชิญผู้ใช้'}</Button>
          </div>
        </section>
      )}
      {msg && <div role="alert" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #da1e28; font-size: 14px')}>{msg}</div>}

      <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <button type="button" role="tab" aria-selected={tab === 'users'} style={tabStyle('users')} onClick={() => setTab('users')}>ผู้ใช้ ({rows.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'roles'} style={tabStyle('roles')} onClick={() => setTab('roles')}>บทบาทและสิทธิ์</button>
        <button type="button" role="tab" aria-selected={tab === 'approval'} style={tabStyle('approval')} onClick={() => setTab('approval')}>สายอนุมัติ</button>
        <button type="button" role="tab" aria-selected={tab === 'invites'} style={tabStyle('invites')} onClick={() => setTab('invites')}>คำเชิญค้างอยู่ ({invites.length})</button>
      </div>

      {tab === 'users' && (
        <section style={css(S.tableBox)}>
          <table style={css('width: 100%; min-width: 960px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <UsersHead />
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={css(r.muted ? 'border-top: 1px solid #e0e0e0; color: #525252' : S.tr)}>
                  <td style={css('height: 48px; padding: 0 12px')}><div style={css(r.muted ? 'font-weight: 500; color: #161616' : 'font-weight: 500')}>{r.name}</div><div style={css(r.muted ? 'font-size: 13px' : 'font-size: 13px; color: #525252')}>{r.sub}</div></td>
                  <td style={css(TD)}>{r.role}</td>
                  <td style={css(r.muted ? TD : GRAY)}>{r.scope}</td>
                  <td style={css(r.muted ? TD : r.limit.startsWith('≤') ? NUM : GRAY)}>{r.limit}</td>
                  <td style={css(r.mfa ? 'padding: 0 12px; color: #0e6027' : 'padding: 0 12px; color: #a2191f')}>{r.mfa ? '✓' : 'ยังไม่เปิด'}</td>
                  <td style={css(r.muted ? TD : GRAY)}>{r.lastUsed}</td>
                  <td style={css(TD)}>
                    {r.action === 'edit' && <a href={`/settings/users/${encodeURIComponent(r.id)}`} style={css('text-decoration: none')}>แก้ไข</a>}
                    {r.action === 'revoke' && <button type="button" disabled={busy} onClick={() => void revoke(r)} style={css(LINK_RED)}>เพิกถอน</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'invites' && (
        // TODO(Wei): แบบร่างไม่มีเนื้อหาแท็บ "คำเชิญค้างอยู่" — ใช้ข้อความของแถวรอตอบรับจาก ScreenOrgMembers.dc.html
        <section style={css(S.tableBox)}>
          <table style={css('width: 100%; min-width: 960px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <UsersHead />
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} style={css(S.tr)}>
                  <td style={css('height: 48px; padding: 0 12px')}><div style={css('font-weight: 500')}>{i.email}</div><div style={css('font-size: 13px; color: #525252')}>— (ยังไม่ตอบรับ)</div></td>
                  <td style={css(TD)}>{i.role} (รอ)</td>
                  <td style={css(GRAY)}>บริษัทนี้</td>
                  <td style={css(GRAY)}>—</td>
                  <td style={css(TD)}><span style={css('display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; background: #edf5ff; color: #0043ce; font-size: 13px; font-weight: 500')}><span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')} />รอตอบรับ</span></td>
                  <td style={css(GRAY)}>เชิญ {i.invited} · หมด {i.expires}</td>
                  <td style={css(TD)}><button type="button" disabled={busy} onClick={() => void cancelInvite(i)} style={css(LINK_RED)}>ยกเลิกคำเชิญ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'approval' && (
        // TODO(Wei): แบบร่างไม่มีเนื้อหาแท็บ "สายอนุมัติ"
        <p style={css(S.note)}>หน้านี้ยังไม่เปิดใช้</p>
      )}

      {(tab === 'users' || tab === 'roles') && (
        <section style={css(S.tableBox)}>
          <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center')}>
            <strong style={css('font-weight: 600')}>เมทริกซ์สิทธิ์ (ย่อ) — บทบาทมาตรฐานแก้ไขได้ หรือสร้างบทบาทใหม่</strong>
            {/* TODO(Wei): แบบร่างไม่มีหน้าสร้าง/แก้บทบาทมาตรฐาน — ปัจจุบันปรับสิทธิ์ได้รายคนที่ ScreenUserEdit ("กำหนดเอง…") */}
            <Button size={32}>+ บทบาทใหม่</Button>
          </div>
          <table style={css('width: 100%; min-width: 880px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css(S.theadRow)}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>สิทธิ์</th>{matrixHeads.map((h) => <th key={h} style={css('padding: 0 12px; font-weight: 400; text-align: center')}>{h}</th>)}</tr></thead>
            <tbody>
              {matrix.map((m) => (
                <tr key={m.label} style={css(S.tr)}>
                  <td style={css('height: 36px; padding: 0 12px')}>{m.label}</td>
                  {m.cells.map((c, i) => <td key={matrixHeads[i]} style={css(c ? 'text-align: center' : 'text-align: center; color: #c6c6c6')}>{c ?? '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
