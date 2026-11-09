'use client';
// ticket · คำขอ consent · เซสชันเข้าดู · ประวัติ ← design/project/ConsoleSupport.dc.html (ลำดับและข้อความตามแบบร่าง)
// ทุกขั้นบังคับที่ accounting-api (packages/db/src/console.ts): ต้องมี ticket ที่ระบุบริษัท · Owner อนุมัติ · ≤ 60 นาที · support ขอสิทธิ์เขียนไม่ได้ · อ่านผ่าน withSupportAccess (audit สองฝั่ง)
import { css, money } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, loadAccess, saveAccess, type AccessState } from '../lib/client';
import type { AuditRow, Overview, StaffRole, Ticket } from '../lib/data';
import { ago, ddmm, monthOf, shortId, thisMonth, thisYear } from '../lib/format';
import type { Tone } from '../lib/rules';
import { B, Card, DASH, Inert, Note, Row, ST, Stat, Stats, Tag } from '../ui';

const STATUS: Record<string, [Tone, string]> = {
  // TODO(Wei): แบบร่างไม่มีป้ายของสถานะ 'open' (ticket ใหม่) — ใช้ "เปิด"
  open: ['info', 'เปิด'],
  in_progress: ['info', 'กำลังทำ'],
  waiting_consent: ['warning', 'รอ consent เข้าดู'],
  waiting_billing: ['info', 'รอ billing'],
  closed: ['neutral', 'ปิดแล้ว'],
};
// TODO(Wei): แบบร่างมีเฉพาะป้าย "รอ consent จาก Owner" — ป้ายของสถานะอื่นของคำขอยังไม่ได้ออกแบบ
const ACCESS_TAG: Record<AccessState['status'], [Tone, string]> = {
  pending: ['warning', 'รอ consent จาก Owner'],
  approved: ['success', 'Owner อนุมัติแล้ว'],
  denied: ['error', 'Owner ปฏิเสธ'],
  active: ['error', 'กำลังเข้าดู'],
  ended: ['neutral', 'ปิดเซสชันแล้ว'],
};
const STAGE: Record<AccessState['status'] | 'none', number> = { none: 0, denied: 0, pending: 1, approved: 2, active: 2, ended: 5 };
interface TbRow { account: string; debit: string; credit: string; balance: string }

function Mark({ i, stage }: { i: number; stage: number }) {
  if (i < stage) return <span style={css('color: #0e6027')}>✓</span>;
  if (i === stage) return <span style={css('color: #684e00')}>●</span>;
  return <span style={css('color: #8d8d8d')}>○</span>;
}

/** สถานะคำขอจาก audit ของ Console (Owner อนุมัติ/ปฏิเสธ = support.consent_granted / support.consent_denied) */
function decided(a: AccessState, audit: AuditRow[]): AccessState {
  if (a.status === 'active' && a.endsAt && new Date(a.endsAt).getTime() <= Date.now()) return { ...a, status: 'ended' };
  if (a.status !== 'pending') return a;
  const d = audit.find((r) => r.consent_ref === a.id && (r.action === 'support.consent_granted' || r.action === 'support.consent_denied'));
  return d ? { ...a, status: d.action === 'support.consent_granted' ? 'approved' : 'denied' } : a;
}

