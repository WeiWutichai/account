// F1 ใบวางบิล — รายการใบวางบิล (BN)
// TODO(Wei): ไม่มีแบบร่างหน้ารายการใบวางบิล — ใช้โครงตารางเดียวกับ ScreenDocList.dc.html ชั่วคราว · ใบวางบิลเปิดดูตาม ScreenBilling.dc.html
import { ButtonLink, css, href, money, S, Tag, thaiDate, TopBar } from '@innovera/ui';
import { Shell } from '../../lib/shell';
import { billingSummaries, detailCache, listDocs } from '../_shared/data';
import { cents } from '../_shared/num';

export default async function BillingListPage() {
  const [bns, inv] = await Promise.all([listDocs({ type: 'BN' }), listDocs({ type: 'IV,DN', status: 'posted' })]);
  const sums = await billingSummaries(bns, new Map(inv.map((x) => [x.id, x])), detailCache());
  return (
    <Shell active="bn">
      <TopBar crumb="การเงิน / ใบวางบิล" />
      <div style={css(S.content)}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap')}>
          <div><h1 style={css(S.h1)}>ใบวางบิล</h1><span style={css(S.sub)}>ใบวางบิลไม่ลงบัญชี · เมื่อรับเงินจะสร้างใบเสร็จอ้างอิงเลขนี้</span></div>
          <ButtonLink href={`${href('bn')}/new`} kind="primary">วางบิลลูกค้า (BN)</ButtonLink>
        </div>
        <section style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 860px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>เลขที่</th><th style={css(S.th)}>วันที่วางบิล</th><th style={css(S.th)}>วันนัดรับเงิน</th><th style={css(S.th)}>ลูกค้า</th>
              <th style={css(`${S.th}; text-align: right`)}>ยอดวางบิล</th><th style={css(`${S.th}; text-align: right`)}>ค้างชำระ</th><th style={css(S.th)}>สถานะ</th>
            </tr></thead>
            <tbody>
              {sums.map(({ row: r, outstanding, received }) => (
                <tr key={r.id} style={css(S.tr)}>
                  <td style={css('height: 40px; padding: 0 12px')}><a href={`${href('bn')}/${r.id}`} style={css('text-decoration: none; font-weight: 500')}>{r.doc_no}</a></td>
                  <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(r.issue_date)}</td>
                  <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{r.due_date ? thaiDate(r.due_date) : '—'}</td>
                  <td style={css(S.td)}>{r.contact_code} · {r.contact_name}</td>
                  <td style={css(S.num)}>{money(r.grand_total)}</td>
                  <td style={css(S.num)}>{money(outstanding)}</td>
                  <td style={css(S.td)}>{r.status === 'voided' ? <Tag kind="error">ยกเลิกแล้ว</Tag> : cents(outstanding) === 0n ? <Tag kind="success">รับแล้ว</Tag> : cents(received) > 0n ? <Tag kind="warning">รับบางส่วน</Tag> : <Tag kind="info">ยังไม่ได้รับ</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}
