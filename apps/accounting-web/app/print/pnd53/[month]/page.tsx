// PrintPnd53Attach — design/project/PrintPnd53Attach.dc.html · PDF: ./pdf · ข้อมูล: GET /v1/tax/pnd?form=53
import { PndPrint } from '../../../tax/_lib/prints';
import { monthOr404 } from '../../../tax/_lib/data';

export const metadata = { title: 'แบบพิมพ์ ใบแนบ ภ.ง.ด.53' };

export default async function PrintPnd53Attach({ params }: { params: Promise<{ month: string }> }) {
  const ym = monthOr404((await params).month);
  return <PndPrint ym={ym} form="53" />;
}
