// S6 หน้าเอกสารสำหรับลูกค้า — design/project/ScreenSendDoc.dc.html · สาธารณะ ไม่ต้องเข้าสู่ระบบ (proxy.ts ข้าม /d/)
// อ่านอย่างเดียวจาก GET /v1/shared/:token (token สุ่ม เก็บ hash · หมดอายุได้)
import { Button, css, money, thaiDate } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { ACCOUNTING_API } from '../../lib/session';
import { daysBetween, type DocDetail, docNo, thaiLongDate } from '../../sales/_lib/doc';
import { fromCents, qtyText, qtyTimesPrice, toCents } from '../../sales/_lib/num';
import { PrintButton } from './print-button';

type Shared = DocDetail & { company: { name: string; taxId: string | null; branch: string | null } };

const today = (): string => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
const TITLE: Record<string, string> = { QO: 'ใบเสนอราคา', SO: 'ใบสั่งขาย', CN: 'ใบลดหนี้', DN: 'ใบเพิ่มหนี้', DP: 'ใบแจ้งหนี้มัดจำ', BN: 'ใบวางบิล', RV: 'ใบเสร็จรับเงิน' };
const branch = (b: string | null | undefined) => (!b || b === '00000' ? 'สำนักงานใหญ่' : `สาขา ${b}`);

export const metadata = { title: 'เอกสารจากผู้ขาย' };

