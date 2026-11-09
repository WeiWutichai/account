// แบบพิมพ์รายเดือน (A4) — D12 PrintVatSales · D13 PrintVatPurchase · D14 PrintPnd3Attach · D15 PrintPnd53Attach (design/project/*.dc.html)
// ใช้โครง A4 ร่วมของ M4 (print/_lib/parts.tsx) · ตัวเลขจาก GET /v1/tax/vat และ /v1/tax/pnd เท่านั้น
import 'server-only';
import { css, money, thaiDate } from '@innovera/ui';
import { context, getDoc, originalTaxInvoice } from '../../print/_lib/data';
import { DATE_BLANK, Footer, Sheet, Signatures } from '../../print/_lib/parts';
import { branchShort, incomeLabel, monthFull, monthShort, pndReport, rdPrepName, ratePct, vatReport, whtTypes, type VatRow } from './data';

// .nb (ตารางไม่มีเส้น) อยู่ใน <helmet> ของแบบร่าง D12–D15 แต่ไม่มีใน SHEET ของ parts.tsx
const NB = '.pg .nb td,.pg .nb th{border:0;padding:2px 6px}';
const mp = (v: string): string => money(v, { paren: true });
/** แถวว่างท้ายตาราง: แบบร่างกำหนดความสูงไว้สำหรับจำนวนแถวตัวอย่าง — แถวจริงมากขึ้น แถวว่างก็เตี้ยลง (หน้า A4 คงที่) */
const fill = (designH: number, designRows: number, rows: number, rowH: number): string => `${Math.max(8, designH - (rows - designRows) * rowH)}px`;

// ---------- รายงานภาษีขาย / ภาษีซื้อ ----------

/** ชื่อคู่ค้า + "(ลดหนี้ อ้างอิง …)" ของใบลดหนี้ — ฝั่งขายอ้างใบกำกับเดิม (RV ของบริการ ม.78/1) · ฝั่งซื้ออ้างเลขใบกำกับของผู้ขาย */
async function partnerText(r: VatRow, all: VatRow[]): Promise<string> {
  // PrintVatPurchase.dc.html: ใบกำกับเดือนก่อนที่ขอใช้สิทธิ์เดือนนี้ (ม.82/3) — "… — ใช้สิทธิ์ข้ามเดือน (ภายใน 6 เดือน)"
  if (r.priorMonth) return `${r.partner} — ใช้สิทธิ์ข้ามเดือน (ภายใน 6 เดือน)`;
  if (r.docType !== 'CN' && r.docType !== 'CNR') return r.partner;
  // TODO(backend): เลขที่ใบกำกับเดิมของใบลดหนี้ควรมากับ GET /v1/tax/vat — ตอนนี้อ่านจากเอกสารทีละใบ
  const d = await getDoc(r.docId);
  if (!d?.ref) return r.partner;
  const ref = r.docType === 'CN' ? (await originalTaxInvoice(d))?.no : (all.find((x) => x.docId === d.ref?.id)?.vendorRef ?? (await getDoc(d.ref.id))?.doc.reference ?? d.ref.doc_no);
  return ref ? `${r.partner} (ลดหนี้ อ้างอิง ${ref})` : r.partner;
}

