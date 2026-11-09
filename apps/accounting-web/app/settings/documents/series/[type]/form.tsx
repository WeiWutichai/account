'use client';
// G5 แก้ไขชุดเลขที่เอกสาร — design/project/ScreenDocSeriesEdit.dc.html
// บันทึกผ่าน PUT doc-settings/:type {prefix, pattern, reset, settings{branch, nextNo, startFrom, issueOn, voidMode}}
// TODO(API): ตัวสร้างเลขที่ (packages/db nextNumber) ยังใช้แค่ prefix + {YY}{MM}-{SEQ:4} รายเดือน — รูปแบบอื่น/รอบรีเซ็ต/ลำดับถัดไป/สาขา/เริ่มใช้ตั้งแต่ ถูกเก็บไว้แต่ยังไม่มีผลกับเลขที่ที่ออก
// TODO(API): "ปิดชุดเลขที่นี้" — ยังไม่มี API ปิดชุดเลขที่ จึงยังไม่ทำงาน
import { Button, ButtonLink, css, href, S, Tag, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatNo, RESET_LABEL, seqDigits, shownPattern, type DocSetting, type SeriesDef } from '../../_series';

interface Props { def: SeriesDef; setting: DocSetting; saved: boolean; today: string; currentSeq: number | null; issued: number | null; drafts: number | null }
const BRANCH: [SeriesDef['branchOpt'], string][] = [['HQ', 'สำนักงานใหญ่ (00000)'], ['00001', 'สาขา 00001'], ['ALL', 'ทุกสาขา (ชุดเดียวกัน)']];
const RESET: [DocSetting['reset'], string][] = [['monthly', 'รายเดือน'], ['yearly', 'รายปี'], ['never', 'ไม่รีเซ็ต']];
const ISSUE: [string, string][] = [['post', 'ผ่านรายการ (แนะนำ — เลขไม่กระโดด)'], ['draft', 'บันทึกร่าง']];
const VOID: [string, string][] = [['keep', 'คงเลขเดิม + สถานะ “ยกเลิก” (ตามประกาศกรมสรรพากร)'], ['renumber', 'ออกเลขใหม่แทน']];
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const FIELD = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';
const HINT = 'font-size: 13px; color: #525252';
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
const label = (iso: string) => `${thaiMonth(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4)) + 543}`;

