// D4 หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) — design/project/PrintWht50.dc.html · PDF: ./pdf
// id = id ของ 50 ทวิ (หรือเลขที่ WHT…) · ข้อมูลจาก GET /v1/wht-certificates + เอกสารการจ่าย (PV / EXP จ่ายทันที / PC)
// กติกา (CLAUDE.md): หัก ณ ที่จ่ายรับรู้ตอนจ่ายจริง · 50 ทวิ ออกต่อการจ่าย · ภ.ง.ด.3/53 เดือนที่จ่าย
import { css, thaiDate } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { bahtTextOf, context, getDoc } from '../../_lib/data';
import { Footer, m, NBSP, Sheet } from '../../_lib/parts';
import { certById, type WhtCert } from '../../_lib/wht';

export const metadata = { title: 'แบบพิมพ์ หนังสือรับรองการหักภาษี ณ ที่จ่าย' };

// แถวประเภทเงินได้ตามแบบ (ตัวอักษรตามแบบร่าง)
const INCOME_ROWS = [
  '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)',
  '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)',
  '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)',
  '4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)',
  '    (ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)',
  '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใดๆ เนื่องจากการส่งเสริมการขาย ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ',
  '6. อื่นๆ (ระบุ) ..............................',
];
const SECTION_ROW: Record<string, number> = { '40(1)': 0, '40(2)': 1, '40(3)': 2, '40(4)(ก)': 3, '40(4)(ข)': 4 };
// ประเภทเงินได้ตามคำสั่ง ท.ป.4/2528 (ม.3 เตรส) → แถว 5
const THREE_TER = ['transport_domestic', 'advertising', 'service', 'hire_of_work', 'professional', 'rent'];
/** แถวในแบบของ 50 ทวิ
 * TODO(Wei/ผู้สอบบัญชี) PrintWht50.dc.html: ฟรีแลนซ์พัฒนาซอฟต์แวร์ — 40(2) อยู่แถว 2 ตามแบบร่าง · ถ้าผู้สอบบัญชีตัดสินเป็น 40(8) ตอนนี้ลงแถว 6 "อื่นๆ (ระบุ)" (รอยืนยัน) */
function rowOf(c: WhtCert): number {
  if (c.income_section && c.income_section in SECTION_ROW) return SECTION_ROW[c.income_section]!;
  if (THREE_TER.includes(c.income_type)) return 5;
  return 6;
}
const PND = ['ภ.ง.ด.1ก', 'ภ.ง.ด.1ก พิเศษ', 'ภ.ง.ด.2', 'ภ.ง.ด.3', 'ภ.ง.ด.2ก', 'ภ.ง.ด.3ก', 'ภ.ง.ด.53'];
const Box = ({ on }: { on: boolean }) => <span className="box">{on ? '✓' : ''}</span>;

