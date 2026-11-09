// ส่วนที่ใช้ร่วมกันของแบบพิมพ์ A4 (design/project/Print*.dc.html) — style คัดลอกจากแบบร่างตรงตัวผ่าน css() · ฟอนต์ Sarabun
import { css, money } from '@innovera/ui';
import { branchLabel, type Company, type ContactRow } from './data';
import { PrintCounter } from './PrintCounter';

// <helmet> ของแบบร่าง (เหมือนกันทุกไฟล์ Print* · .c มีใน PrintQuote/PrintReceiptNoVat/PrintReceiptVoucher) + ขนาดกระดาษ A4 ตอนพิมพ์/ทำ PDF
const SHEET = `body{margin:0;background:#ffffff}
.pg table{border-collapse:collapse}
.pg td,.pg th{border:1px solid #393939;padding:4px 8px;vertical-align:top}
.pg .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pg .lbl{color:#525252;font-size:12px}
.pg .box{display:inline-block;width:12px;height:12px;border:1px solid #161616;vertical-align:-2px;margin-right:4px;text-align:center;line-height:12px;font-size:11px}
.pg .c{text-align:center}
@page{size:A4;margin:0}
@media print{.pg{width:210mm!important;height:297mm!important}}`;

const PG = "width: 794px; height: 1123px; box-sizing: border-box; padding: 40px 48px; background: #ffffff; color: #161616; font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif; font-size: 13px; line-height: 1.45; display: flex; flex-direction: column; gap: 12px; overflow: hidden";

export function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" precedence="default" />
      <style>{SHEET}</style>
      {/* TODO(M4) Print*.dc.html: แบบร่างเป็นหน้าเดียว (หน้า 1/1 · ตารางสูงคงที่) — เอกสารที่รายการยาวเกินหน้ายังไม่ตัดขึ้นหน้าใหม่ */}
      <main className="pg" style={css(PG)}>{children}</main>
    </>
  );
}

/** หัวกระดาษ: ข้อมูลบริษัท + ชื่อแบบพิมพ์ + ป้าย ต้นฉบับ/สำเนา · doc = เอกสารที่นับการพิมพ์ต้นฉบับ */
export function Header({ ctx, title, en, badge, doc }: { ctx: Company; title: string; en: string; badge: string; doc?: { id: string; status: string } }) {
  return (
    <div style={css('display: flex; justify-content: space-between; gap: 24px; align-items: flex-start')}>
      {badge === 'ต้นฉบับ' && doc && doc.status !== 'draft' && <PrintCounter id={doc.id} />}
      <div style={css('display: flex; gap: 12px; align-items: flex-start')}>
        {/* TODO(backend): โลโก้บริษัทยังไม่มีใน API — แสดงกรอบตามแบบร่าง */}
        <div aria-hidden="true" style={css('width: 56px; height: 56px; border: 1px solid #8d8d8d; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #525252')}>โลโก้</div>
        <div><div style={css('font-size: 16px; font-weight: 700')}>{ctx.name} <span style={css('font-weight: 400')}>({ctx.branch})</span></div>
        {/* ค่าว่าง → ช่องกรอกตามแบบร่าง */}
        <div>{ctx.profile?.address ?? '[ที่อยู่ตามทะเบียน ภพ.20]'}</div>
        <div>เลขประจำตัวผู้เสียภาษีอากร {ctx.profile?.taxId ?? ''} · โทร {ctx.profile?.phone ?? '[เบอร์โทร]'}</div></div>
      </div>
      <div style={css('text-align: right; flex: 0 0 auto')}>
        <div style={css('font-size: 22px; font-weight: 700; line-height: 1.2')}>{title}</div>
        <div style={css('font-size: 13px')}>{en}</div>
        <div style={css('display: inline-block; margin-top: 6px; padding: 2px 10px; border: 1px solid #161616; font-weight: 600')}>{badge}</div>
      </div>
    </div>
  );
}
/** ป้ายต้นฉบับ/สำเนา — ?copy=1 หรือพิมพ์ต้นฉบับไปแล้ว (document.print_count ≥ 1) = สำเนา (PrintReceiptTax: "สำเนาที่พิมพ์ซ้ำจะแสดงคำว่า “สำเนา”") */
export const badgeOf = (sp: Record<string, string | string[] | undefined>, doc?: { print_count?: number }): string =>
  (sp.copy === '1' || (doc?.print_count ?? 0) > 0 ? 'สำเนา' : 'ต้นฉบับ');

/** ชื่อคู่ค้า + (สาขา) */
export function PartyName({ c, suffix }: { c: ContactRow | null; suffix?: string }) {
  const b = branchLabel(c?.branch_code);
  return <div style={css('font-weight: 600')}>{c?.name ?? ''}{b ? <> <span style={css('font-weight: 400')}>({b})</span></> : null}{suffix ?? ''}</div>;
}

