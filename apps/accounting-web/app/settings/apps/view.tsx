'use client';
// G3 แอปที่เชื่อมต่อ — design/project/ScreenApps.dc.html (ข้อความ/ลำดับตามแบบร่าง · ตัวเลขจาก API · ส่วนที่ยังไม่มี backend แสดง "—")
import { css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CreateClient, CreateWebhook } from './_shared/create.tsx';
import { BTN32, BTN_OFF, DOT, LINK_BTN, send, TAG, TAG_TONE } from './_shared/hub.ts';

type Tone = keyof typeof TAG_TONE;
export interface ExtRow { id: string; name: string; type: string; scopes: string; lastUsed: string; status: { tone: Tone; text: string }; muted: boolean; deadIds: string[] }
export interface AppsData {
  error: string | null;
  tms: { connected: string | null; status: { tone: Tone; text: string }; hooks24: string; deadIds: string[]; notify: boolean };
  rows: ExtRow[];
}

const TH = 'padding: 0 12px; font-weight: 400';
const TD = 'padding: 0 12px';
const TDG = 'padding: 0 12px; color: #525252';
const MAP_TD = 'height: 32px';

function StatusTag({ s }: { s: { tone: Tone; text: string } }) {
  return <span style={css(`${TAG}; ${TAG_TONE[s.tone]}`)}><span style={css(DOT)} />{s.text}</span>;
}

