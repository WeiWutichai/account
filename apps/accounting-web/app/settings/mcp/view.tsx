'use client';
// G6 การเชื่อมต่อ MCP / OAuth client — design/project/ScreenMcp.dc.html (ข้อความ/ลำดับตามแบบร่าง · รายการ client จาก API)
import { css } from '@innovera/ui';
import { useState } from 'react';
import { CreateClient } from '../apps/_shared/create.tsx';
import { BTN32P, DOT, TAG, TAG_TONE } from '../apps/_shared/hub.ts';

export interface McpRow { id: string; name: string; clientId: string; kind: string; scopes: string[]; lastUsed: string; revoked: string | null; authorizedBy: string; suspended: boolean }
/** แถว "ล่าสุดจาก client" (acct.api_call) · review = ร่างที่สร้างยังรอตรวจ */
export interface McpCall { id: string; when: string; text: string; status: 'ok' | 'review' | 'denied' | 'error' }
const CALL_STATUS: Record<McpCall['status'], { text: string; color: string }> = {
  review: { text: 'รอตรวจ', color: '#684e00' }, ok: { text: 'สำเร็จ', color: '#0e6027' }, denied: { text: 'ปฏิเสธ · ไม่มี scope', color: '#a2191f' },
  // TODO(Wei): ข้อความสถานะเมื่อเครื่องมือทำงานผิดพลาด (ไม่ใช่การปฏิเสธสิทธิ์) ไม่มีในแบบร่าง
  error: { text: '—', color: '#a2191f' },
};

const TH = 'padding: 0 12px; font-weight: 400';
const TH36 = 'height: 36px; padding: 0 12px; font-weight: 400';
const TDG = 'padding: 0 12px; color: #525252';
const CHIP = 'display: inline-block; padding: 0 6px; margin: 1px 2px 1px 0; background: #e0e0e0; border: 1px solid #c6c6c6; border-radius: 4px';
const MONO = "height: 36px; padding: 0 12px; font-family: 'IBM Plex Mono', monospace; font-size: 13px";
const STAT_L = 'color: #525252; font-size: 13px';
const STAT_N = 'font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums';
const POLICY = 'display: flex; gap: 8px; align-items: center';

