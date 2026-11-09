// T1 ภาษี — design/project/ScreenTax.dc.html (ภ.พ.30 · รายงานภาษีขาย/ซื้อ · ภ.ง.ด.3/53 · 50 ทวิ · RD Prep · ปฏิทินยื่นแบบ)
// ข้อมูล: GET /v1/tax/vat · /v1/tax/pnd (form 3/53) · /v1/wht-certificates · /v1/wht-types — ตัวเลขทุกตัวมาจาก API (ไม่ใช้เลขในแบบร่าง)
import { Shell } from '../lib/shell';
import { api } from '../lib/api';
import { appToday, deadlines, incomeLabel, monthParam, pndReport, shiftMonth, vatReport, whtTypes, type PndRow, type VatRow } from './_lib/data';
import { TaxScreen, type CertRow, type ReviewItem, type TabId } from './_screen';

const TABS: readonly TabId[] = ['pp30', 'sales', 'purchases', 'pnd3', 'pnd53', 'wht', 'pnd1', 'etax'];

interface WhtCert { id: string; cert_no: string; pnd: '3' | '53'; income_type: string; income_section: string | null; pay_date: string; base: string; rate: string; amount: string; pending_auditor: boolean; voided: boolean; name: string; tax_id: string | null; payment_no: string | null }

/** รายการที่ควรตรวจก่อนยื่น — เฉพาะที่ตรวจได้จากข้อมูล API
 * TODO(backend) ScreenTax.dc.html: ภาษีซื้อเดือนก่อนที่ขอใช้สิทธิ์ (ม.82/3) · IV บริการที่ยังไม่รับเงิน · ภาษีซื้อต้องห้าม (ค่ารับรอง) — ยังไม่มีใน GET /v1/tax/vat */
function reviewItems(rows: VatRow[]): ReviewItem[] {
  return rows.filter((r) => (r.taxId ?? '').length !== 13).map((r) => ({
    key: r.docId, tone: 'error', text: `${r.docNo} ${r.partner} — ใบกำกับระบุเลขผู้เสียภาษี ${(r.taxId ?? '').length} หลัก (ควรเป็น 13)`, href: `/finance/docs/${r.docId}/edit`, link: 'แก้ไข',
  }));
}
/** ที่อยู่ผู้รับเงินต้องมีรหัสไปรษณีย์ 5 หลัก (RD Prep) */
const noPostcode = (rows: PndRow[]): number => rows.filter((r) => !/\b\d{5}\b/u.test(r.address ?? '')).length;

export default async function TaxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ym = monthParam(sp.month);
  const tab = TABS.find((t) => t === sp.tab) ?? 'pp30';
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const [vat, pnd3, pnd53, types, certs] = await Promise.all([
    vatReport(ym), pndReport(ym, '3'), pndReport(ym, '53'), whtTypes(),
    api<WhtCert[]>(`/v1/wht-certificates?from=${ym}-01&to=${ym}-${String(last).padStart(2, '0')}`),
  ]);
  const cur = appToday().slice(0, 7);
  // TODO(backend) ScreenTax.dc.html: ป้าย "· ยื่นแล้ว" ของเดือนในตัวเลือก — ยังไม่มีสถานะการยื่นแบบใน API
  const months = [...new Set([cur, shiftMonth(cur, -1), shiftMonth(cur, -2), ym])].sort().reverse();
  const certRows: CertRow[] = certs.map((c) => ({ id: c.id, certNo: c.cert_no, pnd: c.pnd, payDate: c.pay_date, name: c.name, taxId: c.tax_id,
    income: incomeLabel(c, types), base: c.base, amount: c.amount, paymentNo: c.payment_no, voided: c.voided, pending: c.pending_auditor }));
  const fix = (r: PndRow) => ({ certNo: r.cert_no, payDate: r.pay_date, name: r.name, taxId: r.tax_id, income: incomeLabel(r, types), rate: r.rate, base: r.base, amount: r.amount, docNo: r.doc_no, pending: r.pending_auditor });
  return (
    <Shell active="tax">
      <TaxScreen
        ym={ym} tab={tab} months={months} vat={vat}
        pnd={{ '3': { ...pnd3, rows: pnd3.rows.map(fix) }, '53': { ...pnd53, rows: pnd53.rows.map(fix) } }}
        certs={certRows} review={reviewItems([...vat.sales.rows, ...vat.purchases.rows])}
        missingPostcode={noPostcode(pnd3.rows) + noPostcode(pnd53.rows)}
        due={deadlines(ym)}
      />
    </Shell>
  );
}
