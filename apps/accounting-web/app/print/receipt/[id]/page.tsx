// D10 แบบพิมพ์ใบเสร็จรับเงิน (ไม่มีภาษีมูลค่าเพิ่ม) — design/project/PrintReceiptNoVat.dc.html · PDF: ./pdf
// จำนวนเงินตัวอักษร = ยอดที่รับชำระหนี้ (รวมภาษีที่ถูกหัก) ตามข้อความในแบบร่าง
import { css, money, thaiDate } from '@innovera/ui';
import { add, bahtTextOf, bankName, context, customerAddress, gt, howReceived, isBankAccount, isZero, liveCheques, loadDoc, pct, receiveAccountName, settledDocs, sub } from '../../_lib/data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, m, PartyBox, Sheet, Signatures, Totals } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบเสร็จรับเงิน (ไม่มีภาษีมูลค่าเพิ่ม)' };
const BLANK = '________';

// TODO(backend) PrintReceiptNoVat.dc.html: เหตุยกเว้น VAT ใต้รายการ (เช่น "ให้เช่าอสังหาริมทรัพย์ ได้รับยกเว้นภาษีมูลค่าเพิ่ม ม.81(1)(ฑ)") และประเภทเงินได้ของ 50 ทวิ (เช่น "(ค่าเช่า)") ยังไม่มีใน API
export default async function PrintReceipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [d, ctx] = await Promise.all([loadDoc(id, ['RV']), context()]);
  const { doc } = d;
  const items = await settledDocs(d);
  const settled = doc.subtotal; // RV.subtotal = ยอดชำระหนี้ (ตัด + ภาษีถูกหัก)
  const amountText = await bahtTextOf(settled);
  const acct = receiveAccountName(d);
  const how = howReceived(d);
  const cheque = liveCheques(d)[0];
  const whtOn = gt(doc.wht, '0.00');
  const detail = `${cheque ? `เช็ค ${cheque.bank} เลขที่ ${cheque.cheque_no} ลงวันที่ ${thaiDate(cheque.cheque_date)} · รับ` : isBankAccount(acct) ? `โอนเข้าบัญชี ${bankName(acct)} ${BLANK}` : how} วันที่ ${thaiDate(doc.issue_date)}`
    + (whtOn ? ` · ได้รับหนังสือรับรองหัก ณ ที่จ่าย ${pct(doc.wht_rate)}% เลขที่ ${doc.wht_cert_no ?? ''} จำนวน ${m(doc.wht)} บาท` : '');
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบเสร็จรับเงิน" en="RECEIPT" badge={badgeOf(sp)} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="ได้รับเงินจาก" c={d.contact} address={customerAddress(d)} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['อ้างอิง', items.map((x) => x.s.doc_no).join(', ')], ['วิธีรับเงิน', how]]} />
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('width: 36px')}>ลำดับ</th><th style={css('text-align: left')}>รายการ</th><th style={css('width: 120px')} className="n">อ้างอิงใบแจ้งหนี้</th><th style={css('width: 120px')} className="n">จำนวนเงิน</th></tr></thead>
        <tbody>
          {items.map(({ s, inv }, i) => (
            <tr key={s.id}><td className="c">{i + 1}</td><td>{(inv?.lines ?? []).map((l, j) => <span key={l.line_no}>{j ? <br /> : null}{l.description}</span>)}</td><td className="n">{s.doc_no}</td><td className="n">{m(add(s.applied, s.wht))}</td></tr>
          ))}
          <tr><td style={{ height: filler(240, 1, items.length) }}></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
      <div style={css('display: flex; gap: 12px; align-items: stretch')}>
        <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
          <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({amountText})</strong></div>
          <div><span className="lbl">รายละเอียดการรับเงิน</span><br />{detail}</div>
        </div>
        <Totals width={280} rows={[
          { label: 'มูลค่าตามใบแจ้งหนี้', value: m(settled) },
          { label: `หัก ภาษีหัก ณ ที่จ่าย ${pct(doc.wht_rate)}%`, value: whtOn ? money(`-${doc.wht}`, { paren: true }) : '' },
          { label: 'ภาษีมูลค่าเพิ่ม', value: isZero(doc.vat) ? '— (ไม่มี)' : m(doc.vat) },
          { label: 'จำนวนเงินที่รับจริง', value: m(sub(settled, doc.wht)), bold: true },
        ]} />
      </div>
      <div style={css('border: 1px solid #393939; padding: 8px 12px; font-weight: 600')}>เอกสารนี้ไม่ใช่ใบกำกับภาษี — ใช้สำหรับรายการที่ได้รับยกเว้นหรืออยู่นอกขอบเขตภาษีมูลค่าเพิ่มเท่านั้น · จำนวนเงินตัวอักษรเป็นยอดที่รับชำระหนี้ (รวมภาษีที่ถูกหัก)</div>
      <Signatures cols={2} items={[['ผู้รับเงิน', DATE_BLANK], ['ผู้มีอำนาจลงนาม', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no]} />
    </Sheet>
  );
}
