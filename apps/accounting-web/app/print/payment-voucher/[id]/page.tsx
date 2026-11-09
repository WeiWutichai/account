// D7 แบบพิมพ์ใบสำคัญจ่าย (เอกสารภายใน) — design/project/PrintPaymentVoucher.dc.html · PDF: ./pdf
// ข้อมูลจาก GET /v1/documents/:id (PV: settlementsOut = บิลที่จ่าย · journal · cheques) + GET /v1/wht-certificates (50 ทวิ ของใบนี้)
import { css, money, thaiDate, thaiMonth } from '@innovera/ui';
import { add, context, getDoc, gt, loadDoc, pct, type DocDetail } from '../../_lib/data';
import { DATE_BLANK, filler, Footer, Header, InfoBox, m, PartyBox, Sheet, Signatures } from '../../_lib/parts';
import { certsBetween } from '../../_lib/wht';

export const metadata = { title: 'แบบพิมพ์ ใบสำคัญจ่าย' };

type Bill = Omit<DocDetail, 'doc' | 'lines'> & { doc: DocDetail['doc'] & { vendor_ref?: string | null }; lines: (DocDetail['lines'][number] & { wht_type?: string | null })[] };
type Pv = DocDetail & { doc: DocDetail['doc'] & { batch_ref?: string | null } };

