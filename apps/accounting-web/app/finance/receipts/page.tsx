// F2 รับชำระ — รายการใบรับชำระ (RV)
// TODO(Wei): ไม่มีแบบร่างหน้ารายการ RV — ใช้โครงตารางเดียวกับ ScreenDocList.dc.html (หัวตาราง/แถว/ปุ่ม) ชั่วคราว · ใบรับชำระเปิดดูตาม ScreenReceipt.dc.html
import { ButtonLink, css, href, money, S, Tag, thaiDate, TopBar } from '@innovera/ui';
import { Shell } from '../../lib/shell';
import { listDocs } from '../_shared/data';
import { cents, fromCents } from '../_shared/num';

export default async function ReceiptListPage() {
  const rows = await listDocs({ type: 'RV' });
  return (
    <Shell active="receipt">
      <TopBar crumb="การเงิน / รับชำระ" />
      <div style={css(S.content)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap')}>
          <div><h1 style={css(S.h1)}>รับชำระ</h1><span style={css(S.sub)}>ตัดยอดหลายใบในครั้งเดียว · รองรับถูกหัก ณ ที่จ่าย ค่าธรรมเนียม และส่วนต่าง</span></div>
          <ButtonLink href={`${href('receipt')}/new`} kind="primary">รับชำระใหม่</ButtonLink>
        </div>
        <section style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 860px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>เลขที่</th><th style={css(S.th)}>วันที่</th><th style={css(S.th)}>ลูกค้า</th>
              <th style={css(`${S.th}; text-align: right`)}>ตัดยอดรวม</th><th style={css(`${S.th}; text-align: right`)}>ถูกหัก ณ ที่จ่าย</th><th style={css(`${S.th}; text-align: right`)}>เงินเข้าบัญชีจริง</th><th style={css(S.th)}>สถานะ</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={css(S.tr)}>
                  <td style={css('height: 40px; padding: 0 12px')}><a href={`${href('receipt')}/${r.id}`} style={css('text-decoration: none; font-weight: 500')}>{r.doc_no}</a></td>
                  <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.issue_date)}</td>
                  <td style={css(S.td)}>{r.contact_code} · {r.contact_name}</td>
                  <td style={css(S.num)}>{money(fromCents(cents(r.subtotal) - cents(r.wht)))}</td>
                  <td style={css(S.num)}>{money(r.wht)}</td>
                  <td style={css(S.num)}>{money(r.grand_total)}</td>
                  <td style={css(S.td)}>{r.status === 'voided' ? <Tag kind="error">ยกเลิกแล้ว</Tag> : <Tag kind="success">ลงบัญชีแล้ว</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}
