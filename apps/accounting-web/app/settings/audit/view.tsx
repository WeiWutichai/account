'use client';
// G4 ประวัติการใช้งาน — design/project/ScreenAudit.dc.html (ตัวกรอง · ตาราง · แบ่งหน้า · หมายเหตุ hash chain)
// ตัวกรอง/หน้าอยู่ใน URL → page.tsx ดึงจาก GET /v1/audit (แบ่งหน้าฝั่ง server)
import { css, parseThaiDate, thaiDate } from '@innovera/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AuditPage, AuditVerify } from '../apps/_shared/hub.ts';
import { BTN32, BTN_OFF, send, TAG, TAG_TONE } from '../apps/_shared/hub.ts';
import { AUDIT_PAGE, toAuditItem, type AuditItem } from './format';

export interface AuditFilters { q: string; type: string; actor: string; from: string; to: string; important: boolean }

const TH = 'padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';
const FILTER = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';
const BADGE = 'display: inline-block; padding: 0 6px; background: #393939; color: #ffffff; font-size: 11px; line-height: 18px; border-radius: 4px';
/** ตัวเลือก "ทุกประเภท" ตามแบบร่าง → หมวดของ GET /v1/audit?category= (packages/db/src/hub.ts AUDIT_CATEGORIES) */
const TYPES: { label: string; cat: string }[] = [
  { label: 'ทุกประเภท', cat: '' }, { label: 'เอกสาร', cat: 'document' }, { label: 'รายการบัญชี', cat: 'journal' }, { label: 'งวด / ปิดงวด', cat: 'period' },
  { label: 'ผู้ใช้และสิทธิ์', cat: 'user' }, { label: 'ตั้งค่า', cat: 'settings' }, { label: 'API / แอปเชื่อมต่อ', cat: 'api' }, { label: 'เข้าสู่ระบบ', cat: 'login' },
];

function range(text: string): [string, string] | null {
  const [a, b] = text.split(/\s*[–-]\s*/u);
  const from = a ? parseThaiDate(a.trim()) : null;
  const to = b ? parseThaiDate(b.trim()) : null;
  return from && to ? [from, to] : null;
}
const csvCell = (s: string) => `"${s.replace(/"/gu, '""')}"`;

