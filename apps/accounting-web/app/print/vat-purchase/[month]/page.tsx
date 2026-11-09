// PrintVatPurchase — design/project/PrintVatPurchase.dc.html · PDF: ./pdf · ข้อมูล: GET /v1/tax/vat
import { VatPrint } from '../../../tax/_lib/prints';
import { monthOr404 } from '../../../tax/_lib/data';

export const metadata = { title: 'แบบพิมพ์ รายงานภาษีซื้อ' };

export default async function PrintVatPurchase({ params }: { params: Promise<{ month: string }> }) {
  const ym = monthOr404((await params).month);
  return <VatPrint ym={ym} side="purchases" />;
}