export default async function SharedDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${ACCOUNTING_API}/v1/shared/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (!res.ok) notFound();
  const s = (await res.json()) as Shared;
  const d = s.doc;
  const now = today();
  const title = d.doc_type === 'IV' ? (d.tax_mode === 'immediate' ? 'ใบแจ้งหนี้ / ใบกำกับภาษี' : 'ใบแจ้งหนี้') : TITLE[d.doc_type] ?? d.doc_type;
  const due = s.outstanding ?? d.grand_total;
  const items = s.lines.filter((l) => l.line_type === 'item');
  const gross = (l: (typeof items)[number]) => fromCents(toCents(qtyTimesPrice(l.qty ?? '0', l.unit_price ?? '0')) - toCents(l.discount));
  const sumGross = fromCents(items.reduce((a, l) => a + toCents(gross(l)), 0n));
  const left = d.due_date ? daysBetween(now, d.due_date) : null;
  const receipts = s.settlementsIn.filter((x) => x.doc_type === 'RV' && !x.voided);

  return (
    <div style={css("min-height: 1000px; background: #f4f4f4; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; display: flex; flex-direction: column")}>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet" />
      {/* TODO(backend): วันหมดอายุของลิงก์ — GET /v1/shared/:token ยังไม่ส่ง expires_at · TODO(Wei): หน้าภาษาอังกฤษ (EN) */}
      <header style={css('height: 48px; background: #ffffff; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; font-size: 14px')}><div style={css('display: flex; align-items: center; gap: 12px')}><span style={css('width: 24px; height: 24px; background: #e0e0e0; display: inline-block')}></span><span style={css('font-weight: 600')}>{s.company.name}</span><span style={css('color: #525252')}>ส่งเอกสารถึงคุณ</span></div><span style={css('color: #525252')}>ลิงก์นี้ปลอดภัย · หมดอายุ — · ภาษา: <a href={`/d/${token}`} style={css('text-decoration: none')}>EN</a></span></header>
      <main style={css('flex: 1; display: flex; justify-content: center; padding: 32px; box-sizing: border-box')}>
        <div style={css('width: 100%; max-width: 1100px; display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 4fr); gap: 24px; align-items: start')}>
          <section style={css("background: #ffffff; border: 1px solid #e0e0e0; padding: 40px 48px; font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif; font-size: 14px; line-height: 1.5; display: flex; flex-direction: column; gap: 20px")}>
            {/* TODO(backend): ที่อยู่/โทรศัพท์ของบริษัท — /v1/shared ส่งแค่ชื่อ เลขผู้เสียภาษี สาขา */}
            <div style={css('display: flex; justify-content: space-between; gap: 24px')}><div><div style={css('font-weight: 600; font-size: 16px')}>{s.company.name} ({branch(s.company.branch)})</div><div>—</div><div>เลขประจำตัวผู้เสียภาษี {s.company.taxId ?? '—'}</div></div>
              <div style={css('text-align: right')}><div style={css('font-weight: 600; font-size: 18px')}>{title}</div>
                {/* TODO(M7/Wei): e-Tax Invoice ยังไม่เปิดใช้ → ไม่แสดง "e-Tax Invoice" */}
                <div style={css('color: #525252')}>ต้นฉบับ</div>
                <table style={css('margin-left: auto; margin-top: 8px; border-collapse: collapse')}><tbody>
                  <tr><td style={css('padding: 0 8px 0 0; color: #525252')}>เลขที่</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{docNo(d)}</td></tr>
                  <tr><td style={css('padding: 0 8px 0 0; color: #525252')}>วันที่</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{thaiDate(d.issue_date)}</td></tr>
                  <tr><td style={css('padding: 0 8px 0 0; color: #525252')}>ครบกำหนด</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{d.due_date ? thaiDate(d.due_date) : '—'}</td></tr>
                  <tr><td style={css('padding: 0 8px 0 0; color: #525252')}>อ้างอิง</td><td style={css('text-align: right')}>{[s.ref ? docNo(s.ref) : null, d.reference].filter(Boolean).join(' / ') || '—'}</td></tr>
                </tbody></table></div></div>
            <div style={css('border-top: 1px solid #161616; padding-top: 12px')}><div style={css('color: #525252; font-size: 12px')}>ลูกค้า</div><div style={css('font-weight: 600')}>{s.contact?.name ?? '—'} ({branch(s.contact?.branch_code)})</div><div>{d.address ?? '—'} · เลขประจำตัวผู้เสียภาษี {s.contact?.tax_id ?? '—'}</div></div>
            <table style={css('width: 100%; border-collapse: collapse')}><thead><tr style={css('border-top: 1px solid #161616; border-bottom: 1px solid #161616')}><th style={css('text-align: left; padding: 6px 4px; font-weight: 600; width: 32px')}>#</th><th style={css('text-align: left; padding: 6px 4px; font-weight: 600')}>รายการ</th><th style={css('text-align: right; padding: 6px 4px; font-weight: 600; width: 70px')}>จำนวน</th><th style={css('text-align: right; padding: 6px 4px; font-weight: 600; width: 110px')}>ราคา/หน่วย</th><th style={css('text-align: right; padding: 6px 4px; font-weight: 600; width: 120px')}>จำนวนเงิน</th></tr></thead><tbody>
              {items.map((l, i) => (
                <tr key={l.id}><td style={css('padding: 6px 4px; vertical-align: top; font-variant-numeric: tabular-nums')}>{i + 1}</td><td style={css('padding: 6px 4px')}>{l.description}{d.price_incl_vat && <><br /><span style={css('color: #525252; font-size: 12px')}>ราคารวมภาษีมูลค่าเพิ่ม</span></>}</td><td style={css('padding: 6px 4px; text-align: right; font-variant-numeric: tabular-nums')}>{qtyText(l.qty)}</td><td style={css('padding: 6px 4px; text-align: right; font-variant-numeric: tabular-nums')}>{money(l.unit_price)}</td><td style={css('padding: 6px 4px; text-align: right; font-variant-numeric: tabular-nums')}>{money(gross(l))}</td></tr>
              ))}
            </tbody></table>
            {/* TODO(backend): บัญชีธนาคารรับโอน/อีเมลรับ 50 ทวิ ของบริษัท (ตั้งค่าเอกสาร) — แสดงหมายเหตุบนเอกสารแทน */}
            <div style={css('display: flex; justify-content: space-between; gap: 24px; align-items: flex-end')}><div style={css('font-size: 12px; color: #525252; max-width: 320px')}>({s.amountText}){d.notes ? <><br />{d.notes}</> : null}</div><table style={css('border-collapse: collapse; min-width: 300px')}><tbody>
              <tr><td style={css('padding: 2px 8px 2px 0')}>{d.price_incl_vat ? 'รวมเป็นเงิน (รวม VAT)' : 'รวมเป็นเงิน'}</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(sumGross)}</td></tr>
              <tr><td style={css('padding: 2px 8px 2px 0')}>ส่วนลด</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(d.discount)}</td></tr>
              <tr><td style={css('padding: 2px 8px 2px 0')}>มูลค่าก่อนภาษี</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(fromCents(toCents(d.subtotal) - toCents(d.discount)))}</td></tr>
              <tr><td style={css('padding: 2px 8px 2px 0')}>ภาษีมูลค่าเพิ่ม 7%</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>{money(d.vat)}</td></tr>
              <tr style={css('border-top: 1px solid #161616; font-weight: 600; font-size: 16px')}><td style={css('padding: 6px 8px 2px 0')}>ยอดรวมทั้งสิ้น</td><td style={css('text-align: right; font-variant-numeric: tabular-nums; padding-top: 6px')}>{money(d.grand_total)}</td></tr>
            </tbody></table></div>
            {/* TODO(M7/Wei): ลายเซ็นดิจิทัล e-Tax ("ลงนามดิจิทัลโดย [ผู้ให้บริการ e-Tax]") ยังไม่มี → ไม่แสดง */}
            <div style={css('display: flex; justify-content: space-between; gap: 24px; padding-top: 24px; font-size: 12px; color: #525252')}><div>ผู้รับวางบิล ______________________<br />วันที่ ______</div><div>ผู้มีอำนาจลงนาม ______________________<br />{s.company.name}</div></div>
          </section>
          <aside style={css('display: flex; flex-direction: column; gap: 16px')}>
            <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 24px; display: flex; flex-direction: column; gap: 16px')}>
              <div><span style={css('font-size: 13px; color: #525252')}>ยอดที่ต้องชำระ</span><div style={css('font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 36px')}>{money(due)} <span style={css('font-size: 14px; font-weight: 400; color: #525252')}>บาท</span></div>
                {d.due_date && left !== null && <span style={css('display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; background: #fcf4d6; color: #684e00; font-size: 13px; font-weight: 500')}><span style={css('width: 8px; height: 8px; border-radius: 999px; background: currentColor')}></span>ครบกำหนด {thaiLongDate(d.due_date)} · {left >= 0 ? `อีก ${left} วัน` : `เกินกำหนด ${-left} วัน`}</span>}</div>
              {/* TODO(M7/Wei): PromptPay Bill Payment / ชำระด้วยบัตร / แจ้งโอน+แนบสลิป / ไฟล์ e-Tax ยังไม่มีระบบ → ปุ่มใช้ไม่ได้ (ไม่แสดง QR ปลอม) */}
              <div style={css('border: 1px solid #e0e0e0; padding: 16px; display: flex; gap: 16px; align-items: center')}><span style={css('width: 96px; height: 96px; background: #e0e0e0; flex: 0 0 auto')}></span><div style={css('font-size: 14px')}><div style={css('font-weight: 600')}>สแกนจ่ายผ่าน PromptPay (Bill Payment)</div><div style={css('color: #525252; font-size: 13px')}>ระบุยอดอัตโนมัติ · ระบบจับคู่การชำระและออกใบเสร็จให้ทันที</div></div></div>
              <Button kind="primary" disabled>ชำระด้วยบัตร / โอนผ่านธนาคาร</Button>
              <Button disabled>แจ้งโอนแล้ว + แนบสลิป / 50 ทวิ</Button>
              {/* TODO(backend): ดาวน์โหลด PDF ต้องมี endpoint สาธารณะตาม token (แบบพิมพ์อยู่หลังเข้าสู่ระบบ) */}
              <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}><Button size={36} disabled>ดาวน์โหลด PDF</Button><Button size={36} disabled>ไฟล์ e-Tax (XML)</Button><PrintButton /></div>
            </section>
            <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>เอกสารที่เกี่ยวข้อง</strong>
              {s.ref && <div style={css('display: flex; justify-content: space-between')}><span>{TITLE[s.ref.doc_type] ?? s.ref.doc_type} {docNo(s.ref)}</span><span style={css('color: #525252')}>{thaiDate(s.ref.issue_date)}</span></div>}
              {receipts.length
                ? receipts.map((r) => <div key={r.id} style={css('display: flex; justify-content: space-between')}><span>ใบเสร็จรับเงิน {r.doc_no}</span><span style={css('color: #525252')}>{thaiDate(r.issue_date)}</span></div>)
                : <div style={css('display: flex; justify-content: space-between')}><span style={css('color: #525252')}>ใบเสร็จรับเงิน</span><span style={css('color: #525252')}>ออกเมื่อชำระ</span></div>}
            </section>
            {/* TODO(backend): ส่งข้อความถึงผู้ออกเอกสาร (เข้าคิวงาน) ยังไม่มี API */}
            <section style={css('background: #ffffff; border: 1px solid #e0e0e0; padding: 16px 24px; font-size: 14px; display: flex; flex-direction: column; gap: 8px')}><strong>มีคำถามเกี่ยวกับเอกสารนี้?</strong><textarea rows={2} aria-label="ข้อความถึงฝ่ายบัญชี" placeholder="พิมพ์ข้อความถึงฝ่ายบัญชี เช่น ขอแก้ที่อยู่ออกบิล" style={css('padding: 8px 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px; resize: vertical')}></textarea><Button size={36} disabled extra="align-self: flex-start">ส่งข้อความ</Button><span style={css('font-size: 13px; color: #525252')}>ข้อความจะไปปรากฏในคิวงานของผู้ออกเอกสาร</span></section>
          </aside>
        </div>
      </main>
      <footer style={css('padding: 16px 32px; font-size: 13px; color: #525252; text-align: center')}>ออกโดยระบบบัญชี Innovera</footer>
    </div>
  );
}
