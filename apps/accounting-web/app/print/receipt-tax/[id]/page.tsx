// D2 แบบพิมพ์ใบเสร็จรับเงิน/ใบกำกับภาษี (บริการ ม.78/1: ออกเมื่อรับเงิน) — design/project/PrintReceiptTax.dc.html · PDF: ./pdf
// ใช้กับ RV ที่ตัดใบแจ้งหนี้ tax_mode = on_payment · รายการ = รายการของใบแจ้งหนี้ที่รับชำระ · ยอด = ยอดชำระหนี้ (รับ + ภาษีถูกหัก) และภาษีขายที่ถึงกำหนด
import { css, thaiDate } from '@innovera/ui';
import { notFound } from 'next/navigation';
import {
  add, bankAccounts, bankName, bahtTextOf, context, customerAddress, gt, isBankAccount, isCashAccount, itemRows, liveCheques, loadDoc, pct, receiveAccountName, settledDocs, sub, vatPct,
} from '../../_lib/data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, ItemTable6, m, mBlank, PartyBox, Sheet, Signatures, Totals } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบเสร็จรับเงิน/ใบกำกับภาษี' };
const BLANK = '________';

// TODO(Wei) PrintReceiptTax.dc.html: รับชำระบางส่วน — แบบร่างแสดงรายการเต็มของใบแจ้งหนี้ ส่วนยอดเป็นยอดที่รับจริง (รายการกับยอดอาจไม่เท่ากัน) · ยังแสดงรายการเต็มตามแบบร่าง
// TODO(Wei) PrintReceiptTax.dc.html: RV ที่ตัดทั้งใบแบบ on_payment และ immediate ปนกัน — พิมพ์เฉพาะใบ on_payment (ใบ immediate มีใบกำกับภาษีแล้ว)
export default async function PrintReceiptTax({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [d, ctx, banks] = await Promise.all([loadDoc(id, ['RV']), context(), bankAccounts()]);
  const { doc } = d;
  const items = (await settledDocs(d)).filter((x) => x.inv?.doc.tax_mode === 'on_payment');
  if (!items.length) notFound();
  const settled = add('0.00', ...items.flatMap((x) => [x.s.applied, x.s.wht]));
  const vat = add('0.00', ...items.map((x) => x.s.vat_due));
  const base = sub(settled, vat);
  const amountText = await bahtTextOf(settled);
  const lines = items.flatMap((x) => x.inv?.lines ?? []);
  let n = 0;
  const rows = items.flatMap((x) => itemRows(x.inv?.lines ?? [], (l, i) => (i === 0 ? `${l.description} ตามใบแจ้งหนี้ ${x.s.doc_no}` : l.description)))
    .map((r, i) => ({ ...r, key: `${i}`, no: r.no === null ? null : ++n }));
  const acct = receiveAccountName(d);
  const cheque = liveCheques(d)[0];
  const bank = !cheque && isBankAccount(acct);
  // บัญชีที่รับเงินเข้าในทะเบียนบัญชีธนาคาร (GET /v1/bank-accounts) — ไม่มีในทะเบียน → ชื่อธนาคารจากผังบัญชี + ช่องว่างเลขที่
  const reg = banks.find((b) => b.gl_account === doc.receive_account) ?? null;
  const whtOn = gt(doc.wht, '0.00');
  const info: [string, string][] = [['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['อ้างอิง', items.map((x) => x.s.doc_no).join(', ')], ['ผู้ขาย', ctx.branch]];
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบเสร็จรับเงิน / ใบกำกับภาษี" en="RECEIPT / TAX INVOICE" badge={badgeOf(sp, doc)} doc={doc} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="ได้รับเงินจาก / ผู้ซื้อ" c={d.contact} address={customerAddress(d)} />
        <InfoBox rows={info} />
      </div>
      <ItemTable6 rows={rows} fill={filler(220, 2, rows.length)} />
      <div style={css('display: flex; gap: 12px; align-items: stretch')}>
        <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
          <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({amountText})</strong></div>
          <div><span className="lbl">การชำระเงิน</span><br />
            <span className="box">{bank ? '✓' : ''}</span>{bank ? `โอนเข้าบัญชี ${reg?.bank_name ?? bankName(acct)} เลขที่ ${reg?.account_no ?? BLANK} วันที่ ${thaiDate(doc.issue_date)} จำนวน ${m(doc.grand_total)} บาท` : `โอนเข้าบัญชี ${BLANK} เลขที่ ${BLANK} วันที่ ${BLANK} จำนวน ${BLANK} บาท`}<br />
            <span className="box">{whtOn ? '✓' : ''}</span>ลูกค้าหักภาษี ณ ที่จ่าย {whtOn ? `${pct(doc.wht_rate)}% จำนวน ${m(doc.wht)} บาท` : `${BLANK}% จำนวน ${BLANK} บาท`} (ตามหนังสือรับรอง 50 ทวิ ของลูกค้า)<br />
            <span className="box">{isCashAccount(acct) ? '✓' : ''}</span>เงินสด &nbsp; <span className="box">{cheque ? '✓' : ''}</span>เช็คธนาคาร {cheque ? cheque.bank : BLANK} เลขที่ {cheque ? cheque.cheque_no : BLANK} ลงวันที่ {cheque ? thaiDate(cheque.cheque_date) : BLANK}</div>
        </div>
        <Totals width={280} rows={[
          { label: 'รวมมูลค่าสินค้า/บริการ', value: m(base) },
          { label: 'หัก ส่วนลด', value: mBlank('0.00') },
          { label: 'มูลค่าที่คำนวณภาษี', value: m(base) },
          { label: `ภาษีมูลค่าเพิ่ม ${vatPct(lines)}%`, value: m(vat) },
          { label: 'จำนวนเงินรวมทั้งสิ้น', value: m(settled), bold: true },
        ]} />
      </div>
      <div className="lbl">เอกสารนี้ออกเป็นชุด · ใบเสร็จรับเงินจะสมบูรณ์เมื่อเรียกเก็บเงินตามเช็คได้แล้ว · บริการ: จุดความรับผิดเกิดเมื่อได้รับชำระ (ม.78/1)</div>
      <Signatures cols={2} items={[['ผู้รับเงิน', DATE_BLANK], ['ผู้มีอำนาจลงนาม', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no, 'สำเนาที่พิมพ์ซ้ำจะแสดงคำว่า “สำเนา”']} />
    </Sheet>
  );
}
