'use client';
// เพิกถอนสิทธิ์ — design/project/ScreenRevoke.dc.html (ข้อความ/ลำดับตามแบบร่าง · ชื่อ/ประเภท/สถานะจากข้อมูลจริง)
import { css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DOT, send, TAG, TAG_TONE } from '../apps/_shared/hub.ts';

export interface RevokeTarget {
  mode: 'client' | 'user'; id: string; kindLabel: string; name: string; authorizedBy: string; lastUsed: string; revoked: boolean; webhooks: number;
  crumb: { label: string; href: string }; back: string; sidebar: string;
}

const BTN40 = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; text-decoration: none; height: 40px; padding: 0 16px';
const SMALL = 'font-size: 13px; color: #525252';
const OPT = 'display: flex; gap: 10px; align-items: flex-start';
const SELECT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px; color: #161616';
const TH = 'height: 40px; padding: 0 12px; font-weight: 400';
const ROW = 'display: flex; justify-content: space-between; gap: 8px';

export function RevokeView({ target: t, error }: { target: RevokeTarget | null; error: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<'all' | 'readonly' | 'suspend'>('all');
  const [reason, setReason] = useState('เลิกใช้งาน');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(error ? { ok: false, text: error } : null);

  async function confirm() {
    if (!t) return;
    setBusy(true); setMsg(null);
    // TODO(backend): DELETE ยังไม่รับเหตุผล/ผู้ที่ต้องแจ้ง และไม่บันทึก audit log ของการเพิกถอน API key · ไม่มี step-up 2FA ("ต้องยืนยันด้วยรหัส 2FA")
    const r = t.mode === 'client'
      ? await send<{ ok: boolean }>(`/api/proxy/api-clients/${encodeURIComponent(t.id)}`, 'DELETE')
      : await send<{ ok: boolean }>(`/settings/users/api/users/${encodeURIComponent(t.id)}`, 'DELETE');
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    router.push(t.back);
    router.refresh();
  }

  const name = t?.name ?? '—';
  const live = t && !t.revoked;
  const isClient = t?.mode !== 'user';
  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}><a href={t?.crumb.href ?? '/settings/mcp'} style={css('text-decoration: none')}>{t?.crumb.label ?? 'การเชื่อมต่อ AI (MCP)'}</a> / {name} / เพิกถอน</span>
        {t && <span style={css(`${TAG}; ${live ? TAG_TONE.success : TAG_TONE.error}`)}><span style={css(DOT)} />{live ? 'ใช้งานอยู่' : 'เพิกถอนแล้ว'}</span>}
      </header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>เพิกถอนสิทธิ์: {name}</h1><span style={css(SMALL)}>ใช้หน้าเดียวกันสำหรับ MCP client, OAuth app, API key, ผู้สอบบัญชีภายนอก และผู้ใช้ในบริษัท</span></div>

        <section style={css('border: 1px solid #e0e0e0; padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 24px; font-size: 14px')}>
          <div><span style={css(SMALL)}>ประเภท</span><div style={css('font-weight: 600')}>{t?.kindLabel ?? '—'}</div></div>
          <div><span style={css(SMALL)}>ชื่อ</span><div>{name}</div></div>
          <div><span style={css(SMALL)}>อนุญาตโดย</span><div>{t?.authorizedBy ?? '—'}</div></div>
          <div><span style={css(SMALL)}>ใช้ล่าสุด</span><div>{t?.lastUsed ?? '—'}</div></div>
        </section>
        <div style={css('display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start')}>
          <section style={css('display: flex; flex-direction: column; gap: 16px')}>
            <fieldset style={css('border: 1px solid #e0e0e0; padding: 16px; margin: 0; display: flex; flex-direction: column; gap: 12px; font-size: 14px')}>
              <legend style={css('padding: 0 6px; font-weight: 600')}>ขอบเขตการเพิกถอน</legend>
              <label style={css(OPT)}><input type="radio" name="scope" checked={mode === 'all'} onChange={() => setMode('all')} style={css('margin-top: 5px')} /><span><strong>เพิกถอนทั้งหมดทันที</strong><br /><span style={css('color: #525252')}>ยกเลิก access token และ refresh token ทุกตัว · การเรียกครั้งถัดไปถูกปฏิเสธ · ต้องขออนุญาตใหม่ตั้งแต่ต้นหากจะกลับมาใช้</span></span></label>
              {/* TODO(backend): ลดสิทธิ์/ระงับชั่วคราวยังไม่มี endpoint (api_client ไม่มีสถานะ suspended · แก้ scopes ไม่ได้) → ตัวเลือกใช้ไม่ได้ */}
              <label style={css(`${OPT}; color: #8d8d8d`)}><input type="radio" name="scope" disabled checked={mode === 'readonly'} onChange={() => setMode('readonly')} style={css('margin-top: 5px')} /><span><strong>ลดสิทธิ์เป็นอ่านอย่างเดียว</strong><br /><span>ตัด documents:draft และ contacts:draft ออก คงเหลือ read เท่านั้น — เหมาะเมื่อยังอยากให้ตอบคำถามจากข้อมูลได้</span></span></label>
              <label style={css(`${OPT}; color: #8d8d8d`)}><input type="radio" name="scope" disabled checked={mode === 'suspend'} onChange={() => setMode('suspend')} style={css('margin-top: 5px')} /><span><strong>ระงับชั่วคราว 7 วัน</strong><br /><span>ปิดการเรียกใช้โดยไม่ลบการอนุญาต · เปิดกลับได้โดยไม่ต้องขอใหม่</span></span></label>
            </fieldset>
            <section style={css('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px')}>
              <label style={css('display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>เหตุผล (บังคับ)<select value={reason} onChange={(e) => setReason(e.target.value)} style={css(SELECT)}><option>เลิกใช้งาน</option><option>สงสัยการเข้าถึงผิดปกติ</option><option>เปลี่ยนผู้รับผิดชอบ</option><option>พนักงานลาออก / สิ้นสุดสัญญา</option><option>อื่น ๆ (ระบุ)</option></select></label>
              {/* TODO(backend): ยังไม่มีอีเมลแจ้งการเพิกถอน → ช่องนี้ยังไม่มีผล */}
              <label style={css('display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>แจ้งผู้เกี่ยวข้อง<input defaultValue="เจ้าของบริษัท + ผู้อนุญาตเดิม" style={css(SELECT)} /><span style={css(SMALL)}>อีเมลสรุปการเพิกถอนและเหตุผล</span></label>
            </section>
            <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
              <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>สิ่งที่ client นี้สร้างไว้และยังค้างอยู่</strong></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css(TH)}>รายการ</th><th style={css(TH)}>สถานะ</th><th style={css(TH)}>จัดการ</th></tr></thead>
                <tbody>
                  {/* TODO(backend): เอกสารร่าง/คู่ค้าที่เสนอยังไม่ผูกกับ api_client ที่สร้าง → แสดงไม่ได้ · webhook ของ client ที่ถูกเพิกถอนยังส่งต่อ (emitTx ไม่ตรวจ revoked_at) */}
                  {isClient ? (
                    <tr style={css('border-top: 1px solid #e0e0e0')}>
                      <td style={css('height: 40px; padding: 0 12px')}>Webhook ที่ลงทะเบียนไว้</td>
                      <td style={css('padding: 0 12px')}>{t && t.webhooks > 0
                        ? <span style={css(`${TAG}; ${TAG_TONE.warning}`)}><span style={css(DOT)} />{t.webhooks} รายการ</span>
                        : <span style={css(`${TAG}; ${TAG_TONE.neutral}`)}><span style={css(DOT)} />ไม่มี</span>}</td>
                      <td style={css('padding: 0 12px; color: #525252')}>—</td>
                    </tr>
                  ) : (
                    <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={3} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('background: #fff1f1; border: 1px solid #ffb3b8; padding: 12px 16px; font-size: 13px; color: #a2191f')}>การเพิกถอนมีผลทันทีและย้อนกลับไม่ได้ (ต้องขออนุญาตใหม่) · บันทึกใน Audit log พร้อมผู้ทำและเหตุผล · ใช้สิทธิ์ Owner หรือผู้ที่อนุญาตไว้เดิม</section>
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
              <strong>หน้านี้ใช้กับ</strong>
              <div style={css(ROW)}><span>MCP / OAuth client</span><span style={css('color: #525252')}>token + scopes</span></div>
              <div style={css(ROW)}><span>ผู้สอบบัญชีภายนอก</span><span style={css('color: #525252')}>ปิดการเข้าถึงก่อนกำหนด</span></div>
              <div style={css(ROW)}><span>ผู้ใช้ในบริษัท</span><span style={css('color: #525252')}>ถอดออกจากบริษัทนี้ · Innovera ID ยังอยู่</span></div>
              <div style={css(ROW)}><span>API key</span><span style={css('color: #525252')}>ยกเลิกคีย์ · สร้างใหม่ได้</span></div>
            </section>
            {/* TODO(backend): การเรียก MCP/API ไม่ถูกบันทึกเป็นสถิติ → แสดง "—" */}
            <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}>
              <strong>กิจกรรม 24 ชม. ล่าสุดของ client นี้</strong>
              <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>run_report / get_ledger</span><span style={css('font-variant-numeric: tabular-nums')}>— ครั้ง</span></div>
              <div style={css('display: flex; justify-content: space-between; color: #525252')}><span>create_draft_document</span><span style={css('font-variant-numeric: tabular-nums')}>— ครั้ง</span></div>
              <div style={css('display: flex; justify-content: space-between; color: #a2191f')}><span>ถูกปฏิเสธ (ไม่มี scope)</span><span style={css('font-variant-numeric: tabular-nums')}>— ครั้ง</span></div>
              <a href="/settings/audit" style={css('font-size: 13px; text-decoration: none')}>ดูทั้งหมดใน Audit log</a>
            </section>
          </aside>
        </div>
        {msg && <div role={msg.ok ? 'status' : 'alert'} style={css(`font-size: 14px; color: ${msg.ok ? '#0e6027' : '#a2191f'}`)}>{msg.text}</div>}
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; flex-wrap: wrap')}>
        {/* TODO(Wei/backend): ยังไม่มี step-up 2FA ก่อนเพิกถอน (id-api) — ข้อความคงตามแบบร่าง */}
        <span style={css(SMALL)}>ต้องยืนยันด้วยรหัส 2FA</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <a href={t?.back ?? '/settings/mcp'} style={css(`${BTN40}; background: #ffffff; color: #161616; border: 1px solid #8d8d8d`)}>กลับ</a>
          <button type="button" disabled={!live || busy || mode !== 'all'} onClick={() => void confirm()}
            style={css(`${BTN40}; ${live && !busy ? 'background: #da1e28; color: #ffffff; border: 1px solid #da1e28' : 'background: #e0e0e0; color: #6f6f6f; border: 1px solid #e0e0e0; cursor: not-allowed'}`)}>ยืนยันเพิกถอน</button>
        </div>
      </div>
    </>
  );
}
