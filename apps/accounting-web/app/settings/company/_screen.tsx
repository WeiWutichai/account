'use client';
// G1 ตั้งค่าบริษัท — design/project/ScreenSettings.dc.html
// บันทึกด้วย PUT /v1/company-settings · API ตอบ 422 {error} สำหรับตัวเลือกที่ยังไม่รองรับ (จุดภาษีเมื่อออกใบกำกับ · ปัดรายบรรทัด)
// TODO(Wei) ScreenSettings.dc.html: เมนู "ภาษี (VAT / หัก ณ ที่จ่าย)" · "มิติ …" · "อีเมลและการแจ้งเตือน" ลิงก์กลับหน้านี้ตามแบบร่าง (ยังไม่มีหน้าแยก)
// TODO(Wei) ScreenSettings.dc.html: "ส่งออกข้อมูลทั้งหมด / ปิดบริษัท" ลิงก์กลับหน้านี้ตามแบบร่าง — ยังไม่มีแบบร่าง/ขั้นตอนส่งออกและปิดบริษัท
import { Button, css, href, S, thaiDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type BusinessType = 'service' | 'trading' | 'manufacturing' | 'mixed';
interface Defaults {
  saleCreditDays: number; purchaseCreditDays: number; priceDefault: 'exclude_vat' | 'include_vat'; rounding: 'last_line' | 'per_line';
  printFont: string; etax: boolean; allowFuturePosting: boolean; requireBillAttachment: boolean; enforce2fa: boolean;
}
export interface CompanySettings {
  company: {
    id: string; name_th: string; name_en: string | null; tax_id: string | null; branch_code: string; address: string | null; phone: string | null; email: string | null;
    business_type: BusinessType; vat_registered: boolean; service_tax_point: 'on_payment' | 'on_invoice'; db_dsn: string | null; org_id: string;
  };
  plan: { name: string; renews_at: string } | null;
  defaults: Defaults;
}

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const NAV_A = 'display: block; padding: 8px 16px; text-decoration: none; color: #161616';
const NAV_CURRENT = 'display: block; padding: 8px 16px 8px 13px; text-decoration: none; color: #161616; background: #e0e0e0; border-left: 3px solid #0f62fe; font-weight: 600';
const ROW = 'display: flex; justify-content: space-between';
const CHECK = 'display: flex; gap: 8px; align-items: center';

// เมนูย่อยตามลำดับในแบบร่าง → route id
const NAV: [string, string][] = [
  ['ข้อมูลบริษัท', 'settings'], ['ปีบัญชี และงวด', 'close'], ['เลขที่เอกสาร (running)', 'docsettings'], ['ภาษี (VAT / หัก ณ ที่จ่าย)', 'settings'],
  ['แบบฟอร์มพิมพ์ / โลโก้', 'docsettings'], ['มิติ (รถ / เที่ยว / โครงการ / สาขา)', 'settings'], ['สกุลเงิน และอัตราแลกเปลี่ยน', 'plan'], ['อีเมลและการแจ้งเตือน', 'settings'],
  ['โมดูลเสริม (สินทรัพย์ / เงินเดือน · สต็อก v2)', 'plan'], ['ผู้ใช้และสิทธิ์', 'users'], ['แอปที่เชื่อมต่อ', 'apps'], ['ประวัติการใช้งาน', 'audit'],
];
const BRANCH: [string, string][] = [['00000', 'สำนักงานใหญ่ (00000)'], ['00001', 'สาขาที่ 00001']];
const BUSINESS: [BusinessType, string][] = [['service', 'บริการ'], ['trading', 'ซื้อมาขายไป'], ['manufacturing', 'ผลิต'], ['mixed', 'ผสม']];
const PRICE: [Defaults['priceDefault'], string][] = [['exclude_vat', 'ไม่รวม VAT'], ['include_vat', 'รวม VAT']];
const TAX_POINT: [CompanySettings['company']['service_tax_point'], string][] = [['on_payment', 'เมื่อรับชำระ (เกณฑ์เงินสด)'], ['on_invoice', 'เมื่อออกใบกำกับ']];
const ROUNDING: [Defaults['rounding'], string][] = [['last_line', 'ทศนิยม 2 ตำแหน่ง · ปัดที่บรรทัดสุดท้าย'], ['per_line', 'ปัดรายบรรทัด']];
const FONTS = ['Sarabun', 'IBM Plex Sans Thai'];

interface Form {
  nameTh: string; nameEn: string; taxId: string; branchCode: string; address: string; phone: string; email: string;
  businessType: BusinessType; vatRegistered: boolean; serviceTaxPoint: 'on_payment' | 'on_invoice';
  saleCredit: string; purchaseCredit: string; priceDefault: Defaults['priceDefault']; rounding: Defaults['rounding']; printFont: string;
  etax: boolean; allowFuturePosting: boolean; requireBillAttachment: boolean; enforce2fa: boolean;
}
const toForm = ({ company: c, defaults: d }: CompanySettings): Form => ({
  nameTh: c.name_th, nameEn: c.name_en ?? '', taxId: c.tax_id ?? '', branchCode: c.branch_code, address: c.address ?? '', phone: c.phone ?? '', email: c.email ?? '',
  businessType: c.business_type, vatRegistered: c.vat_registered, serviceTaxPoint: c.service_tax_point,
  saleCredit: `${d.saleCreditDays} วัน`, purchaseCredit: `${d.purchaseCreditDays} วัน`, priceDefault: d.priceDefault, rounding: d.rounding, printFont: d.printFont,
  etax: d.etax, allowFuturePosting: d.allowFuturePosting, requireBillAttachment: d.requireBillAttachment, enforce2fa: d.enforce2fa,
});
/** "30 วัน" → 30 · ไม่มีตัวเลข → NaN (API ตอบข้อความเครดิตเทอมไม่ถูกต้อง) */
const days = (s: string): number => { const m = /\d+/u.exec(s); return m ? Number(m[0]) : Number.NaN; };
/** รหัสบริษัทแบบย่อ (แบบร่าง: co_01hv9…k3) */
const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

export function CompanySettingsScreen({ settings }: { settings: CompanySettings }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => toForm(settings));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const { company, plan } = settings;
  const branches = BRANCH.some(([v]) => v === f.branchCode) ? BRANCH : [...BRANCH, [f.branchCode, `สาขาที่ ${f.branchCode}`] as [string, string]];

  function reset() { setF(toForm(settings)); setMsg(null); }

  async function save() {
    setBusy(true); setMsg(null);
    const body = {
      nameTh: f.nameTh, nameEn: f.nameEn, taxId: f.taxId, branchCode: f.branchCode, address: f.address, phone: f.phone, email: f.email,
      businessType: f.businessType, vatRegistered: f.vatRegistered, serviceTaxPoint: f.serviceTaxPoint,
      defaults: {
        saleCreditDays: days(f.saleCredit), purchaseCreditDays: days(f.purchaseCredit), priceDefault: f.priceDefault, rounding: f.rounding, printFont: f.printFont,
        etax: f.etax, allowFuturePosting: f.allowFuturePosting, requireBillAttachment: f.requireBillAttachment, enforce2fa: f.enforce2fa,
      },
    };
    const res = await fetch('/api/proxy/company-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = (await res.json().catch(() => ({}))) as { error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ') }); return; }
    setMsg({ kind: 'ok', text: 'บันทึกการตั้งค่าแล้ว' });
    router.refresh();
  }

  return (
    <>
      <TopBar crumb="ตั้งค่า / บริษัท" right={
        <span style={css('color: #525252')}>{plan ? `แผน ${plan.name} · ต่ออายุ ${thaiDate(plan.renews_at)} · ` : ''}<a href={href('plan')} style={css('text-decoration: none')}>จัดการแผน</a></span>} />
      <div style={css('display: flex; flex: 1; min-height: 0')}>
        <nav aria-label="ตั้งค่า" style={css('flex: 0 0 240px; border-right: 1px solid #e0e0e0; padding: 16px 0; font-size: 14px')}>
          {NAV.map(([label, id], i) => i === 0
            ? <a key={label} href={href(id)} aria-current="page" style={css(NAV_CURRENT)}>{label}</a>
            : <a key={label} href={href(id)} style={css(NAV_A)}>{label}</a>)}
          <div style={css('margin: 16px 16px 0; padding-top: 16px; border-top: 1px solid #e0e0e0')}><a href={href('settings')} style={css('display: block; padding: 8px 0; text-decoration: none; color: #a2191f')}>ส่งออกข้อมูลทั้งหมด / ปิดบริษัท</a></div>
        </nav>
        <div style={css('flex: 1; min-width: 0; padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 880px; box-sizing: border-box')}>
          <div><h1 style={css(S.h1)}>ข้อมูลบริษัท</h1><span style={css(S.sub)}>ใช้บนเอกสารทุกใบ ใบกำกับภาษี และแบบยื่นภาษี · เปลี่ยนแล้วมีผลกับเอกสารที่ออกหลังจากนี้</span></div>
          <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
            <label style={css(`grid-column: span 2; ${LABEL}`)}>ชื่อนิติบุคคล (ไทย)<input value={f.nameTh} onChange={(e) => set('nameTh', e.target.value)} style={css(INPUT)} /></label>
            <label style={css(`grid-column: span 2; ${LABEL}`)}>ชื่อนิติบุคคล (อังกฤษ)<input value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>เลขประจำตัวผู้เสียภาษี 13 หลัก<input value={f.taxId} onChange={(e) => set('taxId', e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
            <label style={css(LABEL)}>สาขา<select value={f.branchCode} onChange={(e) => set('branchCode', e.target.value)} style={css(INPUT)}>{branches.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label style={css(`grid-column: span 2; ${LABEL}`)}>ที่อยู่ตามทะเบียน (ภาษาไทย)<textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} style={css('padding: 8px 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; resize: vertical')} /></label>
            <label style={css(LABEL)}>โทรศัพท์<input value={f.phone} onChange={(e) => set('phone', e.target.value)} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>อีเมลสำหรับส่งเอกสาร<input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} style={css(INPUT)} /></label>
            <label style={css(LABEL)}>ประเภทกิจการ<select value={f.businessType} onChange={(e) => set('businessType', e.target.value as BusinessType)} style={css(INPUT)}>{BUSINESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label style={css(LABEL)}>จดทะเบียน VAT<select value={f.vatRegistered ? 'yes' : 'no'} onChange={(e) => set('vatRegistered', e.target.value === 'yes')} style={css(INPUT)}><option value="yes">จดทะเบียนแล้ว · 7%</option><option value="no">ยังไม่จด</option></select></label>
          </section>
          <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px')}>
            <strong>ค่าเริ่มต้นเอกสาร</strong>
            <div style={css('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css(LABEL)}>เครดิตเทอมขาย<input value={f.saleCredit} onChange={(e) => set('saleCredit', e.target.value)} onBlur={(e) => { const n = days(e.target.value); if (Number.isFinite(n)) set('saleCredit', `${n} วัน`); }} style={css(INPUT)} /></label>
              <label style={css(LABEL)}>เครดิตเทอมซื้อ<input value={f.purchaseCredit} onChange={(e) => set('purchaseCredit', e.target.value)} onBlur={(e) => { const n = days(e.target.value); if (Number.isFinite(n)) set('purchaseCredit', `${n} วัน`); }} style={css(INPUT)} /></label>
              <label style={css(LABEL)}>ราคาตั้งต้น<select value={f.priceDefault} onChange={(e) => set('priceDefault', e.target.value as Defaults['priceDefault'])} style={css(INPUT)}>{PRICE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label style={css(LABEL)}>จุดภาษีสำหรับบริการ<select value={f.serviceTaxPoint} onChange={(e) => set('serviceTaxPoint', e.target.value as Form['serviceTaxPoint'])} style={css(INPUT)}>{TAX_POINT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label style={css(LABEL)}>ปัดเศษ<select value={f.rounding} onChange={(e) => set('rounding', e.target.value as Defaults['rounding'])} style={css(INPUT)}>{ROUNDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label style={css(LABEL)}>ฟอนต์เอกสารพิมพ์<select value={f.printFont} onChange={(e) => set('printFont', e.target.value)} style={css(INPUT)}>{FONTS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
            </div>
            <label style={css(CHECK)}><input type="checkbox" checked={f.etax} onChange={(e) => set('etax', e.target.checked)} /> เปิดใช้ e-Tax Invoice &amp; e-Receipt (ลงนามดิจิทัลผ่านผู้ให้บริการ)</label>
            <label style={css(CHECK)}><input type="checkbox" checked={f.allowFuturePosting} onChange={(e) => set('allowFuturePosting', e.target.checked)} /> อนุญาตให้บันทึกรายการล่วงหน้าในงวดถัดไป / ปีถัดไป</label>
            <label style={css(CHECK)}><input type="checkbox" checked={f.requireBillAttachment} onChange={(e) => set('requireBillAttachment', e.target.checked)} /> บังคับแนบไฟล์หลักฐานทุกบิลซื้อ</label>
          </section>
          <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 8px; font-size: 14px')}><strong>ฐานข้อมูลและความปลอดภัย</strong>
            <div style={css(ROW)}><span>รหัสบริษัท (tenant)</span><span title={company.id} style={css('font-variant-numeric: tabular-nums; color: #525252')}>{shortId(company.id)}</span></div>
            {/* ตาราง/เก็บตาม deploy/backup/backup-loop.sh (02:00 เวลาไทย · BACKUP_RETENTION_DAYS ค่าตั้งต้น 14 ใน deploy/.env.example)
                TODO(Wei) ScreenSettings.dc.html: แบบร่างเขียน "เก็บ 30 วัน" แต่ค่าจริงของ deploy คือ 14 วัน
                TODO(backend): "ล่าสุด …" — ยังไม่มี API เวลาสำรองข้อมูลครั้งล่าสุด */}
            <div style={css(ROW)}><span>สำรองข้อมูลอัตโนมัติ</span><span style={css('color: #525252')}>ทุกวัน 02:00 · เก็บ 14 วัน</span></div>
            {/* TODO(Wei) ScreenSettings.dc.html: ไม่มีข้อความกรณีเปิดฐานข้อมูลแยกแล้ว (db_dsn มีค่า) */}
            <div style={css(ROW)}><span>ฐานข้อมูลแยกเฉพาะบริษัท (Enterprise)</span><span style={css('color: #525252')}>{company.db_dsn ? 'เปิด' : <>ไม่ได้เปิด · <a href={href('plan')} style={css('text-decoration: none')}>อัปเกรด</a></>}</span></div>
            {/* TODO(backend): id-api ยังไม่บังคับ 2FA ตามค่านี้ (เก็บใน defaults.enforce2fa เท่านั้น) */}
            <div style={css(ROW)}><span>บังคับ 2FA ทุกผู้ใช้</span><label style={css(CHECK)}><input type="checkbox" checked={f.enforce2fa} onChange={(e) => set('enforce2fa', e.target.checked)} /> เปิด</label></div>
          </section>
        </div>
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: flex-end; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0')}>
        {msg && <span role="status" style={css(`margin-right: auto; padding: 0 0 0 12px; border-left: 3px solid ${msg.kind === 'ok' ? '#24a148' : '#da1e28'}; font-size: 14px`)}>{msg.text}</span>}
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <Button disabled={busy} onClick={reset}>ยกเลิก</Button>
          <Button kind="primary" disabled={busy} onClick={() => void save()}>บันทึกการตั้งค่า</Button>
        </div>
      </div>
    </>
  );
}
