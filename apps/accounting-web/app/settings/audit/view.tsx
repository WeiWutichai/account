'use client';
// G4 ประวัติการใช้งาน — design/project/ScreenAudit.dc.html (ตัวกรอง · ตาราง · แบ่งหน้า · หมายเหตุ hash chain)
import { css, parseThaiDate } from '@innovera/ui';
import { useMemo, useState } from 'react';
import type { AuditVerify } from '../apps/_shared/hub.ts';
import { BTN32, BTN_OFF, TAG, TAG_TONE } from '../apps/_shared/hub.ts';

export interface AuditItem {
  id: string; date: string; time: string; actor: string; label: string; tone: keyof typeof TAG_TONE; cat: string; important: boolean;
  target: string; detail: string; channel: string; hash: string; prevHash: string;
}

const TH = 'padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';
const FILTER = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';
const PAGE = 50;
/** ตัวเลือก "ทุกประเภท" ตามแบบร่าง → หมวดของการกระทำ (page.tsx) */
const TYPES: { label: string; cat: string | null }[] = [
  { label: 'ทุกประเภท', cat: null }, { label: 'เอกสาร', cat: 'document' }, { label: 'รายการบัญชี', cat: 'journal' }, { label: 'งวด / ปิดงวด', cat: 'period' },
  { label: 'ผู้ใช้และสิทธิ์', cat: 'user' }, { label: 'ตั้งค่า', cat: 'settings' }, { label: 'API / แอปเชื่อมต่อ', cat: 'api' }, { label: 'เข้าสู่ระบบ', cat: 'login' },
];

function range(text: string): [string, string] | null {
  const [a, b] = text.split(/\s*[–-]\s*/u);
  const from = a ? parseThaiDate(a.trim()) : null;
  const to = b ? parseThaiDate(b.trim()) : null;
  return from && to ? [from, to] : null;
}
const csvCell = (s: string) => `"${s.replace(/"/gu, '""')}"`;

export function AuditView({ items, verify, error, defaultRange }: { items: AuditItem[]; verify: AuditVerify | null; error: string | null; defaultRange: string }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('ทุกประเภท');
  const [actor, setActor] = useState('ทุกคน');
  const [dates, setDates] = useState(defaultRange);
  const [important, setImportant] = useState(true);
  const [page, setPage] = useState(0);
  const actors = useMemo(() => [...new Set(items.map((i) => i.actor))], [items]);

  const shown = useMemo(() => {
    const cat = TYPES.find((t) => t.label === type)?.cat ?? null;
    const r = range(dates);
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (!cat || i.cat === cat) && (actor === 'ทุกคน' || i.actor === actor) && (!important || i.important)
      && (!r || (i.date >= r[0] && i.date <= r[1]))
      && (!needle || `${i.actor} ${i.label} ${i.target} ${i.detail}`.toLowerCase().includes(needle)));
  }, [items, q, type, actor, dates, important]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * PAGE, cur * PAGE + PAGE);

  function exportCsv() {
    // TODO(Wei/backend): "ลงนาม" ในแบบร่าง = ลายเซ็นดิจิทัล ยังไม่มี → ใส่ hash/prev_hash ของ chain ให้ผู้สอบบัญชีตรวจต่อได้
    const head = ['เวลา', 'ผู้กระทำ', 'การกระทำ', 'เป้าหมาย', 'รายละเอียด (เดิม → ใหม่)', 'ช่องทาง', 'hash', 'prev_hash'];
    const lines = [head, ...shown.map((i) => [`${i.date} ${i.time.slice(6)}`, i.actor, i.label, i.target, i.detail, i.channel, i.hash, i.prevHash])].map((r) => r.map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'audit-log.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ตั้งค่า / ประวัติการใช้งาน</span>
        <button type="button" onClick={exportCsv} style={css(BTN32)}>ส่งออก CSV (ลงนาม)</button>
      </header>
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ประวัติการใช้งาน</h1><span style={css('font-size: 13px; color: #525252')}>บันทึกทุกการสร้าง แก้ไข ผ่านรายการ ยกเลิก เปิดงวด เปลี่ยนสิทธิ์ และการเข้าถึง API · แก้ไขหรือลบไม่ได้ · เก็บตลอดอายุบริษัท</span></div>
        {error && <div role="alert" style={css('font-size: 14px; color: #a2191f')}>{error}</div>}
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
          <input aria-label="ค้นหา" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="ค้นหาเลขเอกสาร / ผู้ใช้ / ค่าเดิม-ใหม่" style={css(`${FILTER}; width: 320px`)} />
          <select aria-label="ประเภท" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} style={css(FILTER)}>{TYPES.map((t) => <option key={t.label}>{t.label}</option>)}</select>
          {/* ตัวเลือกผู้กระทำ = คนที่มีในบันทึก (แบบร่างแสดงชื่อตัวอย่าง) */}
          <select aria-label="ผู้กระทำ" value={actor} onChange={(e) => { setActor(e.target.value); setPage(0); }} style={css(FILTER)}><option>ทุกคน</option>{actors.map((a) => <option key={a}>{a}</option>)}</select>
          <input aria-label="ช่วงวันที่" value={dates} onChange={(e) => { setDates(e.target.value); setPage(0); }} style={css(`${FILTER}; width: 200px; font-variant-numeric: tabular-nums`)} />
          <label style={css('display: flex; align-items: center; gap: 8px')}><input type="checkbox" checked={important} onChange={(e) => { setImportant(e.target.checked); setPage(0); }} /> เฉพาะเหตุการณ์สำคัญ</label>
        </div>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 1080px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เวลา</th><th style={css(TH)}>ผู้กระทำ</th><th style={css(TH)}>การกระทำ</th><th style={css(TH)}>เป้าหมาย</th><th style={css(TH)}>รายละเอียด (เดิม → ใหม่)</th><th style={css(TH)}>ช่องทาง</th></tr></thead>
            <tbody>
              {slice.map((i) => (
                <tr key={i.id} data-testid="audit-row" style={css('border-top: 1px solid #e0e0e0')}>
                  <td title={i.hash ? `hash ${i.hash}` : undefined} style={css('height: 44px; padding: 0 12px; font-variant-numeric: tabular-nums; white-space: nowrap')}>{i.time}</td>
                  <td style={css(TD)}>{i.actor}</td>
                  <td style={css(TD)}><span style={css(`${TAG}; ${TAG_TONE[i.tone]}`)}>{i.label}</span></td>
                  <td style={css(TD)}>{i.target}</td>
                  <td style={css(TD)}>{i.detail}</td>
                  <td style={css('padding: 0 12px; color: #525252')}>{i.channel}</td>
                </tr>
              ))}
              {!slice.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={6} style={css('height: 44px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
          </table>
          <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>
            {/* TODO(backend): GET /v1/audit คืน 200 รายการล่าสุด ไม่มีจำนวนทั้งหมด/แบ่งหน้าฝั่ง server → นับจากที่โหลดมา */}
            <span>แสดง {slice.length} จาก {shown.length.toLocaleString('en-US')} เหตุการณ์ในช่วงที่เลือก</span>
            <div style={css('display: flex; gap: 8px')}>
              <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)} style={css(`${BTN32}${cur === 0 ? `; ${BTN_OFF}` : ''}`)}>ก่อนหน้า</button>
              <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} style={css(`${BTN32}${cur >= pages - 1 ? `; ${BTN_OFF}` : ''}`)}>ถัดไป</button>
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