export function AuditView({ items, count, actors, page, filters: f, verify, error }: {
  items: AuditItem[]; count: number; actors: { id: string; name: string }[]; page: number; filters: AuditFilters; verify: AuditVerify | null; error: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(f.q);
  const [dates, setDates] = useState(`${thaiDate(f.from)} – ${thaiDate(f.to)}`);
  const [msg, setMsg] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(count / AUDIT_PAGE));

  function go(patch: Partial<AuditFilters> & { page?: number }) {
    const n = { ...f, ...patch };
    const p = new URLSearchParams();
    if (n.q) p.set('q', n.q);
    if (n.type) p.set('type', n.type);
    if (n.actor) p.set('actor', n.actor);
    p.set('from', n.from);
    p.set('to', n.to);
    if (!n.important) p.set('important', '0');
    if (patch.page) p.set('page', String(patch.page));
    router.push(`${path}?${p}`);
  }
  function applyDates() {
    const r = range(dates);
    if (r && (r[0] !== f.from || r[1] !== f.to)) go({ from: r[0], to: r[1] });
  }

  async function exportCsv() {
    // TODO(Wei/backend): "ลงนาม" ในแบบร่าง = ลายเซ็นดิจิทัล ยังไม่มี → ใส่ hash/prev_hash ของ chain ให้ผู้สอบบัญชีตรวจต่อได้
    setMsg(null);
    const all: AuditItem[] = [];
    for (let offset = 0; offset < count; offset += 1000) {
      const qs = new URLSearchParams({ limit: '1000', offset: String(offset), from: f.from, to: f.to, ...(f.important ? { important: '1' } : {}),
        ...(f.type ? { category: f.type } : {}), ...(f.actor ? { actor: f.actor } : {}), ...(f.q ? { q: f.q } : {}) });
      const r = await send<AuditPage>(`/api/proxy/audit?${qs}`, 'GET');
      if (!r.ok) { setMsg(r.error); return; }
      all.push(...r.data.rows.map(toAuditItem));
    }
    const head = ['เวลา', 'ผู้กระทำ', 'การกระทำ', 'เป้าหมาย', 'รายละเอียด (เดิม → ใหม่)', 'ช่องทาง', 'IP', 'hash', 'prev_hash'];
    const lines = [head, ...all.map((i) => [`${i.date} ${i.time.slice(6)}`, i.actorBadge ? `${i.actorBadge} ${i.actor}` : i.actor, i.label, i.target, i.detail, i.channel, i.ip, i.hash, i.prevHash])]
      .map((r) => r.map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'audit-log.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ตั้งค่า / ประวัติการใช้งาน</span>
        <button type="button" onClick={() => void exportCsv()} style={css(BTN32)}>ส่งออก CSV (ลงนาม)</button>
      </header>
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ประวัติการใช้งาน</h1><span style={css('font-size: 13px; color: #525252')}>บันทึกทุกการสร้าง แก้ไข ผ่านรายการ ยกเลิก เปิดงวด เปลี่ยนสิทธิ์ และการเข้าถึง API · แก้ไขหรือลบไม่ได้ · เก็บตลอดอายุบริษัท</span></div>
        {(error ?? msg) && <div role="alert" style={css('font-size: 14px; color: #a2191f')}>{error ?? msg}</div>}
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
          <input aria-label="ค้นหา" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (q.trim() !== f.q) go({ q: q.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') go({ q: q.trim() }); }} placeholder="ค้นหาเลขเอกสาร / ผู้ใช้ / ค่าเดิม-ใหม่" style={css(`${FILTER}; width: 320px`)} />
          <select aria-label="ประเภท" value={f.type} onChange={(e) => go({ type: e.target.value })} style={css(FILTER)}>{TYPES.map((t) => <option key={t.label} value={t.cat}>{t.label}</option>)}</select>
          {/* ตัวเลือกผู้กระทำ = คนที่มีในบันทึกตามตัวกรอง (แบบร่างแสดงชื่อตัวอย่าง) */}
          <select aria-label="ผู้กระทำ" value={f.actor} onChange={(e) => go({ actor: e.target.value })} style={css(FILTER)}><option value="">ทุกคน</option>{actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input aria-label="ช่วงวันที่" value={dates} onChange={(e) => setDates(e.target.value)} onBlur={applyDates} onKeyDown={(e) => { if (e.key === 'Enter') applyDates(); }}
            style={css(`${FILTER}; width: 200px; font-variant-numeric: tabular-nums`)} />
          <label style={css('display: flex; align-items: center; gap: 8px')}><input type="checkbox" checked={f.important} onChange={(e) => go({ important: e.target.checked })} /> เฉพาะเหตุการณ์สำคัญ</label>
        </div>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 1080px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เวลา</th><th style={css(TH)}>ผู้กระทำ</th><th style={css(TH)}>การกระทำ</th><th style={css(TH)}>เป้าหมาย</th><th style={css(TH)}>รายละเอียด (เดิม → ใหม่)</th><th style={css(TH)}>ช่องทาง</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} data-testid="audit-row" style={css('border-top: 1px solid #e0e0e0')}>
                  <td title={i.hash ? `hash ${i.hash}` : undefined} style={css('height: 44px; padding: 0 12px; font-variant-numeric: tabular-nums; white-space: nowrap')}>{i.time}</td>
                  <td style={css(TD)}>{i.actorBadge && <span style={css(BADGE)}>{i.actorBadge}</span>}{i.actorBadge ? ` ${i.actor}` : i.actor}</td>
                  <td style={css(TD)}><span style={css(`${TAG}; ${TAG_TONE[i.tone]}`)}>{i.label}</span></td>
                  <td style={css(TD)}>{i.target}</td>
                  <td style={css(TD)}>{i.detail}</td>
                  <td title={i.ip ? `IP ${i.ip}` : undefined} style={css('padding: 0 12px; color: #525252')}>{i.channel}</td>
                </tr>
              ))}
              {!items.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={6} style={css('height: 44px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
          </table>
          <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>
            <span>แสดง {items.length} จาก {count.toLocaleString('en-US')} เหตุการณ์ในช่วงที่เลือก</span>
            <div style={css('display: flex; gap: 8px')}>
              <button type="button" disabled={page === 0} onClick={() => go({ page: page - 1 })} style={css(`${BTN32}${page === 0 ? `; ${BTN_OFF}` : ''}`)}>ก่อนหน้า</button>
              <button type="button" disabled={page >= pages - 1} onClick={() => go({ page: page + 1 })} style={css(`${BTN32}${page >= pages - 1 ? `; ${BTN_OFF}` : ''}`)}>ถัดไป</button>
            </div>
          </div>
        </section>
        <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; padding: 12px 16px; font-size: 13px; color: #525252; max-width: 880px')}>
          {/* TODO(Wei): ผลตรวจ hash chain ไม่มีในแบบร่าง (มีแค่คำอธิบายนี้) — แสดงเป็นป้ายหน้าข้อความ */}
          {verify && (
            <span data-testid="audit-verify" style={css(`${TAG}; ${verify.ok ? TAG_TONE.success : TAG_TONE.error}; margin-right: 8px`)}>
              {verify.ok ? `ตรวจ hash chain แล้ว: ถูกต้อง · ${verify.rows.toLocaleString('en-US')} เหตุการณ์` : `ตรวจ hash chain: ไม่ต่อเนื่องที่เหตุการณ์ #${verify.brokenAt ?? '—'}`}
            </span>
          )}
          ทุกเหตุการณ์เก็บ hash ต่อเนื่อง (chain) เพื่อพิสูจน์ว่าไม่ถูกแก้ไขย้อนหลัง · ผู้สอบบัญชีดาวน์โหลดพร้อมลายเซ็นดิจิทัลได้จาก Audit pack · รายการที่ต้องให้เหตุผล: เปิดงวดคืน ยกเลิกเอกสารที่ผ่านแล้ว แก้สูตรลงบัญชี เปลี่ยนสิทธิ์
        </section>
      </div>
    </>
  );
}