export function SupportDesk({ tickets, counts, audit: audit0, role, initial, nowIso }: { tickets: Ticket[]; counts: Overview['counts']; audit: AuditRow[]; role: StaffRole; initial: string | null; nowIso: string }) {
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [sel, setSel] = useState<string | null>(initial ?? tickets.find((t) => t.status !== 'closed')?.id ?? null);
  const [audit, setAudit] = useState(audit0);
  const [store, setStore] = useState<Record<string, AccessState>>({});
  const [scope, setScope] = useState('');
  const [minutes, setMinutes] = useState<30 | 60>(30);
  const [write, setWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tb, setTb] = useState<TbRow[] | null>(null);

  useEffect(() => setStore(loadAccess()), []);
  useEffect(() => setAudit(audit0), [audit0]);
  const t = tickets.find((x) => x.id === sel);
  const raw = t ? store[t.id] : undefined;
  const a = raw ? decided(raw, audit) : undefined;
  const status = a?.status ?? 'none';
  // บันทึกสถานะคำขอ แล้วโหลดข้อมูลฝั่ง server ใหม่ (สถานะ ticket · ตัวนับ · ประวัติ)
  const put = useCallback((next: AccessState) => { const all = { ...loadAccess(), [next.ticketId]: next }; saveAccess(all); setStore(all); router.refresh(); }, [router]);

  // รอ Owner ตัดสิน → ดึง audit ใหม่ทุก 5 วินาที
  useEffect(() => {
    if (status !== 'pending') return;
    const h = window.setInterval(() => { api<AuditRow[]>('audit').then(setAudit).catch(() => undefined); }, 5000);
    return () => window.clearInterval(h);
  }, [status]);
  useEffect(() => { if (a && raw && a.status !== raw.status) put(a); }, [a, raw, put]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const request = () => run(async () => {
    if (!t) return;
    // TODO(Wei): แบบร่างไม่มีช่อง "เหตุผล" (API บังคับ) — ใช้หัวข้อ ticket เป็นเหตุผล ส่วน "ขอบเขต" มาจากช่องในแบบร่าง
    const reason = `ticket #${t.number}: ${t.subject}`;
    const f = status === 'pending' && a ? a : { scope, minutes, write }; // "ส่งคำขอ consent อีกครั้ง" = คำขอใหม่ด้วยขอบเขตเดิม
    const r = await api<{ id: string }>('access', 'POST', { ticketId: t.id, reason, scope: f.scope, minutes: f.minutes, write: f.write });
    put({ id: r.id, ticketId: t.id, status: 'pending', minutes: f.minutes, scope: f.scope, reason, write: f.write, org: t.org_name });
  });
  const start = () => run(async () => {
    if (!a) return;
    const r = await api<{ companyId: string; endsAt: string }>(`access/${a.id}/start`, 'POST', {});
    put({ ...a, status: 'active', endsAt: r.endsAt });
  });
  const end = () => run(async () => {
    if (!a) return;
    await api(`access/${a.id}/end`, 'POST', {});
    put({ ...a, status: 'ended' });
    setTb(null);
  });
  // ปีบัญชีเป็น พ.ศ. (trialBalance fiscalYear)
  const viewTb = () => run(async () => {
    if (!a) return;
    setTb(await api<TbRow[]>(`access/${a.id}/trial-balance?year=${thisYear() + 543}`));
  });

  const open = tickets.filter((x) => x.status !== 'closed').length;
  const closedMonth = tickets.filter((x) => x.status === 'closed' && monthOf(x.updated_at) === thisMonth(now)).length;
  const stage = STAGE[status];
  const locked = status === 'pending' || status === 'approved' || status === 'active';
  const form = a && locked ? a : { scope, minutes, write };
  const canWrite = role === 'engineer';

  // ประวัติ 30 วัน จาก audit ของ Console (คำขอ → consent → การเข้าดู)
  // TODO(backend): ระยะเวลาเซสชันจริง (started_at/ends_at) และ "สรุปส่งแล้ว" ไม่อยู่ใน audit — ต้องมี GET /console/v1/access
  const since = now.getTime() - 30 * 86_400_000;
  const requests = audit.filter((r) => r.action === 'support.request_access' && new Date(r.at).getTime() >= since);
  const denied = audit.filter((r) => r.action === 'support.consent_denied' && new Date(r.at).getTime() >= since).length;
  const consentOf = (id: string | null) => audit.find((r) => r.consent_ref === id && r.action === 'support.consent_granted') ? 'consent ✓' : audit.find((r) => r.consent_ref === id && r.action === 'support.consent_denied') ? 'consent ✗' : 'รอ consent';

  return (
    <div style={css(ST.content)}>
      <div><h1 style={css(ST.h1)}>Support และการเข้าดูข้อมูลลูกค้า</h1><span style={css(ST.sub)}>หลัก: ลูกค้าเป็นเจ้าของข้อมูล · ทีม Innovera เข้าดูได้เฉพาะเมื่อมี ticket + consent + เวลาจำกัด + บันทึกทุกอย่าง</span></div>
      <Stats>
        {/* TODO(backend): SLA (เกินกำหนด) · เวลาปิดเฉลี่ย · หัวข้อบ่อยสุด ยังไม่มีข้อมูล */}
        <Stat label="ticket เปิดอยู่" value={open} color={open ? '#684e00' : '#161616'} note={`SLA ตอบใน 4 ชม. · เกิน ${DASH}`} />
        <Stat label="รอ consent เข้าดู" value={counts.consent_pending} />
        <Stat label="เซสชันเข้าดูที่เปิดอยู่" value={counts.access_active} />
        <Stat label="ปิดเดือนนี้" value={closedMonth} note={`เฉลี่ย ${DASH} วัน`} />
        <Stat label="หัวข้อบ่อยสุด" value={DASH} note={DASH} />
      </Stats>
      <div style={css(ST.split)}>
        <section style={css('display: flex; flex-direction: column; gap: 16px')}>
          {/* TODO(Wei): แบบร่างไม่มีปุ่ม/ฟอร์มเปิด ticket ใหม่ (API มี POST tickets) */}
          <section style={css(ST.tableBox)}><table style={css(ST.table(820))}>
            <thead><tr style={css(ST.theadRow)}>{['Ticket', 'องค์กร', 'หัวข้อ', 'สถานะ', 'ผู้ดูแล', 'อัปเดต'].map((h) => <th key={h} style={css(ST.th)}>{h}</th>)}</tr></thead>
            <tbody>
              {tickets.map((x) => {
                const [tone, label] = STATUS[x.status] ?? ['neutral', x.status];
                return (
                  <tr key={x.id} style={css(ST.tr)}>
                    <td style={css(ST.td1)}>{x.status === 'closed'
                      ? <span style={css('color: #525252')}>#{x.number}</span>
                      : <a href={`/support?ticket=${x.id}`} aria-current={x.id === sel ? 'true' : undefined} onClick={(e) => { e.preventDefault(); setSel(x.id); setTb(null); setErr(''); window.history.replaceState(null, '', `/support?ticket=${x.id}`); }} style={css('text-decoration: none; font-weight: 500')}>#{x.number}</a>}</td>
                    <td style={css(ST.td)}>{x.org_name}</td>
                    <td style={css(ST.td)}>{x.subject}</td>
                    <td style={css(ST.td)}><Tag tone={tone}>{label}</Tag></td>
                    <td style={css(ST.td)}>{x.assignee_name ?? DASH}</td>
                    <td style={css(ST.td)}>{ago(x.updated_at, now)}</td>
                  </tr>
                );
              })}
              {!tickets.length && <tr style={css(ST.tr)}><td colSpan={6} style={css(ST.td1)}>{DASH}</td></tr>}
            </tbody>
          </table></section>
          {t && t.status !== 'closed' && (
            <section aria-label="คำขอเข้าดู" style={css('border: 1px solid #0f62fe')}>
              <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; background: #edf5ff')}>
                {/* TODO(backend): ชื่อบริษัทของ ticket ไม่อยู่ใน GET tickets — แสดงชื่อองค์กร */}
                <strong style={css('font-weight: 600')}>#{t.number} · ขอเข้าดูบริษัท {t.org_name} แบบอ่านอย่างเดียว (impersonate)</strong>
                {a && <Tag tone={ACCESS_TAG[a.status][0]}>{ACCESS_TAG[a.status][1]}</Tag>}
              </div>
              <div style={css('padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px')}>
                <ol style={css('margin: 0; padding: 0 0 0 20px; display: flex; flex-direction: column; gap: 6px')}>
                  <li><Mark i={0} stage={stage} /> เจ้าหน้าที่ระบุเหตุผลและขอบเขต: &quot;{form.scope || DASH}&quot; · เฉพาะบริษัท {t.company_id ? shortId(t.company_id) : DASH}</li>
                  <li><Mark i={1} stage={stage} /> ส่งคำขอ consent ไปยัง Owner ลูกค้า (อีเมล + แจ้งในคิวหน้าแรก) · Owner อนุมัติ/ปฏิเสธ · เลือกเวลาที่อนุญาต</li>
                  <li><Mark i={2} stage={stage} /> เปิดเซสชันอ่านอย่างเดียว <strong>ไม่เกิน 60 นาที</strong> · แถบสีแดงบนทุกหน้า &quot;กำลังดูในฐานะ Innovera Support&quot; · ลูกค้าเห็นแบบเรียลไทม์ว่าใครดูอยู่</li>
                  <li><Mark i={3} stage={stage} /> ทุกหน้าที่เปิด/ทุกคำค้นถูกบันทึกใน Audit ของลูกค้าและของ Console · ข้อมูลส่วนบุคคลถูกปิดบังตาม PDPA ของบริษัทนั้น</li>
                  <li><Mark i={4} stage={stage} /> เซสชันปิดอัตโนมัติ · ส่งสรุปให้ Owner ว่าดูอะไรไปบ้าง</li>
                </ol>
                <div style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px')}>
                  <label style={css(ST.label)}>ขอบเขต (หน้า/โมดูล)<input value={form.scope} disabled={locked} onChange={(e) => setScope(e.target.value)} style={css(ST.input)} /></label>
                  <label style={css(ST.label)}>ระยะเวลา<select value={form.minutes} disabled={locked} onChange={(e) => setMinutes(e.target.value === '60' ? 60 : 30)} style={css(ST.input)}><option value={30}>30 นาที</option><option value={60}>60 นาที (สูงสุด)</option></select></label>
                </div>
                <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={!form.write} disabled={locked || !canWrite} onChange={(e) => setWrite(!e.target.checked)} /> อ่านอย่างเดียว (เขียนไม่ได้แม้ลูกค้าอนุญาต) — ค่าเริ่มต้นและบังคับสำหรับบทบาท support</label>
                <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={form.write} disabled={locked || !canWrite} onChange={(e) => setWrite(e.target.checked)} /> ขอสิทธิ์แก้ไขข้อมูล (ต้อง engineer + Owner ลูกค้ายืนยัน 2FA ทั้งคู่ · ใช้เฉพาะแก้ข้อมูลเสีย)</label>
                {err && <p role="alert" style={css('margin: 0; color: #a2191f; font-size: 14px')}>{err}</p>}
                <div style={css('display: flex; justify-content: flex-end; gap: 8px')}>
                  {/* TODO(backend): ยังไม่มี endpoint ยกเลิกคำขอ (สถานะ 'cancelled' มีในตารางแล้ว) */}
                  <Inert kind="secondary">ยกเลิกคำขอ</Inert>
                  {status === 'pending'
                    ? <button type="button" disabled={busy} onClick={request} style={css(B.secondary)}>ส่งคำขอ consent อีกครั้ง</button>
                    : status === 'none' || status === 'denied' || status === 'ended'
                      // TODO(Wei): แบบร่างมีแค่ "ส่งคำขอ consent อีกครั้ง" (สถานะรอ consent) — ปุ่มส่งครั้งแรกใช้ "ส่งคำขอ consent"
                      ? <button type="button" disabled={busy || !scope.trim()} onClick={request} style={css(busy || !scope.trim() ? B.disabled : B.secondary)}>ส่งคำขอ consent</button>
                      : null}
                  {status === 'approved'
                    ? <button type="button" disabled={busy} onClick={start} style={css(B.primary)}>เข้าดู</button>
                    : status === 'active'
                      // TODO(Wei): ปุ่มจบเซสชันก่อนหมดเวลาไม่มีในแบบร่าง
                      ? <button type="button" disabled={busy} onClick={end} style={css(`${B.secondary}; color: #da1e28; border: 1px solid #da1e28`)}>จบเซสชัน</button>
                      : <button type="button" disabled style={css(B.disabled)}>เข้าดู (ยังทำไม่ได้ — รอ consent)</button>}
                </div>
                {status === 'active' && a?.endsAt && (
                  // TODO(Wei): หน้าตาการดูข้อมูลระหว่างเซสชันไม่มีในแบบร่าง — ตัวอย่างอ่านอย่างเดียว: งบทดลองปีปัจจุบัน (ทุกครั้งบันทึก audit ทั้งสองฝั่ง)
                  <div style={css('display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #e0e0e0; padding-top: 12px')}>
                    <div style={css('display: flex; justify-content: space-between; align-items: center; gap: 8px')}>
                      <span style={css('color: #a2191f; font-weight: 600')}>กำลังดูในฐานะ Innovera Support · อ่านอย่างเดียว</span>
                      <button type="button" disabled={busy} onClick={viewTb} style={css(B.secondarySm)}>งบทดลอง {thisYear() + 543}</button>
                    </div>
                    {tb && (
                      <section style={css(ST.tableBox)}><table aria-label="งบทดลอง" style={css(ST.table())}>
                        <thead><tr style={css(ST.theadRow)}><th style={css(ST.th)}>บัญชี</th><th style={css(`${ST.th}; text-align: right`)}>เดบิต</th><th style={css(`${ST.th}; text-align: right`)}>เครดิต</th><th style={css(`${ST.th}; text-align: right`)}>คงเหลือ</th></tr></thead>
                        <tbody>{tb.map((r) => (
                          <tr key={r.account} style={css(ST.tr)}><td style={css('height: 36px; padding: 0 12px')}>{r.account}</td>
                            <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(r.debit, { blankZero: true })}</td>
                            <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(r.credit, { blankZero: true })}</td>
                            <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(r.balance, { paren: true })}</td></tr>
                        ))}{!tb.length && <tr style={css(ST.tr)}><td colSpan={4} style={css('height: 36px; padding: 0 12px')}>{DASH}</td></tr>}</tbody>
                      </table></section>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </section>
        <div style={css('display: flex; flex-direction: column; gap: 16px')}>
          <Card title="ข้อมูลที่ support เห็นได้โดยไม่ต้อง consent">
            <Row left="โปรไฟล์องค์กร / แผน / ลิมิต" right="ได้" />
            <Row left="สถานะ job, webhook, e-Tax ของลูกค้า" right="ได้ (ไม่เห็น payload)" />
            <Row left="บันทึกการเข้าสู่ระบบ / 2FA ของผู้ใช้ลูกค้า" right="ได้ (เพื่อช่วยปลดล็อก)" />
            <Row left="เอกสาร ยอดเงิน คู่ค้า รายงาน" right={<><span style={css('color: #a2191f')}>ไม่ได้</span> — ต้อง consent</>} />
            <Row left="ไฟล์แนบ / ข้อมูลส่วนบุคคล" right={<><span style={css('color: #a2191f')}>ไม่ได้</span> — แม้มี consent ก็ปิดบัง</>} />
          </Card>
          {/* TODO(backend): เครื่องมือช่วยเหลือยังไม่มี endpoint (รีเซ็ต 2FA, ส่งลิงก์ยืนยันอีเมล, ปลดล็อก, รันตรวจความถูกต้องแบบสรุป) */}
          <Card title="เครื่องมือช่วยเหลือที่ไม่ต้องเข้าดู">
            <Row left={<Inert kind="ghostSm">รีเซ็ต 2FA ให้ผู้ใช้ (ยืนยันตัวตนทางโทรศัพท์)</Inert>} />
            <Row left={<Inert kind="ghostSm">ส่งลิงก์ยืนยันอีเมลใหม่</Inert>} />
            <Row left={<Inert kind="ghostSm">ปลดล็อกบัญชีที่ถูกล็อก</Inert>} />
            <Row left={<a href="/ops" style={css(B.ghostSm)}>ส่งซ้ำ webhook / e-Tax ที่ล้มเหลว</a>} />
            <Row left={<Inert kind="ghostSm">รัน &quot;ตรวจความถูกต้อง&quot; ให้ลูกค้า แล้วส่งผลสรุป (ไม่เห็นรายละเอียด)</Inert>} />
          </Card>
          <Card title="ประวัติ impersonate 30 วัน">
            {requests.map((r) => (
              <Row key={r.id} left={`${ddmm(r.at)} · ${r.company ?? DASH} · ${DASH} นาที`} right={`${r.display_name ?? DASH} · ${r.reason ?? DASH} · ${consentOf(r.consent_ref)}`} />
            ))}
            {!requests.length && <Row left={DASH} />}
            <Row left="ปฏิเสธ consent" right={`${denied} ครั้ง`} />
            <Note>เป้าหมาย: impersonate ให้น้อยที่สุด — ทุกเคสที่เกิดซ้ำกลายเป็นงาน UX/เอกสารช่วยเหลือ</Note>
          </Card>
        </div>
      </div>
    </div>
  );
}
