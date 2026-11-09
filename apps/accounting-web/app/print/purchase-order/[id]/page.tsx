// D9 แบบพิมพ์ใบสั่งซื้อ — design/project/PrintPurchaseOrder.dc.html · PDF: ./pdf · ใบสั่งซื้อไม่ใช่เอกสารทางภาษี (ไม่ลงบัญชี)
import { css, thaiDate } from '@innovera/ui';
import { api } from '../../../lib/api';
import { context, itemRows, loadDoc, pct, vatPct, type DocDetail } from '../../_lib/data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, ItemTable6, m, PartyBox, Sheet, Signatures, Totals } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบสั่งซื้อ' };

type Po = Omit<DocDetail, 'lines'> & { lines: (DocDetail['lines'][number] & { wht_type?: string | null })[] };

export default async function PrintPurchaseOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const [d, ctx, types] = await Promise.all([loadDoc(id, ['PO']) as Promise<Po>, context(), api<Record<string, { rate: string }>>('/v1/wht-types')]);
  const { doc, contact: c } = d;
  const rows = itemRows(d.lines);
  // เงื่อนไขการชำระเงิน: เครดิต (วัน) ของเอกสาร/ผู้ขาย · หัก ณ ที่จ่ายตามประเภทเงินได้ของบรรทัด (รับรู้ตอนจ่ายจริง)
  // TODO(backend) PrintPurchaseOrder.dc.html: ข้อความเงื่อนไขการชำระเงินยังไม่มีช่องในเอกสาร — ประกอบจากเครดิตและประเภทเงินได้
  const credit = doc.credit_days ?? c?.credit_days ?? null;
  const rates = [...new Set(d.lines.map((l) => (l.wht_type ? types[l.wht_type]?.rate : undefined)).filter((r): r is string => Boolean(r)).map((r) => pct(r)))];
  const terms = [
    credit !== null ? `เครดิต ${credit} วันหลังรับใบแจ้งหนี้/ใบกำกับภาษี` : null,
    rates.length ? `บริษัทจะหักภาษี ณ ที่จ่าย ${rates.map((r) => `${r}%`).join('/')} ตามกฎหมายและออกหนังสือรับรอง 50 ทวิ` : null,
    'กรุณาระบุเลขที่ใบสั่งซื้อนี้ในใบแจ้งหนี้ทุกฉบับ',
  ].filter(Boolean).join(' · ');
  const person = [c?.contact_person, c?.email].filter(Boolean).join(' ');
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบสั่งซื้อ" en="PURCHASE ORDER" badge={badgeOf(sp)} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="ผู้ขาย" c={c} address={doc.address ?? c?.address ?? '[ที่อยู่ผู้ขาย]'} nameSuffix={c ? ` · ${c.code}` : ''}
          taxLine={`เลขประจำตัวผู้เสียภาษีอากร ${c?.tax_id ?? ''}${person ? ` · ผู้ติดต่อ ${person}` : ''}`} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['อ้างอิง PR', d.ref?.doc_type === 'PR' ? (d.ref.doc_no ?? '') : ''], ['กำหนดส่งมอบ', doc.due_date ? thaiDate(doc.due_date) : '']]} />
      </div>
      <ItemTable6 rows={rows} fill={filler(180, 2, rows.length)} />
      <div style={css('display: flex; gap: 12px; align-items: stretch')}>
        <div style={css('flex: 1 1 auto; border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
          <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
          <div><span className="lbl">เงื่อนไขการชำระเงิน</span><br />{terms}</div>
          {/* TODO(backend) PrintPurchaseOrder.dc.html: "สถานที่ส่งมอบ … · ติดต่อ [หัวหน้าฝ่ายปฏิบัติการ]" — ยังไม่มีช่องสถานที่/ผู้ติดต่อส่งมอบในใบสั่งซื้อ · ใช้หมายเหตุของเอกสาร หรือที่อยู่บริษัท */}
          <div><span className="lbl">สถานที่ส่งมอบ</span><br />{doc.notes ?? ctx.profile?.address ?? '[ที่อยู่สำนักงาน]'}</div>
        </div>
        <Totals width={280} rows={[
          { label: 'รวมมูลค่า', value: m(doc.subtotal) },
          { label: 'หัก ส่วนลด', value: m(doc.discount) },
          { label: `ภาษีมูลค่าเพิ่ม${vatPct(d.lines) ? ` ${vatPct(d.lines)}%` : ''}`, value: m(doc.vat) },
          { label: 'จำนวนเงินรวมทั้งสิ้น', value: m(doc.grand_total), bold: true },
        ]} />
      </div>
      <Signatures cols={3} items={[['ผู้ขอซื้อ', DATE_BLANK], ['ผู้อนุมัติ', DATE_BLANK], ['ผู้ขายรับทราบ', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no, 'ใบสั่งซื้อไม่ใช่เอกสารทางภาษี']} />
    </Sheet>
  );
}
