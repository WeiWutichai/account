// D3 ใบลดหนี้ (PrintCreditNote.dc.html) / D5 ใบเพิ่มหนี้ (PrintDebitNote.dc.html) — สองแบบร่างโครงเดียวกัน ต่างที่ข้อความ
import { css, thaiDate } from '@innovera/ui';
import { add, context, customerAddress, itemRows, loadDoc, originalTaxInvoice, sub, vatPct } from './data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, m, NBSP, PartyBox, Sheet, Signatures, Totals } from './parts';

const TEXT = {
  CN: { title: 'ใบลดหนี้', en: 'CREDIT NOTE', col: 'มูลค่าที่ลด', why: 'เหตุที่ออกใบลดหนี้', orig: 'มูลค่าสินค้าตามใบกำกับภาษีเดิม', total: 'รวมยอดลดหนี้', foot: 'ม.86/10 · ลดภาษีขายในเดือนที่ออกใบลดหนี้ (ม.82/10)' },
  DN: { title: 'ใบเพิ่มหนี้', en: 'DEBIT NOTE', col: 'มูลค่าที่เพิ่ม', why: 'เหตุที่ออกใบเพิ่มหนี้', orig: 'มูลค่าตามใบกำกับภาษีเดิม', total: 'รวมยอดเพิ่มหนี้', foot: 'ม.86/9 · ภาษีขายรวมในเดือนที่ออกใบเพิ่มหนี้ (ม.82/9)' },
} as const;

// TODO(Wei) PrintCreditNote.dc.html / PrintDebitNote.dc.html: "มูลค่าที่ถูกต้อง" = มูลค่าเดิม ∓ ผลต่างของใบนี้ — ยังไม่หักใบลดหนี้/เพิ่มหนี้ใบก่อนหน้าที่อ้างใบเดียวกัน
// TODO(Wei): พิมพ์เอกสารสถานะร่าง (ยังไม่มีเลขที่) — แบบร่างไม่ได้กำหนดลายน้ำ/ข้อความ "ร่าง" · ตอนนี้แสดงเลขที่ว่าง
export async function AdjustNote({ kind, id, sp }: { kind: 'CN' | 'DN'; id: string; sp: Record<string, string | string[] | undefined> }) {
  const t = TEXT[kind];
  const [d, ctx] = await Promise.all([loadDoc(id, [kind]), context()]);
  const { doc } = d;
  const orig = await originalTaxInvoice(d);
  const diff = sub(doc.subtotal, doc.discount);
  const origBase = orig?.base ?? '0.00';
  const corrected = kind === 'CN' ? sub(origBase, diff) : add(origBase, diff);
  const rows = itemRows(d.lines);
  return (
    <Sheet>
      <Header ctx={ctx} title={t.title} en={t.en} badge={badgeOf(sp)} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="ผู้ซื้อ" c={d.contact} address={customerAddress(d)} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['อ้างอิง', orig?.no ?? '']]} />
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('width: 36px')}>ลำดับ</th><th style={css('text-align: left')}>รายการ</th><th style={css('width: 70px')} className="n">จำนวน</th><th style={css('width: 90px')} className="n">ราคา/หน่วย</th><th style={css('width: 110px')} className="n">{t.col}</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.key}><td style={css('text-align: center')}>{r.no ?? ''}</td><td>{r.desc}</td><td className="n">{r.qty}</td><td className="n">{r.price}</td><td className="n">{r.amount}</td></tr>)}
          <tr><td style={{ height: filler(200, 1, rows.length) }}></td><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
      <div style={css('display: flex; gap: 12px; align-items: stretch')}>
        <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px')}>
          <div><span className="lbl">{t.why}</span><br /><strong>{doc.notes || NBSP}</strong></div>
          <div><span className="lbl">อ้างอิงใบกำกับภาษีเดิม</span><br />เลขที่ {orig?.no ?? ''} ลงวันที่ {orig ? thaiDate(orig.date) : ''}</div>
          <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
        </div>
        <Totals width={300} rows={[
          { label: t.orig, value: m(origBase) },
          { label: 'มูลค่าที่ถูกต้อง', value: m(corrected) },
          { label: 'ผลต่าง', value: m(diff) },
          { label: `ภาษีมูลค่าเพิ่ม ${vatPct(d.lines)}% ของผลต่าง`, value: m(doc.vat) },
          { label: t.total, value: m(doc.grand_total), bold: true },
        ]} />
      </div>
      <Signatures cols={2} items={[['ผู้รับเอกสาร', DATE_BLANK], ['ผู้มีอำนาจลงนาม', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no, t.foot]} />
    </Sheet>
  );
}
