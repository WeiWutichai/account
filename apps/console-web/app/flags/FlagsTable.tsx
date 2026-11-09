'use client';
// ตาราง Feature flags ← design/project/ConsoleFlags.dc.html · ค่าจริงจาก GET /console/v1/flags · แก้ไข = POST flags (engineer/admin · บันทึก audit_console)
import { css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../lib/client';
import type { Flag } from '../lib/data';
import { B, DASH, P2, ST, Tabs, Tag } from '../ui';

// รายการ flag และคำอธิบายตามแบบร่าง (ข้อกำหนดสินค้า ไม่ใช่ตัวเลขตัวอย่าง) · flag อื่นที่มีในฐานข้อมูลต่อท้าย
const CATALOG: { key: string; desc: string; p2?: boolean }[] = [
  { key: 'mcp_connector', desc: 'การเชื่อมต่อ AI ผ่าน MCP (documents:draft เท่านั้น)' },
  { key: 'stock_v2', desc: 'โมดูลสินค้าคงคลัง (v2)' },
  { key: 'etax_provider_b', desc: 'ผู้ให้บริการ e-Tax รายที่ 2 (สำรอง)' },
  { key: 'report_builder_18col', desc: 'ตัวสร้างรูปแบบงบ 18 คอลัมน์' },
  { key: 'bank_feed_openapi', desc: 'ดึง statement อัตโนมัติจากธนาคาร' },
  { key: 'period13', desc: 'งวดที่ 13 ปรับปรุงปิดปี' },
  { key: 'subscription_billing', desc: 'เก็บเงินในระบบ เกตเวย์ dunning', p2: true },
  { key: 'maintenance_banner', desc: 'ประกาศปิดปรับปรุงบนทุกหน้า' },
];
const on = (v: unknown) => v === true || v === 'on';

export function FlagsTable({ flags, orgs, canEdit }: { flags: Flag[]; orgs: number; canEdit: boolean }) {
  const router = useRouter();
  const keys = [...CATALOG, ...[...new Set(flags.map((f) => f.key))].filter((k) => !CATALOG.some((c) => c.key === k)).map((key) => ({ key, desc: DASH, p2: false }))];
  const [edit, setEdit] = useState<string | null>(null);
  const [scope, setScope] = useState<'global' | 'org' | 'company'>('global');
  const [target, setTarget] = useState('');
  const [value, setValue] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (key: string) => {
    setBusy(true); setErr('');
    try {
      await api('flags', 'POST', { key, scope, ...(scope === 'global' ? {} : { targetId: target.trim() }), value });
      setEdit(null);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <>
      {/* TODO(Wei): แท็บ "แอปในแพลตฟอร์ม" / "เวอร์ชันและการปล่อย" ไม่มีเนื้อหาในแบบร่าง */}
      <Tabs selected={0} tabs={[`Feature flags (${keys.length})`, 'แอปในแพลตฟอร์ม', 'เวอร์ชันและการปล่อย']} />
      <section style={css(ST.tableBox)}><table style={css(ST.table(1100))}>
        <thead><tr style={css(ST.theadRow)}>{['Flag', 'คำอธิบาย', 'ค่าเริ่มต้น', 'การปล่อย', 'องค์กรที่เปิด', 'เจ้าของ', ''].map((h, i) => <th key={i} style={css(ST.th)}>{h}</th>)}</tr></thead>
        <tbody>
          {keys.map((k) => {
            const rows = flags.filter((f) => f.key === k.key);
            const g = rows.find((f) => f.scope === 'global');
            const orgOn = rows.filter((f) => f.scope === 'org' && on(f.value)).length;
            return (
              <tr key={k.key} style={css(ST.tr)}>
                <td style={css(ST.td1)}><code>{k.key}</code>{k.p2 && <> <P2 /></>}</td>
                <td style={css(ST.td)}>{k.desc}</td>
                <td style={css(ST.td)}>{g ? <Tag tone={on(g.value) ? 'success' : 'neutral'}>{on(g.value) ? 'เปิด' : 'ปิด'}</Tag> : DASH}</td>
                {/* TODO(backend): ขั้นการปล่อยและเจ้าของ flag ไม่มีในตาราง feature_flag */}
                <td style={css(ST.td)}>{DASH}</td>
                <td style={css(ST.td)}>{orgOn} / {orgs}</td>
                <td style={css(ST.td)}>{DASH}</td>
                <td style={css(ST.td)}>
                  {/* TODO(Wei): ฟอร์มแก้ไข flag ไม่มีในแบบร่าง — ใช้ฟอร์มย่อในแถว (ขอบเขต · องค์กร/บริษัท · ค่า) */}
                  <button type="button" disabled={!canEdit} onClick={() => { setEdit(edit === k.key ? null : k.key); setScope('global'); setTarget(''); setValue(!(g && on(g.value))); setErr(''); }} style={css(B.ghostSm)}>แก้ไข</button>
                </td>
              </tr>
            );
          }).flatMap((row, i) => {
            const k = keys[i]!;
            if (edit !== k.key) return [row];
            return [row, (
              <tr key={`${k.key}-edit`} style={css('border-top: 1px solid #e0e0e0; background: #f4f4f4')}>
                <td colSpan={7} style={css('padding: 12px')}>
                  <div style={css('display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap')}>
                    <label style={css(ST.label)}>ขอบเขต<select value={scope} onChange={(e) => setScope(e.target.value as 'global' | 'org' | 'company')} style={css(`${ST.input}; background: #ffffff`)}><option value="global">ทั้งระบบ</option><option value="org">องค์กร</option><option value="company">บริษัท</option></select></label>
                    {scope !== 'global' && <label style={css(ST.label)}>{scope === 'org' ? 'org_id' : 'company_id'}<input value={target} onChange={(e) => setTarget(e.target.value)} style={css(`${ST.input}; background: #ffffff; width: 340px`)} /></label>}
                    <label style={css(ST.label)}>ค่า<select value={value ? 'on' : 'off'} onChange={(e) => setValue(e.target.value === 'on')} style={css(`${ST.input}; background: #ffffff`)}><option value="on">เปิด</option><option value="off">ปิด</option></select></label>
                    <button type="button" onClick={() => setEdit(null)} style={css(B.secondary)}>ยกเลิก</button>
                    <button type="button" disabled={busy} onClick={() => save(k.key)} style={css(B.primary)}>บันทึก</button>
                  </div>
                  {err && <p role="alert" style={css('margin: 8px 0 0; color: #a2191f; font-size: 14px')}>{err}</p>}
                </td>
              </tr>
            )];
          })}
        </tbody>
      </table></section>
    </>
  );
}
