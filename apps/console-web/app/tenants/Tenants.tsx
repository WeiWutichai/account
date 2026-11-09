'use client';
// ตาราง + ตัวกรอง + รายละเอียดองค์กร ← design/project/ConsoleTenants.dc.html (ลำดับและข้อความตามแบบร่าง)
import { css } from '@innovera/ui';
import { useMemo, useState } from 'react';
import type { Flag, Tenant } from '../lib/data';
import { ddmm, lastActive, monthYear, shortId } from '../lib/format';
import { nearLimit, planLabel, signal } from '../lib/rules';
import { B, Card, DASH, Inert, Note, Row, ST, Stat, Stats, Tag } from '../ui';

const STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'canceled'];
const lim = (n: number | null) => (n === null ? '∞' : String(n));

function planStatus(t: Tenant): string {
  if (!t.plan_code) return DASH;
  const trial = t.status === 'trialing' && t.trial_ends_at ? `trialing (หมด ${ddmm(t.trial_ends_at)})` : (t.status ?? DASH);
  return `${planLabel(t.plan_code)} · ${trial}`;
}

function csv(rows: Tenant[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const head = ['org_id', 'name', 'created_at', 'plan', 'status', 'companies', 'company_limit', 'seats', 'seat_limit', 'last_active'];
  return [head.join(','), ...rows.map((t) => [t.id, t.name, t.created_at, t.plan_code, t.status, t.companies, t.company_limit, t.seats, t.seat_limit, t.last_active].map(q).join(','))].join('\n');
}

export function Tenants({ tenants, flags, initial, nowIso }: { tenants: Tenant[]; flags: Flag[]; initial: string | null; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [near, setNear] = useState(false);
  const [sel, setSel] = useState<string | null>(initial ?? tenants[0]?.id ?? null);

  // TODO(backend): ค้นหาด้วยเลขผู้เสียภาษี / อีเมล Owner ต้องมีฟิลด์จาก API — ตอนนี้ค้นชื่อองค์กรและ org_id ในเครื่อง
  // TODO(backend): ตัวกรอง "ทุกแอป" ต้องมี entitlement ต่อองค์กร — ยังไม่กรอง
  const rows = tenants.filter((t) => (!q || t.name.toLowerCase().includes(q.toLowerCase()) || t.id.includes(q.toLowerCase()))
    && (!plan || t.plan_code === plan) && (!status || t.status === status) && (!near || nearLimit(t)));
  const by = (s: string) => tenants.filter((t) => t.status === s).length;
  const t = tenants.find((x) => x.id === sel);
  const orgFlags = t ? flags.filter((f) => f.target_id === t.id) : [];

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([`﻿${csv(rows)}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'tenants.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  const pick = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); setSel(id); window.history.replaceState(null, '', `/tenants?org=${id}`); };

  return (
    <div style={css(ST.content)}>
      {/* TODO(Wei): แบบร่างเขียน "(schema-per-company)" แต่ ADR-001 = ตารางรวม + company_id + RLS → แสดงตาม ADR */}
      <div><h1 style={css(ST.h1)}>องค์กรลูกค้า (tenants)</h1><span style={css(ST.sub)}>ค้นหา กรอง และดูรายละเอียดระดับองค์กร · 1 องค์กร = 1 subscription · หลายบริษัท (ตารางรวม + RLS) · Enterprise ใช้ DB แยก</span></div>
      <Stats>
        <Stat label="องค์กร" value={tenants.length} />
        <Stat label="active" value={by('active')} color="#0e6027" />
        <Stat label="trialing" value={by('trialing')} />
        <Stat label="past_due / suspended" value={`${by('past_due')} / ${by('suspended')}`} color="#a2191f" />
        {/* TODO(backend): "DB แยก" ต้องมี company.db_dsn — นับจากแผน enterprise แทนชั่วคราว */}
        <Stat label="Enterprise (DB แยก)" value={tenants.filter((x) => x.plan_code === 'enterprise').length} />
      </Stats>
      <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
        <input aria-label="ค้นหาองค์กร" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อองค์กร / org_id / เลขผู้เสียภาษี / อีเมล Owner" style={css(`${ST.filter}; width: 380px`)} />
        <select aria-label="แผน" value={plan} onChange={(e) => setPlan(e.target.value)} style={css(ST.filter)}><option value="">ทุกแผน</option><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option></select>
        <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)} style={css(ST.filter)}><option value="">ทุกสถานะ</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select aria-label="แอป" style={css(ST.filter)}><option>ทุกแอป</option><option>บัญชี</option><option>TMS</option></select>
        <label style={css('display: flex; align-items: center; gap: 8px')}><input type="checkbox" checked={near} onChange={(e) => setNear(e.target.checked)} /> ใกล้ลิมิต ≥ 90%</label>
        <div style={css('margin-left: auto; display: flex; gap: 8px')}>
          <button type="button" onClick={exportCsv} style={css(B.secondary)}>ส่งออก CSV</button>
          {/* TODO(backend): ยังไม่มี endpoint สร้างองค์กรจาก Console */}
          <Inert kind="primary">+ สร้างองค์กรให้ลูกค้า</Inert>
        </div>
      </div>
      <section style={css(ST.tableBox)}><table style={css(ST.table(1180))}>
        <thead><tr style={css(ST.theadRow)}>{['องค์กร', 'บริษัท', 'ที่นั่ง', 'แอป', 'แผน · สถานะ', 'สัญญาณ', 'ใช้ล่าสุด', 'ที่เก็บข้อมูล'].map((h) => <th key={h} style={css(ST.th)}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((x) => {
            const s = signal(x, now);
            return (
              <tr key={x.id} style={css(ST.tr)}>
                <td style={css(ST.td1)}><a href={`/tenants?org=${x.id}`} onClick={pick(x.id)} aria-current={x.id === sel ? 'true' : undefined} style={css('text-decoration: none; font-weight: 500')}>{x.name}</a><div style={css('font-size: 13px; color: #525252')}>{shortId(x.id)} · สมัคร {monthYear(x.created_at)}</div></td>
                <td style={css(ST.td)}>{x.companies} / {lim(x.company_limit)}</td>
                <td style={css(ST.td)}>{x.seats} / {lim(x.seat_limit)}</td>
                {/* TODO(backend): แอปที่เปิดต่อองค์กร (entitlement) และที่เก็บข้อมูล (company id / db_dsn) ยังไม่มีใน GET tenants */}
                <td style={css(ST.td)}>{DASH}</td>
                <td style={css(ST.td)}>{planStatus(x)}</td>
                <td style={css(ST.td)}><Tag tone={s.tone}>{s.label}</Tag></td>
                <td style={css(ST.td)}>{lastActive(x.last_active, now)}</td>
                <td style={css(ST.td)}>{DASH}</td>
              </tr>
            );
          })}
          {!rows.length && <tr style={css(ST.tr)}><td colSpan={8} style={css(ST.td1)}>{DASH}</td></tr>}
        </tbody>
      </table></section>
      {t && (
        <div style={css(ST.split)}>
          <section style={css('border: 1px solid #0f62fe; display: flex; flex-direction: column')}>
            <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; background: #edf5ff')}>
              <strong style={css('font-weight: 600')}>รายละเอียด: {t.name}</strong>
              <div style={css('display: flex; gap: 8px')}>
                {/* TODO(Wei): ConsoleSupport.dc.html ไม่มีฟอร์มเปิด ticket — ลิงก์ไปหน้า Support พร้อม org */}
                <a href={`/support?org=${t.id}`} style={css(B.secondarySm)}>เปิด Support ticket</a>
                <a href="/billing" style={css(B.secondarySm)}>ปรับลิมิต</a>
              </div>
            </div>
            {/* TODO(backend): Owner, Billing contact, ชื่อบริษัท, แอป, การใช้งาน, ปริมาณข้อมูล, ที่เก็บข้อมูล, สำรองล่าสุด, ความปลอดภัย — ยังไม่มีใน API */}
            <div style={css('padding: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; font-size: 14px')}>
              <Row left="Owner" right={DASH} color="#161616" /><Row left="Billing contact" right={DASH} color="#161616" />
              <Row left="บริษัท" right={`${t.companies}`} color="#161616" /><Row left="ที่นั่ง" right={`${t.seats}/${lim(t.seat_limit)} · Guest ${DASH}`} color="#161616" />
              <Row left="แอป" right={DASH} color="#161616" /><Row left="เชื่อม TMS ↔ บัญชี" right={DASH} color="#161616" />
              <Row left="การใช้งาน 30 วัน" right={`เอกสาร ${DASH} · API ${DASH} · รายงาน ${DASH}`} color="#161616" /><Row left="ปริมาณข้อมูล" right={DASH} color="#161616" />
              <Row left="Schema" right={DASH} color="#161616" /><Row left="สำรองล่าสุด" right={DASH} color="#161616" />
              <Row left="Feature flags" right={orgFlags.length ? orgFlags.map((f) => `${f.key}: ${f.value === true ? 'on' : f.value === false ? 'off' : JSON.stringify(f.value)}`).join(' · ') : DASH} color="#161616" /><Row left="ความปลอดภัย" right={DASH} color="#161616" />
            </div>
            <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>ทีม Innovera เห็นเฉพาะข้อมูลระดับองค์กร/การใช้งาน — ไม่เห็นเอกสาร ยอดเงิน หรือคู่ค้าของลูกค้า เว้นแต่เข้าผ่าน Support พร้อม consent</div>
          </section>
          <div style={css('display: flex; flex-direction: column; gap: 16px')}>
            {/* TODO(backend): การกระทำต่อองค์กรยังไม่มี endpoint (แจ้งใกล้ลิมิต, ระงับ, ส่งออกข้อมูล, ปิดองค์กร 2 คนอนุมัติ) */}
            <Card title="การกระทำต่อองค์กรนี้">
              <Row left={<Inert kind="ghostSm">ส่งอีเมลแจ้งใกล้ลิมิตที่นั่ง</Inert>} />
              <Row left={<a href="/ops" style={css(B.ghostSm)}>ย้ายไป DB แยก (Enterprise)</a>} />
              <Row left={<Inert kind="ghostSm">ระงับชั่วคราว (ตามคำขอ/ค้างชำระ)</Inert>} />
              <Row left={<Inert kind="ghostSm">ส่งออกข้อมูลทั้งหมดให้ลูกค้า</Inert>} />
              <Row left={<span style={css('color: #da1e28')}>ปิดองค์กรถาวร</span>} right="ต้อง 2 คนอนุมัติ · เก็บข้อมูล 90 วัน" />
              <Note>ทุกการกระทำบันทึกใน Audit ของ Console และแจ้ง Owner ของลูกค้า</Note>
            </Card>
            {/* TODO(backend): ไทม์ไลน์องค์กร (ลิมิต, flag, แผน) — มีเฉพาะวันที่สมัคร */}
            <Card title="ไทม์ไลน์">
              <Row left={ddmm(t.created_at)} right="สมัคร" />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
