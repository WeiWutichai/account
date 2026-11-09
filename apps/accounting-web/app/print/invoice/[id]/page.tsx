// D1 แบบพิมพ์ใบแจ้งหนี้ — design/project/PrintInvoice.dc.html · PDF: ./pdf
import { css, thaiDate } from '@innovera/ui';
import { bankAccounts, context, creditDays, customerAddress, itemRows, loadDoc, pct, receiveBank, timesRate, transferText, vatBase, vatPct } from '../../_lib/data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, ItemTable6, m, mBlank, PartyBox, Sheet, Signatures, Totals } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบแจ้งหนี้' };

// TODO(Wei) PrintInvoice.dc.html: แบบร่างมีเฉพาะใบแจ้งหนี้ที่ออกใบกำกับเมื่อรับเงิน (ม.78/1) — IV แบบ tax_mode = immediate (ใบแจ้งหนี้/ใบกำกับภาษี) ยังไม่มีแบบพิมพ์
//   ตอนนี้ใช้หัวเดิม และไม่พิมพ์ข้อความ "เอกสารนี้ไม่ใช่ใบกำกับภาษี" สำหรับ immediate
// TODO(Wei) PrintInvoice.dc.html: อัตราหัก ณ ที่จ่ายในข้อความ "หากหักภาษี ณ ที่จ่าย 3%" — เอกสารยังไม่มีอัตราที่คาดว่าจะถูกหัก (wht_rate ของ IV ว่าง)
//   ใช้ 3% ตามแบบร่าง/fixtures (wht_if_deducted_3pct) จนกว่าจะกำหนดจากผู้ติดต่อ/สินค้า
const WHT_HINT_RATE = '0.0300';
const BLANK = '________';

export default async function PrintInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [d, ctx, banks] = await Promise.all([loadDoc(id, ['IV']), context(), bankAccounts()]);
  const bank = receiveBank(banks);
  const { doc } = d;
  const onPayment = doc.tax_mode === 'on_payment';
  const base = vatBase(d);
  const whtRate = doc.wht_rate ?? WHT_HINT_RATE;
  const rows = itemRows(d.lines);
  const credit = creditDays(doc, d.contact);
  const info: [string, string][] = [['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['ครบกำหนด', doc.due_date ? thaiDate(doc.due_date) : ''], ['เครดิต', credit === null ? '' : `${credit} วัน`]];
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบแจ้งหนี้" en="INVOICE" badge={badgeOf(sp, doc)} doc={doc} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="ลูกค้า" c={d.contact} address={customerAddress(d)} />
        <InfoBox rows={info} />
      </div>
      <ItemTable6 rows={rows} fill={filler(220, 2, rows.length)} />
      <div style={css('display: flex; gap: 12px; align-items: stretch')}>
        <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
          <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
          {/* บัญชีรับโอนตั้งต้นของบริษัท (GET /v1/bank-accounts) · ไม่มีในทะเบียน → ช่องว่างให้กรอก */}
          <div><span className="lbl">ชำระภายใน {doc.due_date ? thaiDate(doc.due_date) : ''}</span><br />{bank ? transferText(bank, ctx.name) : `โอนเข้าบัญชี ${BLANK} เลขที่ ${BLANK} ชื่อบัญชี ${ctx.name}`}
            {onPayment ? <><br />หากหักภาษี ณ ที่จ่าย {pct(whtRate)}% ({m(timesRate(base, whtRate))} บาท) กรุณาส่งหนังสือรับรอง 50 ทวิ มาพร้อมหลักฐานการโอน</> : null}</div>
        </div>
        <Totals width={280} rows={[
          { label: 'รวมมูลค่าสินค้า/บริการ', value: m(doc.subtotal) },
          { label: 'หัก ส่วนลด', value: mBlank(doc.discount) },
          { label: 'มูลค่าที่คำนวณภาษี', value: m(base) },
          { label: `ภาษีมูลค่าเพิ่ม ${vatPct(d.lines)}%`, value: m(doc.vat) },
          { label: 'จำนวนเงินรวมทั้งสิ้น', value: m(doc.grand_total), bold: true },
        ]} />
      </div>
      {onPayment ? <div style={css('border: 1px solid #393939; padding: 8px 12px; font-weight: 600')}>เอกสารนี้ไม่ใช่ใบกำกับภาษี — ใบเสร็จรับเงิน/ใบกำกับภาษีจะออกให้เมื่อได้รับชำระ</div> : null}
      <Signatures cols={2} items={[['ผู้รับวางบิล', DATE_BLANK], ['ผู้มีอำนาจลงนาม', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no]} />
    </Sheet>
  );
}
