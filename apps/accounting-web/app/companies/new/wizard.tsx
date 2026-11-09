'use client';
// ตัวช่วยสร้างบริษัท — design/project/ScreenCompanyCreate.dc.html
// ขั้น 1 ข้อมูลบริษัท: TODO(Wei) T8 แบบร่างขั้น 1 ข้อมูลบริษัทไม่มี — ใช้ช่อง/ป้ายจาก ScreenSettings.dc.html (ชื่อนิติบุคคล (ไทย) · เลขประจำตัวผู้เสียภาษี 13 หลัก · สาขา) ในกล่องแบบเดียวกับขั้น 2
// ขั้น 2 ปีบัญชี & ผังบัญชี: ตามแบบร่าง · กด "ถัดไป: ยอดยกมา" → id-api สร้างบริษัท (setup_step = 3) → /companies/select → /setup/opening-balance
import { Button, ButtonLink, css, parseThaiDate, thaiDate } from '@innovera/ui';
import { useState } from 'react';

export interface PlanNote { nth: number; plan: string; limit: number }
type Template = 'service' | 'trading' | 'dbd' | 'import';

const SECTION = 'background: #ffffff; border: 1px solid #e0e0e0; padding: 24px; display: flex; flex-direction: column; gap: 24px';
const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const SELECT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const STEPS = ['ข้อมูลบริษัท', 'ปีบัญชี & ผังบัญชี', 'ยอดยกมา', 'ภาษี & เลขที่เอกสาร', 'ทีมและแอปเชื่อมต่อ'];

// ข้อความแม่แบบตามแบบร่าง · TODO(Wei) T1: "186 บัญชี" / "172 บัญชี" / "24 สูตร" เป็นข้อความในแบบร่าง — ผังจริงของแม่แบบบริการมี 53 บัญชี (fixtures) · แม่แบบอื่นยังไม่มีรายการ (id-api ตอบ 422)
const TEMPLATES: { id: Template; title: string; desc: string }[] = [
  { id: 'service', title: 'ธุรกิจบริการ / ขนส่ง (แนะนำ)', desc: '186 บัญชี · มีบัญชีต้นทุนต่อรถ ผู้รับเหมาขนส่ง เงินทดรองคนขับ · พร้อมสูตรลงบัญชี 24 สูตร · รองรับ TMS' },
  { id: 'trading', title: 'ซื้อมาขายไป / ค้าปลีก', desc: '172 บัญชี · สินค้าคงเหลือ ต้นทุนขาย · เปิดโมดูลสต็อก' },
  { id: 'dbd', title: 'มาตรฐานกรมพัฒนาธุรกิจการค้า (ทั่วไป)', desc: 'ผังย่อตามรูปแบบงบ DBD · เหมาะกับสำนักงานบัญชี' },
  { id: 'import', title: 'นำเข้าจากระบบเดิม', desc: 'Excel / Express / FlowAccount / PEAK · ตัวช่วยแม็ปรหัสบัญชี' },
];

/** วันเริ่มปีบัญชีถัดไปหลังวันนี้ ('MM-DD' + 'YYYY-MM-DD' → 'YYYY-MM-DD') */
function nextFiscalStart(fy: string, today: string): string {
  const y = Number(today.slice(0, 4));
  const thisYear = `${y}-${fy}`;
  return thisYear > today ? thisYear : `${y + 1}-${fy}`;
}

function StepBar({ step }: { step: number }) {
  return (
    <ol style={css('margin: 0; padding: 0; list-style: none; display: flex; gap: 0; font-size: 13px; counter-reset: s')}>
      {STEPS.map((name, i) => {
        const n = i + 1;
        const pad = n === STEPS.length ? 'padding: 8px 0' : 'padding: 8px 12px 8px 0';
        if (n < step) return <li key={n} style={css(`flex: 1; ${pad}; border-top: 2px solid #0f62fe; color: #0f62fe`)}>{n} {name}<br /><span style={css('color: #525252')}>เสร็จ</span></li>;
        if (n === step) return <li key={n} aria-current="step" style={css(`flex: 1; ${pad}; border-top: 2px solid #0f62fe; font-weight: 600`)}>{n} {name}<br /><span style={css('color: #525252; font-weight: 400')}>กำลังทำ</span></li>;
        return <li key={n} style={css(`flex: 1; ${pad}; border-top: 2px solid #e0e0e0; color: #525252`)}>{n} {name}<br />{' '}</li>;
      })}
    </ol>
  );
}

