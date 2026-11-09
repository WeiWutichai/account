'use client';
// S1 หน้าแรก — คิวงาน · design/project/Main.dc.html (ตัวเลขจาก API · ส่วนที่ต้องใช้โมดูล M5/M6 แสดง "—")
import { Button, css, money } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client.ts';

/** คำขอเข้าดูข้อมูลของทีม Innovera (GET /v1/support-access · M8 consent) */
export interface SupportRequest { id: string; reason: string; scope: string; minutes: number; write_access: boolean; status: 'pending' | 'approved' | 'active'; created_at: string; started_at: string | null; ends_at: string | null; number: string | number; staff_name: string }

export interface HomeData {
  topLine: string;
  support: (SupportRequest & { when: string; until: string | null })[];
  pending: { count: number; iv: number };
  arDue: { total: string; count: number; overdue: number };
  queue: { id: string; no: string; href: string; contact: string; sent: string; total: string; sender: string; approvable: boolean }[];
  close: { title: string; draftsLeft: number; bankLabel: string; month: string };
  cash: { bankLabel: string; bank: string; ar: string; ap: string; profitLabel: string; profit: string };
}

const BTN32P = 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 4px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; height: 32px; padding: 0 12px; background: #ffffff; color: #161616; border: 1px solid #8d8d8d; text-decoration: none';
const CARD = 'display: flex; flex-direction: column; gap: 2px; padding: 16px; border-right: 1px solid #e0e0e0; text-decoration: none; color: #161616';
const CARD_LAST = 'display: flex; flex-direction: column; gap: 2px; padding: 16px; text-decoration: none; color: #161616';
const SMALL = 'font-size: 13px; color: #525252';
const BIG = 'font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums';
const UNIT = 'font-size: 14px; font-weight: 400; color: #525252';