// มาตราที่ยกเว้น VAT ตามประเภทเงินได้ของบรรทัด (CLAUDE.md: ค่าขนส่งในประเทศ ม.81(1)(ต) · ค่าเช่าอสังหาฯ ม.81(1)(ฑ))
const EXEMPT: Record<string, string> = { transport_domestic: 'ม.81(1)(ต)', rent: 'ม.81(1)(ฑ)' };
// TODO(Wei) PrintPaymentVoucher.dc.html: แถว 1 "ยกเว้น VAT ม.81(1)(ต)" แต่แถว 2 (ค่าขนส่งเหมือนกัน) "ยกเว้น VAT" — ใช้กติกาตามตัวอย่าง: อ้างมาตราครั้งแรกของแต่ละมาตราในใบ
const METHOD: Record<string, string> = { bulk_transfer: 'โอน (Bulk)', transfer: 'โอน', cheque: 'เช็ค', cash: 'เงินสด' };
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${thaiMonth(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4)) + 543}`;

export default async function PrintPaymentVoucher({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d, ctx] = await Promise.all([loadDoc(id, ['PV']) as Promise<Pv>, context()]);
  const { doc } = d;
  const live = d.settlementsOut.filter((s) => doc.status === 'voided' || !s.voided).sort((a, b) => a.doc_no.localeCompare(b.doc_no));
  const [bills, certs] = await Promise.all([Promise.all(live.map((s) => getDoc(s.id) as Promise<Bill | null>)), certsBetween(doc.issue_date, doc.issue_date)]);
  const mine = certs.filter((c) => c.payment_id === doc.id && !c.voided);
  const cited = new Set<string>();
  const rows = live.map((s, i) => {
    const b = bills[i];
    const desc = b?.lines.find((l) => l.line_type === 'item' && l.description)?.description ?? '';
    let vat = '';
    if (b && !gt(b.doc.vat, '0.00')) {
      const sec = b.lines.map((l) => EXEMPT[l.wht_type ?? '']).find(Boolean);
      vat = ` · ยกเว้น VAT${sec && !cited.has(sec) ? ` ${sec}` : ''}`;
      if (sec) cited.add(sec);
    }
    const ref = b?.doc.vendor_ref ? ` · ใบแจ้งหนี้ผู้ขาย ${b.doc.vendor_ref}` : '';
    return { s, owed: add(s.applied, s.wht), text: `${s.doc_no}${desc && desc !== s.doc_no ? ` ${desc}` : ''}${ref}${vat}` };
  });
  const acctName = d.journal.find((j) => j.account_code === doc.receive_account)?.name ?? '';
  const method = doc.reference ?? 'transfer';
  const chq = (d.cheques ?? []).find((c) => c.status !== 'cancelled');
  // "เข้าบัญชี [ธนาคาร] xxx-x-x1234-x" = บัญชีรับโอนของผู้ขาย (contact.bank_account) · TODO(Wei): fixtures มีแค่เลขที่บัญชี ไม่มีชื่อธนาคาร
  const to = d.contact?.bank_account ? ` เข้าบัญชี ${d.contact.bank_account}` : '';
  const how = chq ? `จ่ายเช็ค ${chq.bank} เลขที่ ${chq.cheque_no} ลงวันที่ ${thaiDate(chq.cheque_date)} จากบัญชี ${doc.receive_account ?? ''} ${acctName.replace(/^เงินฝากธนาคาร\s*/u, '')}`
    : method === 'cash' ? `จ่ายเงินสดจาก ${doc.receive_account ?? ''} ${acctName}` : `โอนจาก ${doc.receive_account ?? ''} ${acctName.replace(/^เงินฝากธนาคาร\s*/u, '')}${to}`;
  const certText = mine.map((c) => `หนังสือรับรอง 50 ทวิ เลขที่ ${c.cert_no} (ภ.ง.ด.${c.pnd}, ${pct(c.rate)}%)`).join(' · ');
  const dr = add('0.00', ...d.journal.map((j) => j.debit));
  const cr = add('0.00', ...d.journal.map((j) => j.credit));
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบสำคัญจ่าย" en="PAYMENT VOUCHER" badge="เอกสารภายใน" />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="จ่ายให้" c={d.contact} address={doc.address ?? d.contact?.address ?? '[ที่อยู่ผู้ขาย]'} nameSuffix={d.contact ? ` · ${d.contact.code}` : ''} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่จ่าย', thaiDate(doc.issue_date)], ['รอบจ่าย', doc.batch_ref ? longDate(doc.issue_date) : ''], ['วิธีจ่าย', METHOD[method] ?? method]]} />
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('width: 36px')}>ลำดับ</th><th style={css('text-align: left')}>รายการ</th><th className="n">ค้างจ่าย</th><th className="n">หัก ณ ที่จ่าย</th><th className="n">จ่ายจริง</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={r.s.id}><td style={css('text-align: center')}>{i + 1}</td><td>{r.text}</td><td className="n">{m(r.owed)}</td><td className="n">{m(r.s.wht)}</td><td className="n">{m(r.s.applied)}</td></tr>)}
          <tr><td style={{ height: filler(120, 2, rows.length) }}></td><td></td><td></td><td></td><td></td></tr>
          <tr style={css('font-weight: 700')}><td colSpan={2} style={css('text-align: right')}>รวม</td><td className="n">{m(add('0.00', ...rows.map((r) => r.owed)))}</td><td className="n">{m(add('0.00', ...rows.map((r) => r.s.wht)))}</td><td className="n">{m(add('0.00', ...rows.map((r) => r.s.applied)))}</td></tr>
        </tbody>
      </table>
      <div style={css('border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
        <div><span className="lbl">จำนวนเงินที่จ่าย (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
        <div><span className="lbl">รายละเอียดการจ่าย</span><br />{[how, certText].filter(Boolean).join(' · ')}</div>
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('text-align: left')}>การลงบัญชี</th><th style={css('text-align: left')}>ชื่อบัญชี</th><th className="n" style={css('width: 120px')}>เดบิต</th><th className="n" style={css('width: 120px')}>เครดิต</th></tr></thead>
        <tbody>
          {d.journal.map((j) => {
            const isCr = gt(j.credit, '0.00');
            return <tr key={j.line_no}><td>{j.account_code}</td><td style={isCr ? css('padding-left: 24px') : undefined}>{j.name}</td><td className="n">{money(j.debit, { blankZero: true })}</td><td className="n">{money(j.credit, { blankZero: true })}</td></tr>;
          })}
          <tr style={css('font-weight: 700')}><td colSpan={2} style={css('text-align: right')}>รวม</td><td className="n">{m(dr)}</td><td className="n">{m(cr)}</td></tr>
        </tbody>
      </table>
      {/* TODO(Wei): พิมพ์ใบสำคัญจ่ายที่ยังรออนุมัติ (ยังไม่มีเลขที่/ยังไม่ลงบัญชี) — แบบร่างไม่ได้กำหนดข้อความ "ร่าง" · ตอนนี้เลขที่/การลงบัญชีว่าง */}
      <Signatures cols={4} items={[['ผู้จัดทำ', DATE_BLANK], ['ผู้ตรวจสอบ', DATE_BLANK], ['ผู้อนุมัติ', DATE_BLANK], ['ผู้รับเงิน', DATE_BLANK]]} />
      <Footer parts={[doc.doc_no, 'แนบใบแจ้งหนี้ของผู้ขายและหลักฐานการโอน']} />
    </Sheet>
  );
}