export async function VatPrint({ ym, side }: { ym: string; side: 'sales' | 'purchases' }) {
  const [ctx, rep] = await Promise.all([context(), vatReport(ym)]);
  const part = rep[side];
  const names = await Promise.all(part.rows.map((r) => partnerText(r, part.rows)));
  const sales = side === 'sales';
  const title = sales ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ';
  const hq = !ctx.profile?.branchCode || ctx.profile.branchCode === '00000';
  return (
    <Sheet>
      <style>{NB}</style>
      <div style={css('text-align: center')}>
        <div style={css('font-size: 20px; font-weight: 700')}>{title}</div>
        <div>เดือนภาษี {monthFull(ym)}</div>
      </div>
      <table className="nb" style={css('width: 100%; font-size: 13px')}><tbody>
        <tr><td style={css('width: 50%')}><strong>ชื่อผู้ประกอบการ</strong> {ctx.name}</td><td><strong>เลขประจำตัวผู้เสียภาษีอากร</strong> {ctx.profile?.taxId ?? ''}</td></tr>
        <tr><td><strong>ชื่อสถานประกอบการ</strong> {ctx.name}</td><td><span className="box">{hq ? '✓' : ''}</span>สำนักงานใหญ่ <span className="box">{hq ? '' : '✓'}</span>สาขาที่ {hq ? '______' : ctx.profile?.branchCode}</td></tr>
        {/* TODO(Wei) PrintVatSales.dc.html / PrintVatPurchase.dc.html: "รายงานรวมทุกสถานประกอบการ (ยื่นรวม)" — v1 ไม่มีการแยกสาขา จึงคงข้อความตามแบบร่าง */}
        <tr><td colSpan={2}><strong>ที่อยู่</strong> {ctx.profile?.address ?? '[ที่อยู่ตามทะเบียน ภพ.20]'} · รายงานรวมทุกสถานประกอบการ (ยื่นรวม)</td></tr>
      </tbody></table>
      <table style={css('width: 100%; font-size: 12px')}>
        <thead>
          {sales
            ? <tr style={css('background: #f4f4f4')}><th className="c" style={css('width: 30px')}>ลำดับ</th><th style={css('width: 80px')}>วัน เดือน ปี</th><th style={css('width: 100px')}>เลขที่ใบกำกับภาษี</th><th style={css('text-align: left')}>ชื่อผู้ซื้อสินค้า/ผู้รับบริการ</th><th style={css('width: 110px')}>เลขประจำตัวผู้เสียภาษีอากร</th><th style={css('width: 60px')}>สถานประกอบการ</th><th className="n" style={css('width: 100px')}>มูลค่าสินค้าหรือบริการ</th><th className="n" style={css('width: 90px')}>จำนวนเงินภาษีมูลค่าเพิ่ม</th></tr>
            : <tr style={css('background: #f4f4f4')}><th className="c" style={css('width: 30px')}>ลำดับ</th><th style={css('width: 76px')}>วัน เดือน ปี</th><th style={css('width: 86px')}>เลขที่ใบกำกับภาษี</th><th style={css('text-align: left')}>ชื่อผู้ขายสินค้า/ผู้ให้บริการ</th><th style={css('width: 104px')}>เลขประจำตัวผู้เสียภาษีอากร</th><th style={css('width: 52px')}>สถานประกอบการ</th><th style={css('width: 86px')}>เลขที่อ้างอิงภายใน</th><th className="n" style={css('width: 92px')}>มูลค่าสินค้าหรือบริการ</th><th className="n" style={css('width: 82px')}>จำนวนเงินภาษีมูลค่าเพิ่ม</th></tr>}
        </thead>
        <tbody>
          {part.rows.map((r, i) => (
            <tr key={r.docId}>
              <td className="c">{i + 1}</td><td className="c">{thaiDate(r.date)}</td><td>{sales ? r.docNo : (r.vendorRef ?? '')}</td><td>{names[i]}</td>
              <td className="c">{r.taxId ?? ''}</td><td className="c">{branchShort(r.branch)}</td>{sales ? null : <td>{r.docNo}</td>}
              <td className="n">{mp(r.base)}</td><td className="n">{mp(r.vat)}</td>
            </tr>
          ))}
          <tr>{Array.from({ length: sales ? 8 : 9 }, (_, i) => <td key={i} style={i === 0 ? { height: fill(300, sales ? 7 : 6, part.rows.length, 25) } : undefined}></td>)}</tr>
          <tr style={css('font-weight: 700')}><td colSpan={sales ? 6 : 7} style={css('text-align: right')}>รวม</td><td className="n">{mp(part.base)}</td><td className="n">{mp(part.vat)}</td></tr>
        </tbody>
      </table>
      {sales
        ? <div className="lbl">บันทึกตามจุดความรับผิดในการเสียภาษี (บริการ: เมื่อได้รับชำระ ม.78/1) · ใบลดหนี้แสดงเป็นยอดลบ · ยอดรวมต้องเท่ากับ ภ.พ.30 ข้อ 1 และ 5</div>
        : <div className="lbl">เฉพาะใบกำกับภาษีเต็มรูปที่ถูกต้องตาม ม.86/4 · ใบกำกับเดือนก่อนที่นำมาใช้สิทธิ์ระบุวันที่ตามใบกำกับ (ไม่เกิน 6 เดือน) · ภาษีซื้อต้องห้ามไม่แสดงในรายงานนี้ (บันทึกเป็นค่าใช้จ่าย) · ยอดรวมต้องเท่ากับ ภ.พ.30 ข้อ 6 และ 7</div>}
      <Signatures cols={2} items={[['ผู้จัดทำ', DATE_BLANK], ['ผู้มีอำนาจลงนาม / กรรมการ', DATE_BLANK]]} />
      <Footer parts={[`${title} ${monthShort(ym)}`, 'จัดทำตามประกาศอธิบดีกรมสรรพากรเกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 89)']} />
    </Sheet>
  );
}