export function Home({ data }: { data: HomeData }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function approve(id: string) {
    const r = await call<{ docNo: string; journalNo?: string }>(`documents/${id}/approve`, 'POST');
    setMsg(r.ok ? { ok: true, text: `อนุมัติแล้ว ${r.data.docNo}${r.data.journalNo ? ` · ลงบัญชี ${r.data.journalNo}` : ''}` } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }
  // consent ของ Owner — ไม่ใช่ Owner → API ปฏิเสธ แสดงข้อความ error
  async function decide(id: string, approve: boolean) {
    const r = await call<{ ok: boolean }>(`support-access/${id}/decide`, 'POST', { approve });
    setMsg(r.ok ? { ok: true, text: approve ? 'อนุญาตให้ Innovera Support เข้าดูแล้ว' : 'ปฏิเสธคำขอเข้าดูแล้ว' } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>{data.topLine}</span>
        <div style={css('display: flex; gap: 8px')}>
          <a href="/sales/invoices/new" style={css(BTN32P)}>+ ใบกำกับภาษี</a>
          <a href="/purchase/expenses" style={css(BTN32P)}>+ ค่าใช้จ่าย</a>
        </div>
      </header>

      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 24px; max-width: 1200px; box-sizing: border-box')}>
        <h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>งานที่ต้องทำ</h1>

        <section style={css('border: 1px solid #e0e0e0; display: flex; flex-direction: column')}>
          <div style={css('display: grid; grid-template-columns: repeat(4, minmax(0, 1fr))')}>
            {/* TODO(M5): รวมบิลซื้อ (AP) รออนุมัติ */}
            <a href="/sales/invoices?tab=pending" style={css(CARD)}><span style={css(SMALL)}>รออนุมัติ</span><span style={css(BIG)}>{data.pending.count} <span style={css(UNIT)}>เอกสาร</span></span><span style={css(SMALL)}>IV {data.pending.iv} · AP —</span></a>
            <a href="/reports/aging" style={css(CARD)}><span style={css(SMALL)}>ครบกำหนดรับใน 7 วัน</span><span style={css(BIG)}>{money(data.arDue.total)}</span><span style={css(SMALL)}>{data.arDue.count} ใบ · เกินกำหนดแล้ว <span style={css('color: #a2191f')}>{data.arDue.overdue} ใบ</span></span></a>
            {/* TODO(M5): ครบกำหนดจ่าย (บิลซื้อ) */}
            <a href="/finance/payments" style={css(CARD)}><span style={css(SMALL)}>ครบกำหนดจ่ายใน 7 วัน</span><span style={css(BIG)}>—</span><span style={css(SMALL)}>— บิล</span></a>
            {/* TODO(M6): Statement ธนาคารที่ยังไม่จับคู่ */}
            <a href="/finance/bank-recon" style={css(CARD_LAST)}><span style={css(SMALL)}>Statement ยังไม่จับคู่</span><span style={css(BIG)}>— <span style={css(UNIT)}>รายการ</span></span><span style={css(SMALL)}>—</span></a>
          </div>
        </section>

        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section style={css('flex: 2 1 560px; min-width: 0; border: 1px solid #e0e0e0')}>
            <div style={css('display: flex; justify-content: space-between; align-items: center; height: 48px; padding: 0 16px; border-bottom: 1px solid #e0e0e0')}><h2 style={css('margin: 0; font-size: 18px; font-weight: 600')}>รออนุมัติ</h2><a href="/sales/invoices?tab=pending" style={css('font-size: 14px; text-decoration: none')}>ดูทั้งหมด</a></div>
            <div style={css('overflow-x: auto')}>
              <table style={css('width: 100%; min-width: 640px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
                <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}><th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>เลขที่</th><th style={css('padding: 0 12px; font-weight: 400')}>คู่ค้า</th><th style={css('padding: 0 12px; font-weight: 400')}>ส่งเมื่อ</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ยอดรวม</th><th style={css('padding: 0 12px; font-weight: 400')}>ผู้ส่ง</th><th style={css('padding: 0 12px')}></th></tr></thead>
                <tbody>
                  {/* TODO(Wei): แถวคำขอเข้าดู (consent) ไม่มีใน Main.dc.html — ConsoleSupport.dc.html บอกให้ "แจ้งในคิวหน้าแรก" ของ Owner → ใช้สไตล์แถวคิวเดิม + ป้ายแบบ TMS · ข้อความในแถวยังไม่มีในแบบร่าง */}
                  {data.support.map((r) => (
                    <tr key={r.id} data-testid="consent-request" style={css('border-top: 1px solid #e0e0e0')}>
                      <td style={css('height: 40px; padding: 0 12px; white-space: nowrap')}><span style={css('font-weight: 500')}>คำขอเข้าดู #{r.number}</span> <span style={css('font-size: 11px; padding: 1px 6px; background: #393939; color: #ffffff; border-radius: 4px')}>Innovera</span></td>
                      <td style={css('padding: 0 12px')}>{r.reason} · {r.scope} · {r.minutes} นาที · {r.write_access ? 'ขอสิทธิ์แก้ไขข้อมูล' : 'อ่านอย่างเดียว'}</td>
                      <td style={css('padding: 0 12px')}>{r.when}</td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}></td>
                      <td style={css('padding: 0 12px; color: #525252')}>{r.staff_name}</td>
                      <td style={css('padding: 0 12px; text-align: right; white-space: nowrap')}>
                        {r.status === 'pending' ? (
                          <span style={css('display: inline-flex; gap: 8px')}><Button kind="secondary" size={32} onClick={() => void decide(r.id, false)}>ปฏิเสธ</Button><Button kind="primary" size={32} onClick={() => void decide(r.id, true)}>อนุมัติ</Button></span>
                        ) : r.status === 'active' ? (
                          <span style={css('font-size: 13px; color: #a2191f')}>กำลังดูในฐานะ Innovera Support{r.until ? ` · ถึง ${r.until}` : ''}</span>
                        ) : (
                          <span style={css('font-size: 13px; color: #0e6027')}>อนุมัติแล้ว</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.queue.map((q) => (
                    <tr key={q.id} style={css('border-top: 1px solid #e0e0e0')}>
                      <td style={css('height: 40px; padding: 0 12px')}><a href={q.href} style={css('font-weight: 500; text-decoration: none')}>{q.no}</a></td>
                      <td style={css('padding: 0 12px')}>{q.contact}</td>
                      <td style={css('padding: 0 12px')}>{q.sent}</td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(q.total)}</td>
                      <td style={css('padding: 0 12px; color: #525252')}>{q.sender}</td>
                      <td style={css('padding: 0 12px; text-align: right')}><Button kind="primary" size={32} disabled={!q.approvable} onClick={() => void approve(q.id)}>อนุมัติ</Button></td>
                    </tr>
                  ))}
                  {!data.queue.length && !data.support.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={6} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
                </tbody>
              </table>
            </div>
            {msg && <div role="status" style={css(`padding: 12px 16px; border-top: 1px solid #e0e0e0; font-size: 14px; color: ${msg.ok ? '#0e6027' : '#a2191f'}`)}>{msg.text}</div>}
          </section>

          <aside style={css('flex: 1 1 320px; display: flex; flex-direction: column; gap: 24px')}>
            <section style={css('border: 1px solid #e0e0e0')}>
              {/* TODO(M6): ขั้นปิดงวดที่เหลือ (ScreenPeriodClose) — ตอนนี้ตรวจได้เฉพาะขั้นที่ 1 */}
              <div style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid #e0e0e0')}><h2 style={css('margin: 0; font-size: 18px; font-weight: 600')}>{data.close.title}</h2><span style={css('font-size: 13px; padding: 2px 8px; border-radius: 4px; background: #fcf4d6; color: #684e00')}>เหลือ — ขั้น</span></div>
              <ol style={css('margin: 0; padding: 8px 16px 8px 36px; font-size: 14px; line-height: 32px; color: #161616')}>
                <li><a href="/sales/invoices?tab=pending" style={css('text-decoration: none')}>เอกสารร่าง/รออนุมัติในงวด</a> <span style={css('font-size: 13px; color: #684e00')}>เหลือ {data.close.draftsLeft} ใบ</span></li>
                <li><a href="/finance/bank-recon" style={css('text-decoration: none')}>กระทบยอดธนาคาร {data.close.bankLabel}</a> <span style={css('font-size: 13px; color: #525252')}>—</span></li>
                <li><a href="/tax/recon" style={css('text-decoration: none')}>ตรวจภาษีซื้อ/ขายกับ GL</a> <span style={css('font-size: 13px; color: #525252')}>—</span></li>
                <li><a href="/gl/assets" style={css('text-decoration: none')}>ค่าเสื่อม {data.close.month}</a> <span style={css('font-size: 13px; color: #525252')}>—</span></li>
                <li><a href="/tax" style={css('text-decoration: none')}>ยื่น ภ.พ.30 / ภ.ง.ด.3, 53 เดือน {data.close.month}</a> <span style={css('font-size: 13px; color: #525252')}>—</span></li>
              </ol>
            </section>
            <section style={css('border: 1px solid #e0e0e0')}>
              <div style={css('height: 48px; display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid #e0e0e0')}><h2 style={css('margin: 0; font-size: 18px; font-weight: 600')}>สรุปเงิน ณ วันนี้</h2></div>
              <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}>
                <tbody>
                  <tr><td style={css('height: 32px; padding: 0 16px')}>{data.cash.bankLabel}</td><td style={css('padding: 0 16px; text-align: right; font-variant-numeric: tabular-nums')}>{money(data.cash.bank, { paren: true })}</td></tr>
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px')}>ลูกหนี้คงค้าง</td><td style={css('padding: 0 16px; text-align: right; font-variant-numeric: tabular-nums')}>{money(data.cash.ar, { paren: true })}</td></tr>
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px')}>เจ้าหนี้คงค้าง</td><td style={css('padding: 0 16px; text-align: right; font-variant-numeric: tabular-nums')}>{money(data.cash.ap, { paren: true })}</td></tr>
                  {/* TODO(M6): ภาษีต้องชำระ (ภ.พ.30 + ภ.ง.ด.) จากโมดูลภาษี */}
                  <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px')}>ภาษีต้องชำระ (ภ.พ.30 + ภ.ง.ด.)</td><td style={css('padding: 0 16px; text-align: right; font-variant-numeric: tabular-nums')}>—</td></tr>
                  <tr style={css('border-top: 1px solid #8d8d8d')}><td style={css('height: 40px; padding: 0 16px; font-weight: 600')}>{data.cash.profitLabel}</td><td style={css('padding: 0 16px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(data.cash.profit, { paren: true })}</td></tr>
                </tbody>
              </table>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