/** กล่องคู่ค้า (ซ้าย) — ที่อยู่จาก customerAddress() */
export function PartyBox({ label, c, address, taxLine, nameSuffix }: { label: string; c: ContactRow | null; address: string; taxLine?: string; nameSuffix?: string }) {
  return (
    <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px')}>
      <div className="lbl">{label}</div>
      <PartyName c={c} {...(nameSuffix ? { suffix: nameSuffix } : {})} />
      <div>{address || NBSP}</div>
      <div>{taxLine ?? `เลขประจำตัวผู้เสียภาษีอากร ${c?.tax_id ?? ''}`}</div>
    </div>
  );
}

/** กล่องเลขที่/วันที่ (ขวา) */
export function InfoBox({ rows }: { rows: [string, string][] }) {
  return (
    <div style={css('flex: 0 0 250px; border: 1px solid #393939; padding: 8px 12px; display: grid; grid-template-columns: 96px 1fr; row-gap: 2px')}>
      {rows.map(([k, v]) => [<span key={`k${k}`} className="lbl">{k}</span>, <span key={`v${k}`} style={css('font-weight: 600')}>{v || NBSP}</span>])}
    </div>
  );
}

export function Signatures({ cols, items }: { cols: number; items: [string, string][] }) {
  return (
    <div style={css(`display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); gap: 16px; margin-top: auto; text-align: center`)}>
      {items.map(([who, date]) => <div key={who}><div style={css('height: 48px; border-bottom: 1px dotted #161616')}></div><div>{who}</div><div className="lbl">{date}</div></div>)}
    </div>
  );
}
/** ช่องว่างที่ต้องคงความสูงบรรทัดตามแบบร่าง */
export const NBSP = '\u00a0';
export const DATE_BLANK = 'วันที่ ____/____/______';

/** บรรทัดท้าย "พิมพ์จาก AccountSystem · <เลขที่> · …" — ส่วนที่ว่าง (เช่น ร่างที่ยังไม่มีเลขที่) ไม่แสดง */
export function Footer({ parts }: { parts: (string | null | undefined)[] }) {
  const left = ['พิมพ์จาก AccountSystem', ...parts].filter(Boolean).join(' · ');
  return <div className="lbl" style={css('display: flex; justify-content: space-between; border-top: 1px solid #c6c6c6; padding-top: 6px')}><span>{left}</span><span>หน้า 1/1</span></div>;
}

/** ตารางสรุปยอดด้านขวา */
export function Totals({ width, rows }: { width: number; rows: { label: string; value: string; bold?: boolean }[] }) {
  return (
    <table style={css(`flex: 0 0 ${width}px`)}>
      <tbody>
        {rows.map((r) => <tr key={r.label} style={r.bold ? css('font-weight: 700') : undefined}><td>{r.label}</td><td className="n">{r.value}</td></tr>)}
      </tbody>
    </table>
  );
}
export const m = (v: string | null | undefined): string => money(v);
export const mBlank = (v: string | null | undefined): string => money(v, { blankZero: true });

/** ความสูงแถวว่างท้ายตาราง: แบบร่างกำหนดความสูงไว้สำหรับจำนวนแถวตัวอย่าง — แถวจริงมากขึ้น แถวว่างก็เตี้ยลง (หน้า A4 คงที่) */
export const ROW_H = 28;
export const filler = (designH: number, designRows: number, rows: number): string => `${Math.max(8, designH - (rows - designRows) * ROW_H)}px`;

export interface ItemRow { key: string; no: number | null; desc: React.ReactNode; qty: string; unit: string; price: string; amount: string }
/** ตารางรายการ 6 คอลัมน์ (PrintInvoice / PrintReceiptTax / PrintQuote) */
export function ItemTable6({ rows, fill }: { rows: ItemRow[]; fill: string }) {
  return (
    <table style={css('width: 100%')}>
      <thead><tr style={css('background: #f4f4f4')}><th style={css('width: 36px')}>ลำดับ</th><th style={css('text-align: left')}>รายการ</th><th style={css('width: 70px')} className="n">จำนวน</th><th style={css('width: 60px')}>หน่วย</th><th style={css('width: 90px')} className="n">ราคา/หน่วย</th><th style={css('width: 100px')} className="n">จำนวนเงิน</th></tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.key}><td style={css('text-align: center')}>{r.no ?? ''}</td><td>{r.desc}</td><td className="n">{r.qty}</td><td>{r.unit}</td><td className="n">{r.price}</td><td className="n">{r.amount}</td></tr>)}
        <tr><td style={{ height: fill }}></td><td></td><td></td><td></td><td></td><td></td></tr>
      </tbody>
    </table>
  );
}