export default async function PrintWht50({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await certById(decodeURIComponent(id));
  if (!found) notFound();
  const { cert: c, seq } = found;
  const [ctx, pay, text] = await Promise.all([context(), getDoc(c.payment_id), bahtTextOf(c.amount)]);
  const row = rowOf(c);
  const be = Number(c.pay_date.slice(0, 4)) + 543;
  const d = thaiDate(c.pay_date);
  const other = row === 6 ? `6. อื่นๆ (ระบุ) ${c.income_section ? `${c.income_section} ` : ''}${c.income_type}` : null;
  const PAD = 'padding: 8px 12px';
  return (
    <>
      <Sheet>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start')}>
          <div className="lbl">ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)<br />ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)</div>
          <div style={css('text-align: right')}>เล่มที่ <strong>{`${be}/${c.pay_date.slice(5, 7)}`}</strong> &nbsp; เลขที่ <strong>{c.cert_no}</strong></div>
        </div>
        <div style={css('text-align: center')}><div style={css('font-size: 18px; font-weight: 700')}>หนังสือรับรองการหักภาษี ณ ที่จ่าย</div><div>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div></div>
        <div style={css(`border: 1px solid #393939; ${PAD}`)}>
          <div style={css('display: flex; justify-content: space-between')}><strong>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</strong><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <strong>{ctx.profile?.taxId ?? ''}</strong></span></div>
          <div>ชื่อ {ctx.name} ({ctx.branch})</div><div>ที่อยู่ {ctx.profile?.address ?? '[ที่อยู่ตามทะเบียน]'}</div>
        </div>
        <div style={css(`border: 1px solid #393939; ${PAD}`)}>
          <div style={css('display: flex; justify-content: space-between')}><strong>ผู้ถูกหักภาษี ณ ที่จ่าย :</strong><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <strong>{c.tax_id ?? ''}</strong></span></div>
          <div>ชื่อ {c.name}</div><div>ที่อยู่ {pay?.contact?.address ?? '[ที่อยู่ผู้รับเงิน]'}</div>
          <div style={css('margin-top: 6px')}>ลำดับที่ <strong style={css('display: inline-block; min-width: 32px; border-bottom: 1px solid #161616; text-align: center')}>{seq || NBSP}</strong> ในแบบ{PND.map((p) => <span key={p}> &nbsp; <Box on={p === `ภ.ง.ด.${c.pnd}`} />{p}</span>)}</div>
        </div>
        <table style={css('width: 100%')}>
          <thead><tr style={css('background: #f4f4f4')}><th style={css('text-align: left')}>ประเภทเงินได้พึงประเมินที่จ่าย</th><th>วัน เดือน<br />หรือปีภาษี ที่จ่าย</th><th className="n">จำนวนเงินที่จ่าย</th><th className="n">ภาษีที่หัก<br />และนำส่งไว้</th></tr></thead>
          <tbody>
            {INCOME_ROWS.map((label, i) => {
              const hit = i === row;
              return (
                <tr key={label}><td>{i === 6 && other ? other : label}</td><td style={css('text-align: center; width: 80px')}>{hit ? d : ''}</td><td className="n" style={css('width: 100px')}>{hit ? m(c.base) : ''}</td><td className="n" style={css('width: 100px')}>{hit ? m(c.amount) : ''}</td></tr>
              );
            })}
            <tr style={css('font-weight: 700')}><td colSpan={2} style={css('text-align: right')}>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td className="n">{m(c.base)}</td><td className="n">{m(c.amount)}</td></tr>
            <tr><td colSpan={4}>รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) <strong>({text})</strong></td></tr>
          </tbody>
        </table>
        {/* TODO(backend): เงินสมทบ กบข./ประกันสังคม/กองทุนสำรองเลี้ยงชีพ — v1 ไม่มีเงินเดือนในระบบ (CLAUDE.md) จึงเว้นว่างตามแบบร่าง */}
        <div style={css(`border: 1px solid #393939; ${PAD}`)}>เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ........ บาท &nbsp; กองทุนประกันสังคม ........ บาท &nbsp; กองทุนสำรองเลี้ยงชีพ ........ บาท</div>
        {/* ระบบหัก ณ ที่จ่ายจากยอดที่จ่ายจริงเสมอ → (1) หัก ณ ที่จ่าย */}
        <div style={css(`border: 1px solid #393939; ${PAD}`)}><strong>ผู้จ่ายเงิน</strong> &nbsp; <Box on />(1) หัก ณ ที่จ่าย &nbsp; <Box on={false} />(2) ออกให้ตลอดไป &nbsp; <Box on={false} />(3) ออกให้ครั้งเดียว &nbsp; <Box on={false} />(4) อื่นๆ (ระบุ) ..........</div>
        <div style={css('display: flex; gap: 12px; margin-top: auto')}>
          <div style={css(`flex: 0 0 300px; border: 1px solid #393939; ${PAD}; font-size: 12px`)}><strong>คำเตือน</strong> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>
          <div style={css(`flex: 1 1 auto; border: 1px solid #393939; ${PAD}; text-align: center`)}>ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ
            <div style={css('height: 40px')}></div>ลงชื่อ ........................................ ผู้จ่ายเงิน<br />{d.split('/').join(' / ')}<br /><span className="lbl">(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</span>
            <div style={css('display: flex; justify-content: flex-end')}><div aria-hidden="true" style={css('width: 64px; height: 64px; border: 1px dashed #8d8d8d; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #525252')}>ตรา<br />นิติบุคคล</div></div>
          </div>
        </div>
        <Footer parts={[c.payment_no ? `ออกจาก ${c.payment_no}` : null, 'ข้อความเป็นไปตามแบบที่กรมสรรพากรกำหนด']} />
      </Sheet>
      {/* ป้าย "รอยืนยัน" (CLAUDE.md: ฟรีแลนซ์รอผู้สอบบัญชี) / ยกเลิกแล้ว — แสดงบนจอเท่านั้น ไม่พิมพ์ลงแบบฟอร์มของกรมสรรพากร */}
      {(c.pending_auditor || c.voided) && (
        <>
          <style>{'@media print{.screen-only{display:none!important}}'}</style>
          <div className="screen-only" role="status" style={css("width: 794px; box-sizing: border-box; margin-top: 8px; padding: 8px 12px; border: 1px solid #e0e0e0; border-left: 3px solid #f1c21b; font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 13px; color: #161616")}>
            {c.voided ? 'ยกเลิกแล้ว' : `รอยืนยัน · ประเภทเงินได้/วิธีคำนวณของ ${c.income_type}${c.income_section ? ` (${c.income_section})` : ''} รอผู้สอบบัญชียืนยัน`}
          </div>
        </>
      )}
    </>
  );
}