// ---------- ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 ----------

export async function PndPrint({ ym, form }: { ym: string; form: '3' | '53' }) {
  const [ctx, rep, types] = await Promise.all([context(), pndReport(ym, form), whtTypes()]);
  const p3 = form === '3';
  const pending = rep.pendingAuditor;
  const seq = rep.filings.at(-1)?.seq ?? 0;
  return (
    <>
      <Sheet>
        <style>{NB}</style>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; gap: 16px')}>
          <div><div style={css('font-size: 20px; font-weight: 700')}>ใบแนบ ภ.ง.ด.{form}</div><div>รายละเอียดภาษีเงินได้หัก ณ ที่จ่าย ตามมาตรา {p3 ? '50 ทวิ และ 3 เตรส' : '3 เตรส และ 69 ทวิ'} · เดือน {monthFull(ym)}</div></div>
          {/* TODO(M4 parts.tsx): รายการเกินหน้ายังไม่ตัดขึ้นแผ่นใหม่ → แผ่นที่ 1 ในจำนวน 1 แผ่น */}
          <div style={css('border: 1px solid #393939; padding: 6px 10px; font-size: 12px; text-align: right')}>แผ่นที่ 1 ในจำนวน 1 แผ่น<br />{p3 ? 'สำหรับบุคคลธรรมดา' : 'สำหรับบริษัทหรือห้างหุ้นส่วนนิติบุคคล'}</div>
        </div>
        <table className="nb" style={css('width: 100%; font-size: 13px')}><tbody>
          <tr><td style={css('width: 55%')}><strong>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</strong> {ctx.name} ({ctx.branch})</td><td><strong>เลขประจำตัวผู้เสียภาษีอากร</strong> {ctx.profile?.taxId ?? ''}</td></tr>
          {/* ยื่นปกติ/ยื่นเพิ่มเติม ครั้งที่ = การยื่นครั้งล่าสุดที่บันทึกไว้ (acct.tax_filing) · TODO(Wei) T11: ไฟล์ RD Prep รูปแบบยังไม่ผ่าน validator */}
          <tr><td colSpan={2}><span className="box">{seq ? '' : '✓'}</span>ยื่นปกติ <span className="box">{seq ? '✓' : ''}</span>ยื่นเพิ่มเติม ครั้งที่ {seq ? seq : '___'} · <span className="box">✓</span>ยื่นผ่านอินเทอร์เน็ต (ไฟล์ RD Prep {rdPrepName(ym, form)})</td></tr>
        </tbody></table>
        <table style={css('width: 100%; font-size: 12px')}>
          <thead><tr style={css('background: #f4f4f4')}><th className="c" style={css('width: 28px')}>ลำดับ</th><th style={css('text-align: left')}>{p3 ? 'ชื่อและที่อยู่ผู้มีเงินได้' : 'ชื่อและที่อยู่ผู้มีเงินได้ (นิติบุคคล)'}</th><th style={css('width: 104px')}>{p3 ? 'เลขประจำตัวประชาชน / เลขประจำตัวผู้เสียภาษีอากร' : 'เลขประจำตัวผู้เสียภาษีอากร'}</th><th style={css('width: 72px')}>วัน เดือน ปี ที่จ่าย</th><th style={css('width: 110px; text-align: left')}>ประเภทเงินได้พึงประเมินที่จ่าย</th><th style={css('width: 40px')}>อัตราภาษี ร้อยละ</th><th className="n" style={css('width: 88px')}>จำนวนเงินที่จ่าย</th><th className="n" style={css('width: 76px')}>ภาษีที่หักและนำส่ง</th><th style={css('width: 36px')}>เงื่อนไข</th></tr></thead>
          <tbody>
            {rep.rows.map((r, i) => (
              <tr key={r.cert_no}>
                <td className="c">{i + 1}</td><td>{r.name}<br /><span className="lbl">{r.address ?? '[ที่อยู่]'}</span></td>
                <td className="c" style={css('font-variant-numeric: tabular-nums')}>{r.tax_id ?? ''}</td><td className="c">{thaiDate(r.pay_date)}</td>
                <td>{incomeLabel(r, types)}</td><td className="c">{ratePct(r.rate)}</td><td className="n">{money(r.base)}</td><td className="n">{money(r.amount)}</td>
                {/* ระบบหัก ณ ที่จ่ายจากยอดที่จ่ายจริงเสมอ → เงื่อนไข 1 */}
                <td className="c">1</td>
              </tr>
            ))}
            <tr>{Array.from({ length: 9 }, (_, i) => <td key={i} style={i === 0 ? { height: p3 ? fill(250, 6, rep.rows.length, 42) : fill(160, 8, rep.rows.length, 42) } : undefined}></td>)}</tr>
            <tr style={css('font-weight: 700')}><td colSpan={6} style={css('text-align: right')}>รวมยอดเงินได้และภาษีที่นำส่ง (นำไปกรอกใน ภ.ง.ด.{form})</td><td className="n">{money(rep.base)}</td><td className="n">{money(rep.tax)}</td><td></td></tr>
          </tbody>
        </table>
        {p3
          ? <div className="lbl">เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว · * ประเภทเงินได้ของค่าจ้างฟรีแลนซ์พัฒนาซอฟต์แวร์ (ม.40(2) หรือ ม.40(8)) อยู่ระหว่างรอผู้สอบบัญชียืนยัน — ตัวอย่างนี้ใช้ค่าตั้งต้นของระบบ ยังไม่ถือเป็นข้อสรุป</div>
          : <div className="lbl">เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว · ภาษีหัก ณ ที่จ่ายรับรู้เมื่อจ่ายเงินจริง — รายการที่ตั้งหนี้แล้วแต่ยังไม่จ่ายไม่ปรากฏในใบแนบเดือนนี้</div>}
        {/* กำหนดยื่นออนไลน์ = config tax.filing.online_extension (รอผู้สอบบัญชี) — ข้อความตามแบบร่างระบุว่ารอยืนยันแล้ว */}
        <div className="lbl">กำหนดยื่น: ภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ขยายเป็นวันที่ 15 — เงื่อนไขมาตรการขยายเวลารอผู้สอบบัญชียืนยัน)</div>
        <Signatures cols={2} items={[['ผู้จัดทำ', DATE_BLANK], ['ผู้มีหน้าที่หักภาษี ณ ที่จ่าย / ผู้มีอำนาจลงนาม', DATE_BLANK]]} />
        <Footer parts={[`ใบแนบ ภ.ง.ด.${form} ${monthShort(ym)}`, 'สอดคล้องกับหนังสือรับรอง 50 ทวิ ที่ออกในเดือน']} />
      </Sheet>
      {/* ป้าย "รอยืนยัน" (CLAUDE.md: ฟรีแลนซ์รอผู้สอบบัญชี) — แสดงบนจอเท่านั้น ไม่พิมพ์ (แบบเดียวกับ print/wht50) */}
      {pending && (
        <>
          <style>{'@media print{.screen-only{display:none!important}}'}</style>
          <div className="screen-only" role="status" style={css("width: 794px; box-sizing: border-box; margin-top: 8px; padding: 8px 12px; border: 1px solid #e0e0e0; border-left: 3px solid #f1c21b; font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 13px; color: #161616")}>
            รอยืนยัน · มีรายการที่ประเภทเงินได้/วิธีคำนวณรอผู้สอบบัญชียืนยัน (*)
          </div>
        </>
      )}
    </>
  );
}
