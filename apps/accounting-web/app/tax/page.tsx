// T1 ภาษี — design/project/ScreenTax.dc.html (ภ.พ.30 · รายงานภาษีขาย/ซื้อ · ภ.ง.ด.3/53 · 50 ทวิ · RD Prep · ปฏิทินยื่นแบบ)
// ข้อมูล: GET /v1/tax/vat · /v1/tax/pnd (form 3/53) · /v1/wht-certificates · /v1/wht-types — ตัวเลขทุกตัวมาจาก API (ไม่ใช้เลขในแบบร่าง)
import { Shell } from '../lib/shell';
import { api } from '../lib/api';
import { money } from '@innovera/ui';
import { docHref, type DocType } from '../sales/_lib/doc';
import { appToday, deadlines, incomeLabel, monthAbbr, monthParam, pndReport, shiftMonth, taxFilings, vatReport, whtTypes, type PndRow, type VatReport, type VatRow } from './_lib/data';
import { TaxScreen, type CertRow, type ReviewItem, type TabId } from './_screen';

const TABS: readonly TabId[] = ['pp30', 'sales', 'purchases', 'pnd3', 'pnd53', 'wht', 'pnd1', 'etax'];

interface WhtCert { id: string; cert_no: string; pnd: '3' | '53'; income_type: string; income_section: string | null; pay_date: string; base: string; rate: string; amount: string; pending_auditor: boolean; voided: boolean; name: string; tax_id: string | null; payment_no: string | null }

/** รายการที่ควรตรวจก่อนยื่น — เฉพาะที่ตรวจได้จากข้อมูล API (ScreenTax.dc.html: เลขผู้เสียภาษี · ภาษีซื้อเดือนก่อน ม.82/3 · IV บริการที่ยังไม่รับเงิน · ภาษีซื้อต้องห้าม) */
function reviewItems(vat: VatReport): ReviewItem[] {
  const ym = vat.month;
  const out: ReviewItem[] = [...vat.sales.rows, ...vat.purchases.rows].filter((r) => r.docType !== 'FA' && (r.taxId ?? '').length !== 13).map((r: VatRow) => ({
    key: r.docId, tone: 'error', text: `${r.docNo} ${r.partner} — ใบกำกับระบุเลขผู้เสียภาษี ${(r.taxId ?? '').length} หลัก (ควรเป็น 13)`, href: `/finance/docs/${r.docId}/edit`, link: 'แก้ไข',
  }));
  const prior = vat.pp30.priorMonthClaims;
  if (prior.count > 0) {
    const from = [...new Set(prior.rows.map((r) => monthAbbr(r.issueMonth)))].join(', ');
    out.push({ key: 'prior', tone: 'warning', text: `ภาษีซื้อ ${prior.count} ใบจาก ${from} (${prior.rows.map((r) => r.vendorRef ?? r.docNo).join(', ')}) ขอใช้สิทธิ์เดือนนี้ (ภายใน 6 เดือน ✓) รวม ${money(prior.vat)}`, href: `/tax?month=${ym}&tab=purchases`, link: 'ดู' });
  }
  for (const d of vat.deferredService) {
    out.push({ key: `def-${d.docId}`, tone: 'warning', text: `${d.docNo} บริการ — ยังไม่รับเงิน จุดภาษียังไม่เกิด (ไม่รวมในเดือนนี้ ตามเกณฑ์เงินสดสำหรับบริการ)`, href: docHref({ id: d.docId, doc_type: d.docType as DocType }), link: 'ดู' });
  }
  // TODO(Wei) ScreenTax.dc.html: ข้อความ "ค่ารับรอง" ตามแบบร่าง — บัญชีภาษีซื้อต้องห้ามมาจาก config tax.vat.disallowed_input_accounts (ยังไม่ได้กำหนด)
  //   และสูตรลงบัญชียังลงภาษีซื้อเข้า 1170100 ตามเดิม (ยังไม่ "รวมเป็นค่าใช้จ่าย") — ต้องตัดสินใจก่อนเปิดใช้
  if (vat.disallowed.items > 0) {
    out.push({ key: 'disallowed', tone: 'warning', text: `ค่ารับรอง ${vat.disallowed.items} รายการ ตั้งเป็นภาษีซื้อต้องห้าม → รวมเป็นค่าใช้จ่ายแล้ว ${money(vat.disallowed.amount)}`, href: `/tax?month=${ym}&tab=purchases`, link: 'ดู' });
  }
  return out;
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
  const months = [...new Set([cur, shiftMonth(cur, -1), shiftMonth(cur, -2), ym])].sort().reverse();
  // ป้าย "· ยื่นแล้ว" ของเดือนในตัวเลือก = ภ.พ.30 ของเดือนนั้นบันทึกว่ายื่นแล้ว
  const filed = await taxFilings(months.at(-1)!, months[0]!);
  const filedMonths = [...new Set(filed.filter((f) => f.form === 'pp30').map((f) => f.month))];
  const certRows: CertRow[] = certs.map((c) => ({ id: c.id, certNo: c.cert_no, pnd: c.pnd, payDate: c.pay_date, name: c.name, taxId: c.tax_id,
    income: incomeLabel(c, types), base: c.base, amount: c.amount, paymentNo: c.payment_no, voided: c.voided, pending: c.pending_auditor }));
  const fix = (r: PndRow) => ({ certNo: r.cert_no, payDate: r.pay_date, name: r.name, taxId: r.tax_id, income: incomeLabel(r, types), rate: r.rate, base: r.base, amount: r.amount, docNo: r.doc_no, pending: r.pending_auditor });
  return (
    <Shell active="tax">
      <TaxScreen
        ym={ym} tab={tab} months={months} filedMonths={filedMonths} vat={vat} today={appToday()}
        pnd={{ '3': { ...pnd3, rows: pnd3.rows.map(fix) }, '53': { ...pnd53, rows: pnd53.rows.map(fix) } }}
        certs={certRows} review={reviewItems(vat)}
        missingPostcode={noPostcode(pnd3.rows) + noPostcode(pnd53.rows)}
        due={deadlines(ym, vat.onlineExtension)}
      />
    </Shell>
  );
}
