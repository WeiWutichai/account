// ยอดของเอกสารขาย/ซื้อ (pure · ไม่มี DB) — ScreenInvoice/ScreenQuote/ScreenCreditNote
// บรรทัด: จำนวน (4 ตำแหน่ง) × ราคา/หน่วย (4 ตำแหน่ง) − ส่วนลด → ปัด 2 ตำแหน่งที่บรรทัด · ส่วนลดท้ายบิลกระจายตามสัดส่วน (เศษไปบรรทัดสุดท้าย)
// VAT คิดครั้งเดียวจากฐานที่มี VAT ทั้งเอกสาร · ราคารวม VAT: แยกด้วย 7/107 แล้วกระจายฐานกลับไปที่บรรทัด
import { Decimal } from 'decimal.js';
import { allocate, Money, type MoneyString } from './money.ts';

export interface DocLineInput { qty: string; unitPrice: string; discount?: MoneyString; vat: boolean }
export interface DocTotals {
  lines: { gross: MoneyString; amount: MoneyString }[]; // gross = ตามที่กรอก (อาจรวม VAT) · amount = ก่อน VAT ก่อนส่วนลดท้ายบิล
  subtotal: MoneyString;   // มูลค่าก่อนภาษี (ก่อนส่วนลดท้ายบิล)
  discount: MoneyString;   // ส่วนลดท้ายบิล (ก่อน VAT)
  net: MoneyString;        // subtotal − discount
  vatBase: MoneyString;
  exemptBase: MoneyString;
  vat: MoneyString;
  grandTotal: MoneyString;
}

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function lineGross(l: DocLineInput): Money {
  const raw = new D(l.qty).times(l.unitPrice).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return Money.parse(raw.toFixed(2)).minus(Money.of(l.discount ?? '0.00'));
}

export function docTotals(lines: readonly DocLineInput[], opts: { priceInclVat: boolean; billDiscount?: MoneyString; vatRate?: string } = { priceInclVat: false }): DocTotals {
  const vr = opts.vatRate ?? '0.07';
  const gross = lines.map(lineGross);
  const billDisc = Money.of(opts.billDiscount ?? '0.00');
  // ส่วนลดท้ายบิล (ใส่ตามหน่วยเดียวกับราคา) กระจายตามบรรทัด
  const discParts = allocate(billDisc, gross);
  const after = gross.map((g, i) => g.minus(discParts[i]!));
  const vatIdx = lines.map((l, i) => (l.vat ? i : -1)).filter((i) => i >= 0);
  const vatGrossAfter = Money.sum(vatIdx.map((i) => after[i]!));
  let vat: Money;
  let exAmounts: Money[]; // ก่อน VAT ก่อนส่วนลดท้ายบิล
  let net: Money;
  if (!opts.priceInclVat) {
    vat = vatGrossAfter.times(vr).round();
    exAmounts = gross;
    net = Money.sum(after);
  } else {
    // ราคารวม VAT: VAT = ยอดหลังส่วนลด × r ÷ (1 + r) · ยอดก่อน VAT = ยอดรวม − VAT · ส่วนลดก่อน VAT = ส่วนต่าง
    const onePlus = Money.parse(new D(vr).plus(1).toFixed(4));
    vat = vatGrossAfter.ratio(Money.parse(new D(vr).toFixed(4)), onePlus).round();
    exAmounts = gross.map((g, i) => (lines[i]!.vat ? g.ratio(Money.parse('1.0000'), onePlus).round() : g));
    net = Money.sum(after).minus(vat);
  }
  const subtotal = Money.sum(exAmounts);
  const exDiscount = subtotal.minus(net);
  const exemptBase = Money.sum(lines.map((l, i) => (l.vat ? Money.zero() : after[i]!)));
  const vatBase = net.minus(exemptBase);
  return {
    lines: gross.map((g, i) => ({ gross: g.toString(), amount: exAmounts[i]!.toString() })),
    subtotal: subtotal.toString(), discount: exDiscount.toString(), net: net.toString(),
    vatBase: vatBase.toString(), exemptBase: exemptBase.toString(), vat: vat.toString(), grandTotal: net.plus(vat).toString(),
  };
}

/** ยอดค้างของใบแจ้งหนี้ = ยอดรวม − Σ(ตัด + ภาษีถูกหัก) − ลดหนี้ + เพิ่มหนี้ */
export function outstanding(total: MoneyString, settled: readonly MoneyString[], credits: readonly MoneyString[] = [], debits: readonly MoneyString[] = []): MoneyString {
  return Money.of(total).minus(Money.sum(settled.map(Money.of))).minus(Money.sum(credits.map(Money.of))).plus(Money.sum(debits.map(Money.of))).toString();
}

export interface ReceiptApplication { invoiceTotal: MoneyString; invoiceVat: MoneyString; vatOnPayment: boolean; settledBefore: MoneyString; vatDueBefore: MoneyString; applied: MoneyString; wht: MoneyString }
/**
 * ยอดของใบรับชำระ (ScreenReceipt): ตัดหลายใบ · ภาษีถูกหัก · ค่าธรรมเนียม · ภาษีขายที่ถึงกำหนด (ม.78/1)
 * ภาษีขายที่โอนคิดแบบสะสม: round(VAT × รับสะสม ÷ ยอดรวม) − ที่โอนไปแล้ว → รับครบ = VAT ทั้งใบพอดี
 */
export function receiptTotals(apps: readonly ReceiptApplication[], fee: MoneyString = '0.00') {
  const per = apps.map((a) => {
    const settledNow = Money.of(a.applied).plus(Money.of(a.wht));
    const cum = Money.of(a.settledBefore).plus(settledNow);
    if (cum.gt(Money.of(a.invoiceTotal))) throw new Error('ตัดยอดเกินยอดค้าง');
    let vatDue = Money.zero();
    if (a.vatOnPayment) {
      const target = cum.equals(Money.of(a.invoiceTotal)) ? Money.of(a.invoiceVat) : Money.of(a.invoiceVat).ratio(cum, Money.of(a.invoiceTotal)).round();
      vatDue = target.minus(Money.of(a.vatDueBefore));
    }
    return { settled: settledNow, vatDue };
  });
  const applied = Money.sum(apps.map((a) => Money.of(a.applied)));
  const wht = Money.sum(apps.map((a) => Money.of(a.wht)));
  const f = Money.of(fee);
  return {
    perDoc: per.map((p) => ({ settled: p.settled.toString(), vatDue: p.vatDue.toString() })),
    applied: applied.toString(), wht: wht.toString(), fee: f.toString(),
    settled: applied.plus(wht).toString(), cashIn: applied.minus(f).toString(),
    vatDue: Money.sum(per.map((p) => p.vatDue)).toString(),
  };
}