export function McpView({ rows, calls, stats, endpoint, active, error }: {
  rows: McpRow[]; calls: McpCall[]; stats: { calls: number; denied: number; drafts: number | null }; endpoint: string; active: number; error: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 24px')}>
      <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>การเชื่อมต่อ MCP / OAuth client</h1><span style={css('font-size: 13px; color: #525252')}>ให้ AI assistant และแอปภายนอกเข้าถึงข้อมูลบัญชีผ่าน MCP server ของบริษัทนี้ · ทุก client ขอสิทธิ์เป็นรายขอบเขต (scopes) · <strong style={css('color: #161616')}>สร้างได้เฉพาะเอกสารร่าง</strong> — การผ่านรายการ จ่ายเงิน และปิดงวดต้องทำโดยผู้ใช้ในระบบเท่านั้น · เพิกถอนได้ทันที</span></div>
      {error && <div role="alert" style={css('font-size: 14px; color: #a2191f')}>{error}</div>}

      <div style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
        <div>
          <span style={css(STAT_L)}>MCP endpoint</span>
          <div data-testid="mcp-endpoint" style={css("font-family: 'IBM Plex Mono', monospace; font-size: 14px")}>{endpoint}</div>
          {/* TODO(Wei) T14: แบบร่าง "Streamable HTTP · OAuth 2.1 + PKCE · Innovera ID เป็น authorization server" — v1 ยังไม่มี OAuth ใช้ API key (Bearer) ต่อบริษัท จึงแสดงตามจริง */}
          <span style={css('color: #525252')}>Streamable HTTP · Authorization: Bearer &lt;API key&gt;</span>
        </div>
        <div><span style={css(STAT_L)}>Client ที่ใช้งาน</span><div style={css(STAT_N)}>{active}</div></div>
        <div><span style={css(STAT_L)}>เรียกใช้ 7 วัน</span><div style={css(STAT_N)}>{stats.calls.toLocaleString('en-US')}</div><span style={css('color: #525252')}>ถูกปฏิเสธเพราะเกินสิทธิ์ {stats.denied.toLocaleString('en-US')}</span></div>
        {/* TODO(Wei): "อยู่ในคิวหน้าแรก" — คิวหน้าแรกยังไม่แยกร่างที่สร้างโดย client (จำนวนนับจาก document.created_by_client) */}
        <div><span style={css(STAT_L)}>ร่างที่สร้างโดย client รอตรวจ</span><div style={css(`${STAT_N}; color: #684e00`)}>{stats.drafts ?? '—'}</div><span style={css('color: #525252')}>อยู่ในคิวหน้าแรก</span></div>
      </div>

      <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
        <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}>
          <strong style={css('font-weight: 600')}>Client ที่ได้รับอนุญาต</strong>
          <button type="button" onClick={() => setOpen(true)} style={css(BTN32P)}>+ ลงทะเบียน client ใหม่</button>
        </div>
        {open && <div style={css('padding: 16px; border-bottom: 1px solid #e0e0e0')}><CreateClient kinds={['mcp', 'custom', 'tms']} defaultScopes={['documents:read', 'documents:draft', 'ledger:read', 'reports:read', 'contacts:read']} onClose={() => setOpen(false)} endpointNote={`MCP endpoint: POST ${endpoint} · Authorization: Bearer <API key>`} /></div>}
        <table style={css('width: 100%; min-width: 1080px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
          <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>Client</th><th style={css(TH)}>ชนิด</th><th style={css(TH)}>อนุญาตโดย / ทำงานในนาม</th><th style={css(TH)}>Scopes</th><th style={css(TH)}>ใช้ล่าสุด</th><th style={css(TH)}>หมดอายุ</th><th style={css(TH)}><span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>การทำงาน</span></th></tr></thead>
          <tbody>
            {rows.map((r) => r.revoked ? (
              <tr key={r.id} data-testid="mcp-row" style={css('border-top: 1px solid #e0e0e0; color: #525252')}>
                <td style={css('height: 48px; padding: 0 12px')}><div style={css('font-weight: 500; text-decoration: line-through')}>{r.name}</div><div style={css('font-size: 13px')}>{r.revoked}</div></td>
                <td style={css('padding: 0 12px')}>{r.kind}</td>
                <td style={css('padding: 0 12px')}>{r.authorizedBy}</td>
                <td style={css('padding: 0 12px; font-size: 13px')}>{r.scopes.join(', ')}</td>
                <td style={css('padding: 0 12px')}>{r.lastUsed}</td>
                <td style={css('padding: 0 12px')}><span style={css(`${TAG}; ${TAG_TONE.error}`)}><span style={css(DOT)} />เพิกถอนแล้ว</span></td>
                <td style={css('padding: 0 12px')}></td>
              </tr>
            ) : (
              <tr key={r.id} data-testid="mcp-row" style={css('border-top: 1px solid #e0e0e0')}>
                <td style={css('height: 48px; padding: 0 12px')}><div style={css('font-weight: 500')}>{r.name}</div><div style={css('font-size: 13px; color: #525252')}>client_id {r.clientId}</div></td>
                <td style={css('padding: 0 12px')}>{r.kind}</td>
                {/* TODO(Wei): แบบร่างต่อท้ายบทบาท/ขอบเขต ("Wei · Owner" · "สิทธิ์ไม่เกินผู้อนุญาต") — v1 แสดงเฉพาะชื่อผู้อนุญาต */}
                <td style={css('padding: 0 12px')}>{r.authorizedBy}</td>
                <td style={css('padding: 0 12px; font-size: 13px')}>{r.scopes.map((s) => <span key={s} style={css(CHIP)}>{s}</span>)}</td>
                <td style={css(TDG)}>{r.lastUsed}</td>
                {/* API key v1 ไม่มีวันหมดอายุ (TODO(Wei) T14: token 1 ชม./refresh ตามแบบร่างเป็นของ OAuth)
                    TODO(Wei): สถานะ "ระงับชั่วคราว" และปุ่มเปิดกลับไม่มีในแบบร่างหน้านี้ — แสดงป้ายด้วยคำจาก ScreenRevoke.dc.html · เปิดกลับ = POST /v1/api-clients/:id/resume (ยังไม่มีปุ่ม) */}
                <td style={css(TDG)}>{r.suspended ? <span style={css(`${TAG}; ${TAG_TONE.warning}`)}><span style={css(DOT)} />ระงับชั่วคราว</span> : '—'}</td>
                <td style={css('padding: 0 12px; white-space: nowrap')}>
                  {/* TODO(Wei): แบบร่างลิงก์ "แก้สิทธิ์" ไป ScreenUserEdit (หน้าสิทธิ์ผู้ใช้ ไม่มีช่อง scopes ของ client) — backend มี PUT /v1/api-clients/:id/scopes แล้ว รอแบบร่างหน้าแก้ scopes → แสดงเป็นข้อความเทา */}
                  <span style={css('color: #8d8d8d')} title="ยังไม่รองรับ">แก้สิทธิ์</span> · <a href={`/settings/revoke?client=${encodeURIComponent(r.id)}`} style={css('text-decoration: none; color: #da1e28')}>เพิกถอน</a>
                </td>
              </tr>
            ))}
            {!rows.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={7} style={css('height: 48px; padding: 0 12px; color: #525252')}>—</td></tr>}
          </tbody>
        </table>
      </section>

      <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; align-items: start')}>
        <section id="scopes" style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ขอบเขตสิทธิ์ที่เปิดให้ (scopes) และเครื่องมือ MCP ที่ตามมา</strong></div>
          {/* TODO(Wei): ชื่อเครื่องมือในตารางคัดจากแบบร่าง — MCP v1 มีจริง: list_documents, get_document, trial_balance, create_draft_document (+ post_document ที่ปฏิเสธเสมอ) */}
          <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css(TH36)}>Scope</th><th style={css(TH)}>เครื่องมือ (tools)</th><th style={css(TH)}>ข้อจำกัด</th></tr></thead>
            <tbody>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MONO)}>documents:read</td><td style={css('padding: 0 12px')}>list_documents, get_document, search</td><td style={css(TDG)}>ปิดบังข้อมูลตาม PDPA (เลขบัตร/บัญชี)</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MONO)}>documents:draft</td><td style={css('padding: 0 12px')}>create_draft_document, update_draft, attach_file</td><td style={css('padding: 0 12px; color: #a2191f')}>สถานะ &quot;ร่าง&quot; เท่านั้น · ห้าม post/void/pay · ต้องผ่านคนก่อนเสมอ</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MONO)}>contacts:read / contacts:draft</td><td style={css('padding: 0 12px')}>find_contact_by_tax_id, propose_contact</td><td style={css(TDG)}>เสนอคู่ค้าใหม่เข้าคิวอนุมัติ</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MONO)}>ledger:read</td><td style={css('padding: 0 12px')}>get_trial_balance, get_ledger, get_balances(dimension)</td><td style={css(TDG)}>เฉพาะงวดที่ผู้อนุญาตเข้าถึงได้</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MONO)}>reports:read · tax:read</td><td style={css('padding: 0 12px')}>run_report(format_id), get_vat_return, get_wht_summary</td><td style={css(TDG)}>อ่านอย่างเดียว</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css(MONO)}>schema:read · webhooks:manage</td><td style={css('padding: 0 12px')}>describe_schema, posting_rules, register_webhook</td><td style={css(TDG)}>สำหรับนักพัฒนา · Owner เท่านั้น</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0; color: #525252')}><td style={css(MONO)}>ไม่มีให้: documents:post, payments:*, periods:*, users:*, settings:*</td><td style={css('padding: 0 12px')} colSpan={2}>การกระทำที่มีผลทางบัญชี/การเงิน/สิทธิ์ ทำได้เฉพาะในระบบโดยผู้ใช้ที่ยืนยันตัวตน + 2FA</td></tr>
            </tbody>
          </table>
        </section>
        <section style={css('display: flex; flex-direction: column; gap: 16px')}>
          {/* TODO(backend): นโยบายการเชื่อมต่อยังไม่มีที่เก็บ/ไม่มีผลกับระบบ → แสดงค่าตามแบบร่างแบบอ่านอย่างเดียว */}
          <fieldset disabled style={css('border: 1px solid #e0e0e0; padding: 16px; margin: 0; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
            <legend style={css('position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)')}>นโยบายการเชื่อมต่อ (บริษัทนี้)</legend>
            <strong>นโยบายการเชื่อมต่อ (บริษัทนี้)</strong>
            <label style={css(POLICY)}><input type="checkbox" defaultChecked /> อนุญาตให้ผู้ใช้เชื่อม MCP client ด้วยตนเอง (ไม่เกินสิทธิ์ของตน)</label>
            <label style={css(POLICY)}><input type="checkbox" defaultChecked /> Client ภายนอกต้องได้รับอนุมัติจาก Owner ก่อนใช้งาน</label>
            <label style={css(POLICY)}><input type="checkbox" defaultChecked /> ร่างที่สร้างโดย client ติดป้าย &quot;สร้างโดย AI/แอป&quot; และเข้าคิวตรวจ</label>
            <label style={css(POLICY)}><input type="checkbox" defaultChecked /> ปิดบังข้อมูลส่วนบุคคลใน response (PDPA) — ตั้งค่าในหน้าตั้งค่าเอกสาร</label>
            <label style={css(POLICY)}><input type="checkbox" /> จำกัดจำนวนเรียกใช้ 600 ครั้ง/ชม. ต่อ client</label>
            <label style={css('display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>อายุ refresh token สูงสุด<select style={css('height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px')}><option>90 วัน</option><option>30 วัน</option><option>7 วัน</option></select></label>
          </fieldset>
          <div style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}>
            <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between')}><strong style={css('font-weight: 600')}>ล่าสุดจาก client</strong><a href="/settings/audit" style={css('font-size: 13px; text-decoration: none')}>ดูทั้งหมดใน Audit log</a></div>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 13px')}><tbody>
              {calls.map((c, i) => (
                <tr key={c.id} data-testid="mcp-call" style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
                  <td style={css('height: 30px; padding: 0 16px; color: #525252; white-space: nowrap')}>{c.when}</td>
                  <td style={css('padding: 0 8px')}>{c.text}</td>
                  <td style={css(`padding: 0 16px; text-align: right; color: ${CALL_STATUS[c.status].color}`)}>{CALL_STATUS[c.status].text}</td>
                </tr>
              ))}
              {!calls.length && <tr><td style={css('height: 30px; padding: 0 16px; color: #525252')}>—</td></tr>}
            </tbody></table>
          </div>
        </section>
      </div>
    </div>
  );
}