export function AppsView({ data }: { data: AppsData }) {
  const router = useRouter();
  const [panel, setPanel] = useState<null | 'key' | 'hook'>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function redeliver(ids: string[]) {
    setBusy(true); setMsg(null);
    for (const id of ids) {
      const r = await send<{ ok: boolean }>(`/api/proxy/webhooks/deliveries/${encodeURIComponent(id)}/redeliver`, 'POST');
      if (!r.ok) { setBusy(false); setMsg({ ok: false, text: r.error }); return; }
    }
    setBusy(false);
    // TODO(Wei): ข้อความยืนยันหลังส่งซ้ำไม่มีในแบบร่าง ScreenApps.dc.html
    setMsg({ ok: true, text: `ส่งซ้ำ ${ids.length} รายการ — เข้าคิวส่งรอบถัดไป` });
    router.refresh();
  }

  return (
    <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 24px')}>
      <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>แอปที่เชื่อมต่อ</h1><span style={css('font-size: 13px; color: #525252')}>ระบบบัญชีเป็นศูนย์กลาง (hub) · แอปของ Innovera เชื่อมได้ในคลิกเดียวด้วย Innovera ID · แอปอื่นใช้ API key / webhook</span></div>
      {data.error && <div role="alert" style={css('font-size: 14px; color: #a2191f')}>{data.error}</div>}
      {msg && <div role="status" style={css(`font-size: 14px; color: ${msg.ok ? '#0e6027' : '#a2191f'}`)}>{msg.text}</div>}

      <section style={css('display: flex; flex-direction: column; gap: 12px')}>
        <div style={css('font-size: 13px; color: #525252')}>แอป Innovera (เชื่อมด้วย Innovera ID)</div>
        {/* TODO(Wei) T14: แบบร่างให้ TMS เชื่อมด้วย Innovera ID (OAuth) — v1 ใช้ API key ชนิด tms ที่ออกให้ในหน้านี้ */}
        <div style={css('border: 1px solid #e0e0e0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0')}>
          <div style={css('padding: 16px; border-right: 1px solid #e0e0e0; display: flex; flex-direction: column; gap: 8px')}>
            <div style={css('display: flex; justify-content: space-between; align-items: center')}>
              <div style={css('display: flex; align-items: center; gap: 12px')}>
                <span style={css('width: 40px; height: 40px; background: #393939; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px')}>TMS</span>
                {/* TODO(Wei): สถานะ "ยังไม่เชื่อมต่อ" ไม่มีในแบบร่าง → แสดง "—" + ป้าย "ปิดอยู่" */}
                <div><div style={css('font-weight: 600')}>TMS — ระบบบริหารงานขนส่ง/ติดตั้งภาคสนาม</div><div style={css('font-size: 13px; color: #525252')}>{data.tms.connected ?? '—'}</div></div>
              </div>
              <StatusTag s={data.tms.status} />
            </div>
            <table style={css('border-collapse: collapse; font-size: 14px; width: 100%')}><tbody>
              {/* TODO(backend): นับเหตุการณ์รับเข้าจาก TMS (ext POST documents) · คู่ค้าที่ซิงก์/ขัดแย้ง · คิวรอดำเนินการ — ยังไม่มี endpoint */}
              <tr><td style={css('height: 28px; color: #525252')}>เหตุการณ์รับเข้า 24 ชม.</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>— รายการ · ล้มเหลว —</td></tr>
              <tr><td style={css('height: 28px; color: #525252')}>แจ้งกลับ (webhook) 24 ชม.</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{data.tms.hooks24}</td></tr>
              <tr><td style={css('height: 28px; color: #525252')}>คู่ค้าที่ซิงก์ (ตามเลขผู้เสียภาษี)</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>— ราย · ขัดแย้ง —</td></tr>
              <tr><td style={css('height: 28px; color: #525252')}>รอดำเนินการในคิว</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>—</td></tr>
            </tbody></table>
            <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
              {/* TODO(backend): แก้การแม็ปเหตุการณ์ TMS → สูตรลงบัญชี ยังไม่มี endpoint → ปุ่มใช้ไม่ได้ */}
              <button type="button" disabled style={css(`${BTN32}; ${BTN_OFF}`)}>ตั้งค่าการแม็ป</button>
              <a href="/settings/audit" style={css(`${BTN32}; text-decoration: none`)}>ดูบันทึกเหตุการณ์</a>
              <button type="button" disabled={busy || !data.tms.deadIds.length} onClick={() => void redeliver(data.tms.deadIds)} style={css(`${BTN32}${busy || !data.tms.deadIds.length ? `; ${BTN_OFF}` : ''}`)}>ส่งซ้ำที่ล้มเหลว</button>
            </div>
          </div>
          <div style={css('padding: 16px; display: flex; flex-direction: column; gap: 10px; font-size: 14px')}>
            <strong>การแม็ปจาก TMS → บัญชี</strong>
            {/* TODO(Wei): ตารางแม็ปนี้คัดจากแบบร่าง (ค่าตายตัว) — ยังไม่ผูกกับสูตรลงบัญชีจริงในระบบ */}
            <table style={css('border-collapse: collapse; width: 100%; font-size: 14px')}>
              <thead><tr style={css('color: #525252; font-size: 13px')}><th style={css('text-align: left; font-weight: 400; height: 28px')}>เหตุการณ์ TMS</th><th style={css('text-align: left; font-weight: 400')}>เอกสาร</th><th style={css('text-align: left; font-weight: 400')}>สูตร</th></tr></thead>
              <tbody>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MAP_TD)}>trip.completed (ลูกค้า)</td><td>IV ร่าง — รวมตามรอบวางบิล</td><td>Credit[Freight]</td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MAP_TD)}>subcontractor.bill</td><td>AP ร่าง · หัก 1%</td><td>Credit[AP-Sub]</td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MAP_TD)}>fuel.fillup</td><td>EXP · มิติ vehicle</td><td>Cash[Fuel]</td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MAP_TD)}>driver.advance</td><td>JV เงินทดรอง</td><td>Advance[Drv]</td></tr>
                <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MAP_TD)}>toll / fine</td><td>EXP · มิติ trip</td><td>Cash[Toll]</td></tr>
              </tbody>
            </table>
            {/* TODO(Wei): แบบร่างเขียนต่อท้ายว่า "(เปลี่ยนเป็นอัตโนมัติได้ต่อเหตุการณ์)" ขัดกับ CLAUDE.md/PLAN §5 (API สร้างได้แค่ร่าง) → PLAN ชนะ ตัดวงเล็บนั้นออก */}
            <span style={css('font-size: 13px; color: #525252')}>ทุกเหตุการณ์มี external_source + external_ref กันซ้ำ · เอกสารเข้ามาเป็น &quot;ร่าง&quot; และต้องมีคนผ่านรายการ</span>
            {/* สถานะจริง = มี webhook ของ client ชนิด tms · เปิด/ปิดจากหน้านี้ยังไม่มี endpoint (TODO backend) */}
            <label style={css('display: flex; gap: 8px; align-items: center')}><input type="checkbox" checked={data.tms.notify} disabled readOnly /> แจ้งกลับ TMS เมื่อ: document.posted, payment.received, payment.paid, document.voided</label>
          </div>
        </div>
        <div style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
          <div style={css('display: flex; align-items: center; gap: 12px')}>
            <span style={css('width: 40px; height: 40px; border: 1px dashed #8d8d8d; display: flex; align-items: center; justify-content: center; color: #8d8d8d; font-size: 13px')}>+</span>
            <div><div style={css('font-weight: 600')}>แอป Innovera อื่นในอนาคต (HR / Payroll, CRM, Fleet)</div><div style={css('font-size: 13px; color: #525252')}>จะปรากฏที่นี่เมื่อองค์กรเปิดใช้ · เชื่อมคลิกเดียว</div></div>
          </div>
        </div>
      </section>

      <section style={css('display: flex; flex-direction: column; gap: 12px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: center')}>
          <div style={css('font-size: 13px; color: #525252')}>แอปภายนอก / API key</div>
          <div style={css('display: flex; gap: 8px')}>
            {/* TODO(Wei): ปุ่ม "+ เพิ่ม webhook" ไม่มีในแบบร่าง (มีแถว "Webhook ออก" แต่ไม่มีทางเพิ่ม) — เพิ่มไว้เพื่อใช้ POST /v1/webhooks */}
            <button type="button" onClick={() => setPanel('hook')} style={css(BTN32)}>+ เพิ่ม webhook</button>
            <button type="button" onClick={() => setPanel('key')} style={css(BTN32)}>+ สร้าง API key</button>
          </div>
        </div>
        {panel === 'key' && <CreateClient kinds={['custom', 'tms']} defaultScopes={['documents:read', 'documents:draft', 'contacts:read']} onClose={() => setPanel(null)} endpointNote="REST: /ext/v1 · Authorization: Bearer <API key>" />}
        {panel === 'hook' && <CreateWebhook onClose={() => setPanel(null)} />}
        <div style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 880px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>ชื่อ</th><th style={css(TH)}>ประเภท</th><th style={css(TH)}>ขอบเขต (scopes)</th><th style={css(`${TH}; white-space: nowrap`)}>ใช้ล่าสุด</th><th style={css(TH)}>สถานะ</th><th style={css(TH)}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การทำงาน</span></th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} data-testid="ext-row" style={css(`border-top: 1px solid #e0e0e0${r.muted ? '; color: #525252' : ''}`)}>
                  <td style={css(`height: 40px; padding: 0 12px; font-weight: 500${r.muted ? '; color: #161616' : ''}`)}>{r.name}</td>
                  <td style={css(`${TD}; white-space: nowrap`)}>{r.type}</td>
                  <td style={css(r.muted ? TD : TDG)}>{r.scopes}</td>
                  <td style={css(`${r.muted ? TD : TDG}; white-space: nowrap`)}>{r.lastUsed}</td>
                  <td style={css(TD)}><StatusTag s={r.status} /></td>
                  <td style={css('padding: 0 12px; white-space: nowrap')}>
                    {/* TODO(Wei): ปุ่มส่งซ้ำต่อ webhook ไม่มีในแบบร่าง (แบบร่างบอก "dead-letter แสดงในคิวหน้าแรก") — ใช้ชื่อปุ่มจากการ์ด TMS */}
                    {r.deadIds.length > 0 && <><button type="button" disabled={busy} onClick={() => void redeliver(r.deadIds)} style={css(LINK_BTN)}>ส่งซ้ำที่ล้มเหลว</button> · </>}
                    <a href="/settings/mcp" style={css('text-decoration: none')}>จัดการ</a>
                  </td>
                </tr>
              ))}
              {!data.rows.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={6} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap')}>
          <section style={css('flex: 1 1 360px; border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
            <strong>นำเข้า / ส่งออกไฟล์</strong>
            <span>· นำเข้าผังบัญชี ยอดยกมา คู่ค้า สินค้า จาก Excel (มีแม่แบบ)</span>
            <span>· นำเข้าเอกสารจาก Express / FlowAccount / PEAK (ตัวช่วยย้ายระบบ)</span>
            <span>· ส่งออก: Excel, CSV, ไฟล์ยื่นภาษีออนไลน์, งบการเงินตามรูปแบบ DBD e-Filing (XBRL)</span>
            {/* TODO(backend): ตัวช่วยย้ายระบบยังไม่มี → ปุ่มใช้ไม่ได้ */}
            <button type="button" disabled style={css(`${BTN32}; ${BTN_OFF}; align-self: flex-start`)}>เปิดตัวช่วยย้ายระบบ</button>
          </section>
          {/* TODO(Wei): แบบร่างเขียนเส้นทาง /v1/… แต่ API ภายนอกจริงอยู่ที่ /ext/v1/… · dimension=vehicle ยังไม่รองรับ (technical-plan-M7 ค้าง) — คงข้อความตามแบบร่าง */}
          <section style={css('flex: 1 1 360px; background: #f4f4f4; border: 1px solid #e0e0e0; padding: 16px; font-size: 13px; color: #525252; display: flex; flex-direction: column; gap: 6px')}>
            <strong style={css('color: #161616; font-size: 14px')}>สัญญา API (สรุป)</strong>
            <span>POST /v1/documents (batch ≤ 500) · idempotent ด้วย external_source + external_ref</span>
            <span>GET /v1/contacts?tax_id= · PUT /v1/contacts/:id (sync สองทาง)</span>
            <span>GET /v1/ledger/balances?dimension=vehicle (ให้ TMS ดึงต้นทุนต่อรถ)</span>
            <span>Webhooks ลงนาม HMAC · retry 3 ครั้ง · dead-letter แสดงในคิวหน้าแรก</span>
          </section>
        </div>
      </section>
    </div>
  );
}