export function SeriesForm({ def, setting, saved, today, currentSeq, issued, drafts }: Props) {
  const router = useRouter();
  const init = {
    branch: str(setting.settings.branch, def.branchOpt), pattern: shownPattern(setting, def.rawPattern), reset: setting.reset,
    nextNo: str(setting.settings.nextNo, currentSeq === null ? '' : String(currentSeq + 1)), startFrom: str(setting.settings.startFrom, 'ทันที'),
    issueOn: str(setting.settings.issueOn, 'post'), voidMode: str(setting.settings.voidMode, 'keep'),
  };
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const changed = (Object.keys(init) as (keyof typeof init)[]).filter((k) => v[k] !== init[k]).length;
  const set = (k: keyof typeof init, x: string) => setV({ ...v, [k]: x });

  // ตัวอย่างเลขที่: ถัดไป (เดือนนี้) · หลังรีเซ็ต · ปีหน้า
  const [y, m] = today.split('-').map(Number) as [number, number];
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const nextYear = `${y + 1}-01-01`;
  const afterReset = v.reset === 'yearly' ? nextYear : nextMonth;
  const seqNow = Number(v.nextNo) || 1;
  const sample = (iso: string, seq: number) => formatNo(v.pattern, setting.prefix, iso, seq, v.branch === '00001' ? '00001' : '00000');
  const digits = seqDigits(v.pattern);

  async function save() {
    setMsg(null);
    let prefix = setting.prefix;
    let pattern = v.pattern.trim();
    if (!pattern.startsWith('{PREFIX}')) {
      const mm = /^([A-Z]+)(.*)$/u.exec(pattern);
      if (!mm) { setMsg({ kind: 'err', text: 'คำนำหน้าเลขที่ต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ 1–6 ตัว' }); return; }
      prefix = mm[1]!;
      pattern = `{PREFIX}${mm[2]!}`;
    }
    if (v.nextNo && (!/^\d+$/u.test(v.nextNo) || (currentSeq !== null && Number(v.nextNo) <= currentSeq))) { setMsg({ kind: 'err', text: 'แก้ได้เฉพาะไปข้างหน้า และต้องไม่ซ้ำกับเลขที่ออกแล้ว' }); return; }
    setBusy(true);
    const res = await fetch(`/api/proxy/doc-settings/${encodeURIComponent(def.key)}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, pattern, reset: v.reset, settings: { ...setting.settings, branch: v.branch, nextNo: v.nextNo, startFrom: v.startFrom, issueOn: v.issueOn, voidMode: v.voidMode } }) });
    const r = (await res.json()) as { ok?: boolean; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: 'บันทึกแล้ว' });
    router.refresh();
  }

  const branchName = def.branch;
  return (
    <>
      <header style={css(S.topbar)}><span style={css(S.crumb)}><a href={href('docsettings')} style={css('text-decoration: none')}>ตั้งค่าเอกสาร</a> / รูปแบบเลขที่ / {def.key.split('-')[0]} {branchName}</span>
        <Tag kind="success">{`ใช้งานอยู่ · ลำดับปัจจุบัน ${currentSeq ?? '—'}`}</Tag></header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css(S.h1)}>แก้ไขชุดเลขที่: {def.title} — {branchName}</h1><span style={css(S.sub)}>การแก้มีผลกับเอกสารที่ออกเลขหลังจากนี้เท่านั้น</span></div>
        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css(LABEL)}>ประเภทเอกสาร<input readOnly value={def.title} style={css(FIELD)} /><span style={css(HINT)}>เปลี่ยนไม่ได้หลังมีเอกสารในชุด</span></label>
              <label style={css(LABEL)}>ใช้กับสาขา<select value={v.branch} onChange={(e) => set('branch', e.target.value)} style={css(FIELD)}>{BRANCH.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={css(LABEL)}>รูปแบบ<input value={v.pattern} onChange={(e) => set('pattern', e.target.value)} style={css(FIELD)} /><span style={css(HINT)}>ตัวแปร: {'{PREFIX} {YY}/{YYYY}'} พ.ศ. · {'{CY}'} ค.ศ. · {'{MM}'} · {'{BR}'} รหัสสาขา · {'{SEQ:n}'} ลำดับ n หลัก</span></label>
              <label style={css(LABEL)}>รีเซ็ตลำดับ<select value={v.reset} onChange={(e) => set('reset', e.target.value)} style={css(FIELD)}>{RESET.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={css(LABEL)}>ลำดับถัดไป<input value={v.nextNo} onChange={(e) => set('nextNo', e.target.value)} style={css(FIELD)} /><span style={css(HINT)}>แก้ได้เฉพาะไปข้างหน้า และต้องไม่ซ้ำกับเลขที่ออกแล้ว</span></label>
              <label style={css(LABEL)}>เริ่มใช้ตั้งแต่<input value={v.startFrom} onChange={(e) => set('startFrom', e.target.value)} style={css(FIELD)} /><span style={css(HINT)}>หรือกำหนดวันที่ เช่น 01/01/2570 เพื่อเริ่มชุดใหม่ต้นปี</span></label>
              <label style={css(LABEL)}>ออกเลขเมื่อ<select value={v.issueOn} onChange={(e) => set('issueOn', e.target.value)} style={css(FIELD)}>{ISSUE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={css(LABEL)}>ชุดสำหรับยกเลิก<select value={v.voidMode} onChange={(e) => set('voidMode', e.target.value)} style={css(FIELD)}>{VOID.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>ตัวอย่างเลขที่จากรูปแบบนี้</strong>
              <div style={css('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; font-variant-numeric: tabular-nums')}>
                <div><span style={css(HINT)}>ถัดไป ({label(today)})</span><div style={css('font-weight: 600')}>{sample(today, seqNow)}</div></div>
                <div><span style={css(HINT)}>หลังรีเซ็ต ({label(afterReset)})</span><div style={css('font-weight: 600')}>{v.reset === 'never' ? '—' : sample(afterReset, 1)}</div></div>
                <div><span style={css(HINT)}>ปีหน้า ({label(nextYear)})</span><div style={css('font-weight: 600')}>{sample(nextYear, v.reset === 'never' ? seqNow + 1 : 1)}</div></div>
              </div>
              <span style={css(HINT)}>เลข {digits} หลัก รองรับ {comma(10 ** digits - 1)} ฉบับ/{v.reset === 'monthly' ? 'เดือน' : v.reset === 'yearly' ? 'ปี' : 'ชุด'} · ระบบเตือนเมื่อใช้ถึง 90% และเพิ่มหลักให้อัตโนมัติถ้าเปิดตัวเลือก</span>
            </section>
            <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
              <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ประวัติชุดเลขที่นี้</strong></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css(S.theadRow)}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เมื่อ</th><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>การเปลี่ยนแปลง</th><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>โดย</th></tr></thead>
                <tbody>
                  {saved && setting.updated_at && (
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 40px; padding: 0 12px')}>{thaiDate(setting.updated_at.slice(0, 10))}</td><td style={css('padding: 0 12px')}>{shownPattern(setting, def.rawPattern)} · รีเซ็ต{RESET_LABEL[setting.reset]}</td><td style={css('padding: 0 12px')}>—</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
              <strong>ผลของการแก้ไข</strong>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>เอกสารที่ออกแล้ว {issued === null ? '—' : comma(issued)} ฉบับ</span><span style={css('color: #0e6027')}>เลขเดิมคงอยู่</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>เอกสารร่าง {drafts === null ? '—' : comma(drafts)} ฉบับ</span><span style={css('color: #684e00')}>จะได้เลขตามรูปแบบใหม่เมื่อผ่านรายการ</span></div>
              <div style={css('display: flex; justify-content: space-between; gap: 8px')}><span>ความต่อเนื่อง</span><span style={css('color: #525252')}>รายงานภาษีขายเรียงตามวันที่/เลขที่ ไม่กระทบ</span></div>
            </section>
            <section style={css('background: #fcf4d6; border: 1px solid #f1c21b; padding: 12px 16px; font-size: 13px; color: #684e00')}>ใบกำกับภาษีต้องมีเลขที่เรียงลำดับไม่ซ้ำ (ม.86/4) — การเปลี่ยนรูปแบบกลางเดือนทำให้มีสองชุดในเดือนเดียวกัน ระบบแนะนำให้เริ่มใช้ต้นเดือนหรือต้นปีบัญชี</section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 6px')}><strong>ชุดเลขที่อื่นที่เกี่ยวข้อง</strong><span style={css('color: #525252')}>สาขา 00001 ใช้ IV{'{BR}'}-{'{YY}{MM}'}-{'{SEQ:4}'} แยกชุด · ใบเสร็จ RV ใช้ร่วมทุกสาขา</span><a href={href('docsettings')} style={css('font-size: 13px; text-decoration: none')}>กลับไปดูทุกชุด</a></section>
          </aside>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}>
        <span style={css('font-size: 13px; color: #525252')}>{changed ? `เปลี่ยน ${changed} ช่อง` : 'ยังไม่มีการเปลี่ยนแปลง'}</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <ButtonLink href={href('docsettings')}>ยกเลิก</ButtonLink>
          <Button kind="danger">ปิดชุดเลขที่นี้</Button>
          <Button kind="primary" disabled={busy || !changed} onClick={() => void save()}>บันทึก</Button>
        </div>
      </div>
    </>
  );
}
