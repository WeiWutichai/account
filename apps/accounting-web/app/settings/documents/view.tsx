'use client';
// G5 ตั้งค่าเอกสาร — design/project/ScreenDocSettings.dc.html
// แท็บ = เลื่อนไปยังส่วนนั้นในหน้าเดียว (แบบร่างแสดงทุกส่วนในหน้าเดียว)
// "บันทึกการตั้งค่า" บันทึกการเปิด/ปิดประเภทเอกสารที่มีชุดเลขที่ในระบบ (DP, BN, QO, SO) ลง doc_setting.settings.enabled
// TODO(API): IV-CASH / IV-ABB / EXP-ADV (ประเภทย่อย), ช่องข้อมูลเพิ่มเติม, กฎแปลงเอกสาร, ตัวเลือก PDPA — ยังไม่มี API เก็บค่า
//   ปุ่ม "+ เพิ่มชุดเลขที่" "+ ประเภทย่อย" "+ ช่อง" "+ กฎ" จึงยังไม่ทำงาน · ตารางเหล่านี้แสดงตามแบบร่าง
import { Button, buttonStyle, css, href, S } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_PATTERN, type DocSetting } from './_series';

export interface SeriesRow { key: string; label: string; branch: string; pattern: string; reset: string; next: string; current: string }

const TAB = buttonStyle('ghost', 36);
const TAB_ON = buttonStyle('ghost', 36, false, 'border-bottom: 2px solid #0f62fe');
const TABS: [string, string][] = [['ds-series', 'รูปแบบเลขที่เอกสาร'], ['ds-types', 'ประเภทเอกสาร'], ['ds-fields', 'ช่องข้อมูลเพิ่มเติม'], ['ds-rules', 'กฎแปลงเอกสาร'], ['ds-pdpa', 'ปิดบังข้อมูล (PDPA)']];
const SEC = 'border: 1px solid #e0e0e0; overflow-x: auto';
const SEC_HEAD = 'display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0';
const T = 'width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px';
const TH36 = 'height: 36px; padding: 0 12px; font-weight: 400';
const TD36 = 'height: 36px; padding: 0 12px';
const TD = 'padding: 0 12px';
const MUTED = 'padding: 0 12px; color: #525252';
const MONO = "padding: 0 12px; font-family: 'IBM Plex Mono', monospace; font-size: 13px";

