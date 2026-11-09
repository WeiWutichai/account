// D8 แบบพิมพ์ใบเสนอราคา — design/project/PrintQuote.dc.html · PDF: ./pdf
import { css, thaiDate } from '@innovera/ui';
import { context, customerAddress, itemRows, loadDoc, vatBase, vatPct } from '../../_lib/data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, ItemTable6, m, NBSP, PartyBox, Sheet, Signatures, Totals } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบเสนอราคา' };

// TODO(backend) PrintQuote.dc.html: พนักงานขาย · หมายเหตุใต้รายการ (เช่น "ส่งมอบภายใน 60 วันหลังรับมัดจำ …") ยังไม่มีในเอกสาร/API → เว้นว่าง · ผู้ติดต่อ = contact.contact_person (ว่าง → ช่องกรอกตามแบบร่าง)
export default async function PrintQuote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [d, ctx] = await Promise.all([loadDoc(id, ['QO']), context()]);
  const { doc } = d;
  const rows = itemRows(d.lines);
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบเสนอราคา" en="QUOTATION" badge={badgeOf(sp)} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="เรียน" c={d.contact} address={customerAddress(d)} taxLine={`เลขประจำตัวผู้เสียภาษีอากร ${d.contact?.tax_id ?? ''} · ผู้ติดต่อ ${d.contact?.contact_person ?? '[ชื่อ] ฝ่ายจัดซื้อ'}`} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['ยืนราคาถึง', doc.due_date ? thaiDate(doc.due_date) : ''], ['พนักงานขาย', '[พนักงานขาย]']]} />
      </div>
      <ItemTable6 rows={rows} fill={filler(160, 3, rows.length)} />
      <div style={css('display: flex; gap: 12px; align-items: stretch')}>
        <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
          <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
          <div><span className="lbl">เงื่อนไข</span><br />{doc.notes || NBSP}</div>
        </div>
        <Totals width={280} rows={[
          { label: 'รวมมูลค่า', value: m(doc.subtotal) },
          { label: 'หัก ส่วนลด', value: m(doc.discount) },
          { label: 'มูลค่าที่คำนวณภาษี', value: m(vatBase(d)) },
          { label: `ภาษีมูลค่าเพิ่ม ${vatPct(d.lines)}%`, value: m(doc.vat) },
          { label: 'จำนวนเงินรวมทั้งสิ้น', value: m(doc.grand_total), bold: true },
        ]} />
      </div>
      <div style={css('border: 1px solid #393939; padding: 8px 12px')}><strong>การยอมรับใบเสนอราคา</strong> — ลงนามและส่งกลับ หรือกดยอมรับในลิงก์ที่ส่งทางอีเมล ถือเป็นการสั่งซื้อ<br /><span className="lbl">ใบเสนอราคาไม่ใช่ใบกำกับภาษี</span></div>
      <Signatures cols={3} items={[['ผู้เสนอราคา', DATE_BLANK], ['ผู้มีอำนาจลงนาม', DATE_BLANK], ['ผู้ยอมรับใบเสนอราคา (ลูกค้า)', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no]} />
    </Sheet>
  );
}
