// D11 แบบพิมพ์ใบสำคัญรับ (เอกสารภายใน) — design/project/PrintReceiptVoucher.dc.html · PDF: ./pdf
import { css, money, thaiDate } from '@innovera/ui';
import { add, context, customerAddress, gt, howReceived, liveCheques, loadDoc, outstandingBefore, pct, receiveAccountName, settledDocs } from '../../_lib/data';
import { DATE_BLANK, filler, Footer, Header, InfoBox, m, PartyBox, Sheet, Signatures } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบสำคัญรับ' };

// TODO(Wei) PrintReceiptVoucher.dc.html: แถว IV2610-0049 ต่อท้าย "· ใบเสร็จรับเงิน/ใบกำกับภาษี RV…" แต่แถว IV2611-0053 (on_payment ตัดบางส่วน) ไม่ต่อท้าย —
//   ใช้กติกาตามตัวอย่าง: ตัดครบ + on_payment → ต่อท้ายเลขใบกำกับภาษี · ตัดบางส่วน → "(ตัดบางส่วน)"
// "อ้างอิง" (BN2611-0002) = ใบวางบิลที่ใบรับชำระอ้าง (receivePayment billingId → ref_document_id) · ไม่มี → doc.reference
export default async function PrintReceiptVoucher({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d, ctx] = await Promise.all([loadDoc(id, ['RV']), context()]);
  const { doc } = d;
  const items = await settledDocs(d);
  const rows = items.map(({ s, inv }) => {
    const before = outstandingBefore(doc, s, inv);
    const partial = gt(before, add(s.applied, s.wht));
    const desc = inv?.lines[0]?.description ?? '';
    const tail = partial ? ' (ตัดบางส่วน)' : inv?.doc.tax_mode === 'on_payment' ? ` · ใบเสร็จรับเงิน/ใบกำกับภาษี ${doc.doc_no ?? ''}` : '';
    return { s, before, text: `${s.doc_no} ${desc}${tail}` };
  });
  const acct = receiveAccountName(d);
  const how = howReceived(d);
  const cheque = liveCheques(d)[0];
  const detail = `เงินเข้าบัญชี ${doc.receive_account ?? ''} ${acct.replace(/^เงินฝากธนาคาร\s*/u, '')} วันที่ ${thaiDate(doc.issue_date)}`
    + (cheque ? ` · เช็ค ${cheque.bank} เลขที่ ${cheque.cheque_no} ลงวันที่ ${thaiDate(cheque.cheque_date)}` : '')
    + (gt(doc.fee, '0.00') ? ` · ค่าธรรมเนียมธนาคาร ${m(doc.fee)}` : '')
    + (gt(doc.wht, '0.00') ? ` · หนังสือรับรอง 50 ทวิ ที่ได้รับ เลขที่ ${doc.wht_cert_no ?? ''} (${pct(doc.wht_rate)}%) ${m(doc.wht)}` : '');
  const dr = add('0.00', ...d.journal.map((j) => j.debit));
  const cr = add('0.00', ...d.journal.map((j) => j.credit));
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบสำคัญรับ" en="RECEIPT VOUCHER" badge="เอกสารภายใน" />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="รับเงินจาก" c={d.contact} address={customerAddress(d)} nameSuffix={d.contact ? ` · ${d.contact.code}` : ''} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่รับ', thaiDate(doc.issue_date)], ['อ้างอิง', d.ref?.doc_type === 'BN' ? d.ref.doc_no ?? '' : doc.reference ?? ''], ['วิธีรับ', how]]} />
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('width: 36px')}>ลำดับ</th><th style={css('text-align: left')}>รายการ</th><th className="n">ค้างชำระ</th><th className="n">ถูกหัก ณ ที่จ่าย</th><th className="n">รับชำระ</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={r.s.id}><td className="c">{i + 1}</td><td>{r.text}</td><td className="n">{m(r.before)}</td><td className="n">{m(r.s.wht)}</td><td className="n">{m(r.s.applied)}</td></tr>)}
          <tr><td style={{ height: filler(110, 2, rows.length) }}></td><td></td><td></td><td></td><td></td></tr>
          <tr style={css('font-weight: 700')}><td colSpan={2} style={css('text-align: right')}>รวม</td><td className="n">{m(add('0.00', ...rows.map((r) => r.before)))}</td><td className="n">{m(add('0.00', ...rows.map((r) => r.s.wht)))}</td><td className="n">{m(add('0.00', ...rows.map((r) => r.s.applied)))}</td></tr>
        </tbody>
      </table>
      <div style={css('border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
        <div><span className="lbl">จำนวนเงินที่รับ (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
        <div><span className="lbl">รายละเอียด</span><br />{detail}</div>
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('text-align: left')}>การลงบัญชี</th><th style={css('text-align: left')}>ชื่อบัญชี</th><th className="n" style={css('width: 120px')}>เดบิต</th><th className="n" style={css('width: 120px')}>เครดิต</th></tr></thead>
        <tbody>
          {d.journal.map((j) => {
            const isCr = gt(j.credit, '0.00');
            const name = j.account_code === '2150400' && !isCr ? `${j.name} (โอนไปภาษีขาย)` : j.name;
            return <tr key={j.line_no}><td>{j.account_code}</td><td style={isCr ? css('padding-left: 24px') : undefined}>{name}</td><td className="n">{money(j.debit, { blankZero: true })}</td><td className="n">{money(j.credit, { blankZero: true })}</td></tr>;
          })}
          <tr style={css('font-weight: 700')}><td colSpan={2} style={css('text-align: right')}>รวม</td><td className="n">{m(dr)}</td><td className="n">{m(cr)}</td></tr>
        </tbody>
      </table>
      <Signatures cols={4} items={[['ผู้จัดทำ', DATE_BLANK], ['ผู้ตรวจสอบ', DATE_BLANK], ['ผู้อนุมัติ', DATE_BLANK], ['ผู้รับเงิน', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no, 'แนบสำเนาใบเสร็จรับเงิน/ใบกำกับภาษี หลักฐานการโอน และ 50 ทวิ ที่ได้รับ']} />
    </Sheet>
  );
}