// ประเภทเอกสาร (ตามแบบร่าง) · keys = doc_type ที่เก็บ enabled · fixed = เปิด/ปิดไม่ได้
const TYPES: { label: string; name: string; posts: string; keys: string[]; on: boolean; fixed?: boolean; note?: string }[] = [
  { label: 'IV ใบกำกับภาษี', name: 'ใบแจ้งหนี้/ใบกำกับภาษี · ต้นฉบับ/สำเนา', posts: 'ใช่', keys: ['IV'], on: true, fixed: true },
  { label: 'IV-CASH ใบกำกับ/ใบเสร็จ (ขายสด)', name: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', posts: 'ใช่', keys: [], on: true },
  { label: 'IV-ABB ใบกำกับอย่างย่อ', name: 'ใบกำกับภาษีอย่างย่อ', posts: 'ใช่', keys: [], on: false },
  { label: 'DP ใบแจ้งหนี้มัดจำ', name: 'ใบแจ้งหนี้ค่ามัดจำ', posts: 'ไม่ (ลงตอนรับเงิน)', keys: ['DP'], on: true },
  { label: 'BN ใบวางบิล · QO · SO · PR · PO', name: 'ตามชื่อ', posts: 'ไม่', keys: ['BN', 'QO', 'SO'], on: true },
  { label: 'GR ใบรับสินค้า (สต็อก)', name: '—', posts: '—', keys: [], on: false, fixed: true, note: 'ปิด: ไม่มีสต็อกใน v1' },
  { label: 'EXP-ADV เงินทดรองพนักงาน (ประเภทย่อยของ EXP)', name: 'ใบเบิกเงินทดรอง', posts: 'ใช่ (1190100)', keys: [], on: true },
];

export function DocSettingsView({ rows, settings }: { rows: SeriesRow[]; settings: DocSetting[] }) {
  const router = useRouter();
  const initial = () => TYPES.map((t) => {
    const s = settings.find((x) => t.keys.includes(x.doc_type));
    return typeof s?.settings.enabled === 'boolean' ? s.settings.enabled : t.on;
  });
  const [tab, setTab] = useState(TABS[0]![0]);
  const [enabled, setEnabled] = useState<boolean[]>(initial);
  const [pdpa, setPdpa] = useState([true, true, false]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function go(id: string) { setTab(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  async function save() {
    setMsg(null);
    setBusy(true);
    const init = initial();
    for (const [i, t] of TYPES.entries()) {
      if (enabled[i] === init[i] || !t.keys.length || t.fixed) continue;
      for (const k of t.keys) {
        const s = settings.find((x) => x.doc_type === k);
        const res = await fetch(`/api/proxy/doc-settings/${k}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prefix: s?.prefix ?? k, pattern: s?.pattern ?? DEFAULT_PATTERN, reset: s?.reset ?? 'monthly', settings: { ...(s?.settings ?? {}), enabled: enabled[i] } }) });
        if (!res.ok) { const r = (await res.json()) as { error?: string }; setBusy(false); setMsg({ kind: 'err', text: r.error ?? 'บันทึกไม่สำเร็จ' }); return; }
      }
    }
    setBusy(false);
    setMsg({ kind: 'ok', text: 'บันทึกการตั้งค่าแล้ว' });
    router.refresh();
  }

  return (
    <>
      <header style={css(S.topbar)}><span style={css(S.crumb)}>ตั้งค่า / ตั้งค่าเอกสาร</span><span style={css('color: #525252')}>มีผลกับเอกสารที่สร้างหลังบันทึก · เลขที่ที่ออกแล้วไม่เปลี่ยน</span></header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 16px')}>
        <div><h1 style={css(S.h1)}>ตั้งค่าเอกสาร</h1><span style={css(S.sub)}>รูปแบบเลขที่ · ประเภทเอกสาร · ช่องข้อมูลเพิ่มเติม · กฎแปลงเอกสาร · การปิดบังข้อมูลส่วนบุคคล (PDPA)</span></div>
        <div role="tablist" style={css('display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go(id)} style={tab === id ? TAB_ON : TAB}>{label}</button>)}
        </div>

        <section id="ds-series" style={css(SEC)}>
          <div style={css(SEC_HEAD)}><div><strong style={css('font-weight: 600')}>รูปแบบเลขที่เอกสาร (running number)</strong><div style={css('font-size: 13px; color: #525252')}>ตัวแปร: {'{PREFIX} {YY}/{YYYY}'} ปี พ.ศ. หรือ {'{CY}'} ค.ศ. · {'{MM}'} เดือน · {'{BR}'} รหัสสาขา · {'{SEQ:n}'} ลำดับ n หลัก · รีเซ็ต: ไม่รีเซ็ต / รายปี / รายเดือน · แยกชุดต่อสาขาได้</div></div><Button size={32}>+ เพิ่มชุดเลขที่</Button></div>
          <table style={css(`${T}; min-width: 1080px`)}>
            <thead><tr style={css(S.theadRow)}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เอกสาร</th><th style={css(S.th)}>สาขา</th><th style={css(S.th)}>รูปแบบ</th><th style={css(S.th)}>รีเซ็ต</th><th style={css(S.th)}>ตัวอย่างถัดไป</th><th style={css(`${S.th}; text-align: right`)}>ลำดับปัจจุบัน</th><th style={css(S.th)}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={css(S.tr)}>
                  <td style={css('height: 40px; padding: 0 12px; font-weight: 500')}>{r.label}</td><td style={css(TD)}>{r.branch}</td><td style={css(MONO)}>{r.pattern}</td><td style={css(TD)}>{r.reset}</td>
                  <td style={css('padding: 0 12px; font-variant-numeric: tabular-nums')}>{r.next}</td><td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{r.current}</td>
                  <td style={css(TD)}><a href={`${href('docsettings')}/series/${encodeURIComponent(r.key)}`} style={css('text-decoration: none')}>แก้ไข</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>เลขที่ออกตอน &quot;ผ่านรายการ&quot; (ไม่ใช่ตอนบันทึกร่าง) เพื่อไม่ให้เลขกระโดด · ใบกำกับภาษีห้ามซ้ำ/ห้ามข้าม ระบบล็อกชุดเลขที่ขณะออก · ยกเลิกแล้วเลขคงอยู่พร้อมสถานะ &quot;ยกเลิก&quot;</div>
        </section>

        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); gap: 24px; align-items: start')}>
          <section id="ds-types" style={css(SEC)}>
            <div style={css(SEC_HEAD)}><strong style={css('font-weight: 600')}>ประเภทเอกสาร (เปิด/ปิด · ชื่อบนฟอร์มพิมพ์)</strong><Button size={32}>+ ประเภทย่อย</Button></div>
            <table style={css(T)}>
              <thead><tr style={css(S.theadRow)}><th style={css(TH36)}>ประเภท</th><th style={css(S.th)}>ชื่อบนเอกสาร</th><th style={css(S.th)}>ลงบัญชี</th><th style={css(S.th)}>ใช้</th></tr></thead>
              <tbody>
                {TYPES.map((t, i) => (
                  <tr key={t.label} style={css(S.tr)}><td style={css(TD36)}>{t.label}</td><td style={css(TD)}>{t.name}</td><td style={css(MUTED)}>{t.posts}</td>
                    <td style={css(TD)}><input type="checkbox" aria-label={`ใช้ ${t.label}`} checked={enabled[i]} disabled={t.fixed} onChange={(e) => setEnabled(enabled.map((v, j) => (j === i ? e.target.checked : v)))} />{t.note && <> <span style={css('font-size: 13px; color: #525252')}>{t.note}</span></>}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section id="ds-fields" style={css(SEC)}>
            <div style={css(SEC_HEAD)}><strong style={css('font-weight: 600')}>ช่องข้อมูลเพิ่มเติม (custom fields)</strong><Button size={32}>+ ช่อง</Button></div>
            <table style={css(T)}>
              <thead><tr style={css(S.theadRow)}><th style={css(TH36)}>ชื่อช่อง</th><th style={css(S.th)}>ชนิด</th><th style={css(S.th)}>ใช้กับ</th><th style={css(S.th)}>บังคับ / พิมพ์</th></tr></thead>
              <tbody>
                {[['เลขที่ PO ของลูกค้า', 'ข้อความ', 'IV, BN', 'ไม่บังคับ · พิมพ์'], ['ผู้ติดต่อฝ่ายจัดซื้อ', 'ผู้ติดต่อ (จากคู่ค้า)', 'QO, IV', 'ไม่บังคับ · พิมพ์'], ['รหัสโครงการ (มิติ project)', 'รายการเลือก (มิติ)', 'ทุกเอกสาร + บรรทัด', 'บังคับใน AP/EXP · ไม่พิมพ์'],
                  ['งวดงานตามสัญญา', 'ตัวเลข (n/N)', 'IV, DP', 'ไม่บังคับ · พิมพ์'], ['external_ref (จากแอป/MCP)', 'ระบบ', 'ทุกเอกสาร', 'อ่านอย่างเดียว · ไม่พิมพ์']].map(([a, b, c, d]) => (
                  <tr key={a} style={css(S.tr)}><td style={css(TD36)}>{a}</td><td style={css(TD)}>{b}</td><td style={css(TD)}>{c}</td><td style={css(MUTED)}>{d}</td></tr>
                ))}
              </tbody>
            </table>
            <div style={css('padding: 8px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>ช่องเพิ่มเติมค้นหา/กรอง/ส่งออกได้ และส่งผ่าน API เป็น custom_fields{'{}'}</div>
          </section>
          <section id="ds-rules" style={css(SEC)}>
            <div style={css(SEC_HEAD)}><strong style={css('font-weight: 600')}>กฎแปลงเอกสาร (เอกสารต้นทาง → ปลายทาง)</strong><Button size={32}>+ กฎ</Button></div>
            <table style={css(T)}>
              <thead><tr style={css(S.theadRow)}><th style={css(TH36)}>จาก → ไป</th><th style={css(S.th)}>เงื่อนไข</th><th style={css(S.th)}>พฤติกรรม</th></tr></thead>
              <tbody>
                {[['QO → SO → IV', 'QO อนุมัติแล้ว', 'คัดลอกบรรทัดทั้งหมด · แบ่งออกใบได้หลายงวด · ติดตามยอดคงเหลือที่ยังไม่ออกใบ'], ['IV หลายใบ → BN', 'ลูกค้าเดียวกัน ครบกำหนดในรอบ', 'รวมอัตโนมัติตามรอบวางบิลของลูกค้า'],
                  ['BN/IV → RV', '—', 'ตัดหลายใบ · ถูกหัก ณ ที่จ่าย · ส่วนต่าง'], ['PR → PO → AP', 'PR อนุมัติตามวงเงิน · PO ส่งผู้ขายแล้ว', 'AP รับได้บางส่วน (ยอดค้างรับใน PO) · เตือนเมื่อ AP เกิน PO > 5%'],
                  ['AP/EXP → PV', 'ผ่านรายการ + อนุมัติจ่าย', 'หัก ณ ที่จ่ายคำนวณและรับรู้ตอนจ่าย · ออก 50 ทวิ'], ['IV → CN / AP → CNR', 'ต้องอ้างอิงเอกสารเดิม', 'ยอดไม่เกินเอกสารเดิม · กลับภาษีตามส่วน']].map(([a, b, c]) => (
                  <tr key={a} style={css(S.tr)}><td style={css(TD36)}>{a}</td><td style={css(TD)}>{b}</td><td style={css(MUTED)}>{c}</td></tr>
                ))}
                <tr style={css(S.tr)}><td style={css(TD36)}>แอป/MCP → เอกสาร</td><td style={css(TD)}>documents:draft</td><td style={css('padding: 0 12px; color: #a2191f')}>สร้างเป็นร่างเสมอ · คนผ่านรายการ</td></tr>
              </tbody>
            </table>
          </section>
          <section id="ds-pdpa" style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px')}>
            <div><strong style={css('font-weight: 600')}>ปิดบังข้อมูลส่วนบุคคล (PDPA)</strong><div style={css('font-size: 13px; color: #525252')}>กำหนดว่าใครเห็นข้อมูลเต็ม และข้อมูลใดถูกปิดบังบนหน้าจอ / เอกสารพิมพ์ / API / MCP / การส่งออก</div></div>
            <table style={css(T)}>
              <thead><tr style={css(S.theadRow)}><th style={css(TH36)}>ข้อมูล</th><th style={css(S.th)}>หน้าจอ</th><th style={css(S.th)}>พิมพ์</th><th style={css(S.th)}>API / MCP</th><th style={css(S.th)}>ส่งออก</th></tr></thead>
              <tbody>
                {[['เลขบัตรประชาชน (บุคคลธรรมดา)', '1-xxxx-xxxxx-12-3', 'เต็ม (50 ทวิ กฎหมายกำหนด)', 'ปิดบัง', 'ปิดบัง เว้น Owner'], ['เลขบัญชีธนาคารคู่ค้า', 'xxx-x-x1234-x', 'ไม่พิมพ์', 'ปิดบัง', 'ไฟล์โอนธนาคารเท่านั้น'],
                  ['เบอร์โทร / อีเมลบุคคล', 'เต็ม (ผู้มีสิทธิ์)', 'ตามแบบฟอร์ม', 'ปิดบัง', 'เต็ม'], ['เงินเดือน / รายการเงินเดือนรายคน', 'เฉพาะบทบาท Payroll', '—', 'ไม่เปิด', 'Owner / Payroll']].map(([a, b, c, d, e]) => (
                  <tr key={a} style={css(S.tr)}><td style={css(TD36)}>{a}</td><td style={css(TD)}>{b}</td><td style={css(TD)}>{c}</td><td style={css(TD)}>{d}</td><td style={css(TD)}>{e}</td></tr>
                ))}
              </tbody>
            </table>
            {['บันทึกการเปิดดูข้อมูลเต็มลง Audit log', 'เก็บเอกสารและข้อมูลบุคคลตามระยะเวลาที่กฎหมายกำหนด (5 ปีตามประมวลรัษฎากร) แล้วแจ้งเตือนให้พิจารณาลบ/ทำลาย', 'ลบข้อมูลส่วนบุคคลของคู่ค้าที่ไม่มีเอกสารเกิน 5 ปี โดยอัตโนมัติ (anonymize)'].map((t, i) => (
              <label key={t} style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={pdpa[i]} onChange={(e) => setPdpa(pdpa.map((v, j) => (j === i ? e.target.checked : v)))} /> {t}</label>
            ))}
            <span style={css('font-size: 13px; color: #525252')}>คำขอใช้สิทธิ์เจ้าของข้อมูล (เข้าถึง/แก้ไข/ลบ) บันทึกเป็นเคสใน Audit log พร้อมกำหนดตอบภายใน 30 วัน</span>
          </section>
        </div>
        {msg && <div role="status" style={css(`padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: flex-end; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0')}>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <Button onClick={() => { setEnabled(initial()); setPdpa([true, true, false]); setMsg(null); }}>ยกเลิก</Button>
          <Button kind="primary" disabled={busy} onClick={() => void save()}>บันทึกการตั้งค่า</Button>
        </div>
      </div>
    </>
  );
}
