// D6 แบบพิมพ์ใบวางบิล — design/project/PrintBilling.dc.html · PDF: ./pdf
import { css, thaiDate } from '@innovera/ui';
import { context, creditDays, customerAddress, getDoc, loadDoc, vatPct, weekday } from '../../_lib/data';
import { badgeOf, DATE_BLANK, filler, Footer, Header, InfoBox, m, PartyBox, Sheet, Signatures } from '../../_lib/parts';

export const metadata = { title: 'แบบพิมพ์ ใบวางบิล' };
const BLANK = '________';
const TYPE_NAME: Record<string, string> = { IV: 'ใบแจ้งหนี้', DN: 'ใบเพิ่มหนี้' };

// TODO(Wei) PrintBilling.dc.html: "เครดิต 30 วัน" — ใบวางบิลไม่มีเครดิตของตัวเอง · ใช้เครดิตของลูกค้า (contact.credit_days) ถ้าไม่มีใช้ ครบกำหนด − วันที่ ของใบแจ้งหนี้ใบแรก
// TODO(Wei) PrintBilling.dc.html: "หัก ณ ที่จ่าย 3%" ในข้อความการชำระเงิน — ยังไม่มีอัตราที่คาดว่าจะถูกหักต่อลูกค้า/สินค้า · ใช้ 3% ตามแบบร่าง
const WHT_HINT = '3';

export default async function PrintBilling({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [d, ctx] = await Promise.all([loadDoc(id, ['BN']), context()]);
  const { doc } = d;
  const invs = await Promise.all(d.billing.map((b) => getDoc(b.id)));
  const credit = creditDays(doc, d.contact, invs[0]?.doc ?? null);
  const vp = vatPct(invs.flatMap((x) => x?.lines ?? []));
  return (
    <Sheet>
      <Header ctx={ctx} title="ใบวางบิล" en="BILLING NOTE" badge={badgeOf(sp)} />
      <div style={css('display: flex; gap: 12px')}>
        <PartyBox label="ลูกค้า" c={d.contact} address={customerAddress(d)} />
        <InfoBox rows={[['เลขที่', doc.doc_no ?? ''], ['วันที่', thaiDate(doc.issue_date)], ['นัดรับเงิน', doc.due_date ? thaiDate(doc.due_date) : ''], ['เครดิต', credit === null ? '' : `${credit} วัน`]]} />
      </div>
      <table style={css('width: 100%')}>
        <thead><tr style={css('background: #f4f4f4')}><th style={css('width: 36px')}>ลำดับ</th><th style={css('text-align: left')}>เลขที่เอกสาร</th><th>วันที่</th><th>ครบกำหนด</th><th style={css('text-align: left')}>อ้างอิง</th><th className="n" style={css('width: 110px')}>จำนวนเงิน</th></tr></thead>
        <tbody>
          {d.billing.map((b, i) => (
            <tr key={b.id}><td style={css('text-align: center')}>{i + 1}</td><td>{b.doc_no} {TYPE_NAME[invs[i]?.doc.doc_type ?? 'IV'] ?? ''}</td><td style={css('text-align: center')}>{thaiDate(b.issue_date)}</td><td style={css('text-align: center')}>{b.due_date ? thaiDate(b.due_date) : ''}</td><td>{invs[i]?.doc.reference ?? ''}</td><td className="n">{m(b.grand_total)}</td></tr>
          ))}
          <tr><td style={{ height: filler(300, 2, d.billing.length) }}></td><td></td><td></td><td></td><td></td><td></td></tr>
          <tr style={css('font-weight: 700')}><td colSpan={5} style={css('text-align: right')}>รวม {d.billing.length} ฉบับ เป็นเงินทั้งสิ้น</td><td className="n">{m(doc.grand_total)}</td></tr>
        </tbody>
      </table>
      <div style={css('border: 1px solid #393939; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px')}>
        <div><span className="lbl">จำนวนเงิน (ตัวอักษร)</span><br /><strong>({d.amountText})</strong></div>
        {/* TODO(backend): บัญชีธนาคารรับโอนของบริษัท (ธนาคาร เลขที่บัญชี) ยังไม่มีใน API */}
        <div><span className="lbl">การชำระเงิน</span><br />นัดรับเช็ค{doc.due_date ? `วัน${weekday(doc.due_date)}ที่ ${thaiDate(doc.due_date)}` : ''} หรือโอนเข้าบัญชี {BLANK} เลขที่ {BLANK} ชื่อบัญชี {ctx.name}<br />ค่าบริการมีภาษีมูลค่าเพิ่ม {vp}% · ใบกำกับภาษีจะออกให้เมื่อได้รับชำระ · หัก ณ ที่จ่าย {WHT_HINT}% กรุณาแนบหนังสือรับรอง 50 ทวิ</div>
      </div>
      <div className="lbl">ใบวางบิลไม่ใช่ใบเสร็จรับเงินและไม่ใช่ใบกำกับภาษี</div>
      <Signatures cols={2} items={[['ผู้วางบิล', DATE_BLANK], ['ผู้รับวางบิล', `${DATE_BLANK} · นัดรับเงินวันที่ ____/____/______`]]} />
      <Footer parts={[doc.doc_no, 'ไม่ลงบัญชี']} />
    </Sheet>
  );
}