export function CreateWizard({ initialStep, plan, today, planHref, companiesHref }: { initialStep: 1 | 2; plan: PlanNote | null; today: string; planHref: string; companiesHref: string }) {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [branch, setBranch] = useState('00000');
  const [fy, setFy] = useState('01-01');
  const [goLive, setGoLive] = useState(() => thaiDate(nextFiscalStart('01-01', today)));
  const [template, setTemplate] = useState<Template>('service');
  const [mods, setMods] = useState({ assets: true, payroll: false, dimensions: true });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const changeFy = (v: string) => { setFy(v); setGoLive(thaiDate(nextFiscalStart(v, today))); };

  async function create(then: 'next' | 'later') {
    setMsg(null);
    const iso = parseThaiDate(goLive);
    if (!iso) { setMsg('วันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)'); return; }
    setBusy(true);
    try {
      const res = await fetch('/companies/api/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nameTh: name, ...(taxId.trim() ? { taxId: taxId.trim() } : {}), branchCode: branch, fiscalYearStart: fy, goLive: iso, template,
          modules: { core: true, assets: mods.assets, inventory: false, payroll: mods.payroll, dimensions: mods.dimensions },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) { setMsg(body.error ?? `HTTP ${res.status}`); return; }
      // บริษัทใหม่อยู่ขั้น 3 (ยอดยกมา) — /companies/select ตั้ง cookie บริษัทแล้วพาไปขั้นที่ค้าง
      window.location.assign(then === 'next' ? `/companies/select?id=${encodeURIComponent(body.id)}` : companiesHref);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <main style={css('flex: 1; display: flex; justify-content: center; padding: 48px 32px 96px; box-sizing: border-box')}>
        <div style={css('width: 100%; max-width: 880px; display: flex; flex-direction: column; gap: 24px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>สร้างบริษัทใหม่</h1><span style={css('font-size: 13px; color: #525252')}>5 ขั้น · ใช้เวลาประมาณ 10 นาที · ออกจากหน้าไปก่อนได้ ระบบจำขั้นที่ค้างไว้</span></div>
          <StepBar step={step} />
          {step === 1 ? (
            <section style={css(SECTION)}>
              <div><h2 style={css('margin: 0; font-size: 18px; line-height: 26px; font-weight: 600')}>{STEPS[0]}</h2></div>
              <div style={css('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px')}>
                <label style={css(`grid-column: span 2; ${LABEL}`)}>ชื่อนิติบุคคล (ไทย)<input value={name} onChange={(e) => setName(e.target.value)} style={css(SELECT)} /></label>
                <label style={css(LABEL)}>เลขประจำตัวผู้เสียภาษี 13 หลัก<input value={taxId} inputMode="numeric" maxLength={13} onChange={(e) => setTaxId(e.target.value.replace(/\D/gu, ''))} style={css(`${SELECT}; font-variant-numeric: tabular-nums`)} /></label>
                <label style={css(LABEL)}>สาขา<select value={branch} onChange={(e) => setBranch(e.target.value)} style={css(SELECT)}><option value="00000">สำนักงานใหญ่ (00000)</option><option value="00001">สาขาที่ 00001</option></select></label>
              </div>
            </section>
          ) : (
            <section style={css(SECTION)}>
              <div>
                <h2 style={css('margin: 0; font-size: 18px; line-height: 26px; font-weight: 600')}>ปีบัญชีและผังบัญชีเริ่มต้น</h2>
                {/* TODO(Wei): แบบร่างมี "(ดึงจาก DBD แล้ว ✓)" — ยังไม่มีการดึงข้อมูลจาก DBD จึงไม่แสดง */}
                <span style={css('font-size: 13px; color: #525252')}>บริษัท: {name || '—'}{taxId ? ` · เลขผู้เสียภาษี ${taxId}` : ''}</span>
              </div>
              <div style={css('display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px')}>
                {/* TODO(Wei): "กำหนดเอง" ไม่มีแบบร่างช่องกรอกเดือนเริ่ม → ยังเลือกไม่ได้ */}
                <label style={css(LABEL)}>รอบปีบัญชี<select value={fy} onChange={(e) => changeFy(e.target.value)} style={css(SELECT)}><option value="01-01">1 ม.ค. – 31 ธ.ค.</option><option value="04-01">1 เม.ย. – 31 มี.ค.</option><option value="custom" disabled>กำหนดเอง</option></select></label>
                <label style={css(LABEL)}>เริ่มใช้ระบบตั้งแต่<input value={goLive} onChange={(e) => setGoLive(e.target.value)} style={css(`${SELECT}; font-variant-numeric: tabular-nums`)} /></label>
                {/* TODO(Wei): งวดรายไตรมาส — id-api/ledger รองรับเฉพาะ 12 งวด (+ งวด 13) จึงยังเลือกไม่ได้ */}
                <label style={css(LABEL)}>งวดบัญชี<select defaultValue="monthly" style={css(SELECT)}><option value="monthly">รายเดือน (12 งวด)</option><option value="quarterly" disabled>รายไตรมาส</option></select></label>
              </div>
              <div style={css('display: flex; flex-direction: column; gap: 12px')}>
                <span style={css('font-size: 13px; color: #525252')}>ผังบัญชีเริ่มต้น — เลือกแม่แบบ ปรับแก้ทีหลังได้ทุกบัญชี</span>
                <div style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px')}>
                  {TEMPLATES.map((t) => (
                    <label key={t.id} style={css(`border: 1px solid ${template === t.id ? '#0f62fe; background: #edf5ff' : '#e0e0e0'}; padding: 16px; display: flex; gap: 12px; cursor: pointer`)}>
                      <input type="radio" name="coa" checked={template === t.id} onChange={() => setTemplate(t.id)} style={css('margin-top: 4px')} />
                      <div><div style={css('font-weight: 600')}>{t.title}</div><div style={css('font-size: 13px; color: #525252')}>{t.desc}</div></div>
                    </label>
                  ))}
                </div>
              </div>
              <div style={css('display: flex; flex-direction: column; gap: 8px; font-size: 14px')}>
                <span style={css('font-size: 13px; color: #525252')}>โมดูลที่ต้องการ (เปิด–ปิดทีหลังได้)</span>
                <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked disabled readOnly /> บัญชีแยกประเภท ขาย ซื้อ การเงิน ภาษี รายงาน (หลัก)</label>
                <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={mods.assets} onChange={(e) => setMods({ ...mods, assets: e.target.checked })} /> สินทรัพย์ถาวรและค่าเสื่อมราคา</label>
                <label style={css('display: flex; gap: 8px; align-items: center; color: #525252')}><input type="checkbox" disabled /> สินค้าคงคลัง (สต็อก) — เปิดให้ใน v2</label>
                <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={mods.payroll} onChange={(e) => setMods({ ...mods, payroll: e.target.checked })} /> เงินเดือน / ภ.ง.ด.1 / ประกันสังคม</label>
                <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={mods.dimensions} onChange={(e) => setMods({ ...mods, dimensions: e.target.checked })} /> มิติ: รถ / เที่ยว / โครงการ / สาขา</label>
              </div>
            </section>
          )}
          {msg && <div role="alert" style={css('padding: 12px 16px; background: #ffffff; border: 1px solid #e0e0e0; border-left: 3px solid #da1e28; font-size: 14px')}>{msg}</div>}
          <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 14px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px')}>
            <span style={css('color: #525252')}>{plan ? `บริษัทนี้จะเป็นบริษัทที่ ${plan.nth} ในแผน ${plan.plan} (${plan.nth}/${plan.limit}) · ` : ''}บริษัทถัดไปคิดเพิ่มตามแผน · <a href={planHref} style={css('text-decoration: none')}>ดูราคา</a></span>
            {/* TODO(Wei): "ฐานข้อมูลแยก schema ต่อบริษัท" ขัดกับ ADR-001 (ตารางรวม + company_id + RLS) — คงข้อความตามแบบร่างไว้ รอ Wei แก้ถ้อยคำ */}
            <span style={css('color: #525252')}>ฐานข้อมูลแยก schema ต่อบริษัท · สำรองข้อมูลรายวัน</span>
          </section>
        </div>
      </main>
      <div style={css('position: sticky; bottom: 0; display: flex; justify-content: center; background: #ffffff; border-top: 1px solid #e0e0e0')}>
        <div style={css('width: 100%; max-width: 880px; height: 64px; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; box-sizing: border-box')}>
          {step === 1 ? <ButtonLink href={companiesHref}>← ย้อนกลับ</ButtonLink> : <Button onClick={() => { setMsg(null); setStep(1); }}>← ย้อนกลับ</Button>}
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            {step === 1
              ? <Button kind="primary" onClick={() => setStep(2)}>ถัดไป: {STEPS[1]}</Button>
              : (
                <>
                  <Button disabled={busy} onClick={() => void create('later')}>บันทึกและทำต่อทีหลัง</Button>
                  <Button kind="primary" disabled={busy} onClick={() => void create('next')}>ถัดไป: ยอดยกมา</Button>
                </>
              )}
          </div>
        </div>
      </div>
    </>
  );
}
