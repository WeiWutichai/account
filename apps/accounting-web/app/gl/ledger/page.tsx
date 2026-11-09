// B4 บัญชีแยกประเภท — design/project/ScreenLedger.dc.html
import { buttonStyle, css, money, S, shortDate, thaiDate, TopBar } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { LedgerFilters } from './filters';

interface Row { date: string; journal_no: string; book: string; description: string | null; contact: string | null; debit: string; credit: string; balance: string; source_document_id: string | null }
interface Ledger { opening: string; rows: Row[]; total_debit: string; total_credit: string; closing: string }
interface Account { code: string; name: string; is_control: boolean }

const pad = (n: number) => String(n).padStart(2, '0');

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { year, period } = await currentPeriod();
  const y = year - 543;
  const last = new Date(Date.UTC(y, period, 0)).getUTCDate();
  const from = sp.from ?? `${y}-${pad(period)}-01`;
  const to = sp.to ?? `${y}-${pad(period)}-${pad(last)}`;
  const accounts = await api<Account[]>(`/v1/accounts?year=${year}&period=${period}`);
  const account = sp.account ?? '1130100';
  const acc = accounts.find((a) => a.code === account);
  const l = await api<Ledger>(`/v1/ledger?account=${account}&from=${from}&to=${to}`);
  return (
    <Shell active="ledger">
      <TopBar crumb="บัญชี / แยกประเภท" right={<a href={`/api/proxy/ledger/export?account=${account}&from=${from}&to=${to}`} style={buttonStyle('secondary', 32, false, 'text-decoration: none')}>Export Excel</a>} />
      <div style={css(S.content)}>
        <h1 style={css(S.h1)}>บัญชีแยกประเภท</h1>
        <LedgerFilters accounts={accounts.map((a) => ({ code: a.code, name: a.name }))} account={account} range={`${thaiDate(from)} – ${thaiDate(to)}`} from={from} to={to} />
        <div style={css(S.tableBox)}>
          <table style={css('width: 100%; min-width: 980px; border-collapse: collapse; font-size: 14px; line-height: 18px')}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css('height: 32px; padding: 0 12px; font-weight: 400')}>วันที่</th><th style={css(S.th)}>เอกสาร</th><th style={css(S.th)}>สมุด</th><th style={css(S.th)}>คำอธิบาย</th><th style={css(S.th)}>คู่ค้า</th>
              <th style={css(`${S.th}; text-align: right`)}>เดบิต</th><th style={css(`${S.th}; text-align: right`)}>เครดิต</th><th style={css(`${S.th}; text-align: right`)}>คงเหลือ</th>
            </tr></thead>
            <tbody>
              <tr style={css('border-top: 1px solid #e0e0e0; background: #f4f4f4')}><td style={css('height: 32px; padding: 0 12px')} colSpan={7}>ยอดยกมา {thaiDate(from)}</td><td style={css(S.num)}>{money(l.opening)}</td></tr>
              {l.rows.map((r, i) => (
                <tr key={`${r.journal_no}-${i}`} style={css(S.tr)}>
                  <td style={css('height: 32px; padding: 0 12px')}>{shortDate(r.date)}</td>
                  <td style={css(S.td)}><a href={`/gl/journal?no=${encodeURIComponent(r.journal_no)}`} style={css('text-decoration: none')}>{r.journal_no}</a></td>
                  <td style={css(S.td)}>{r.book}</td>
                  <td style={css(S.td)}>{r.description ?? ''}</td>
                  <td style={css(S.td)}>{r.contact ?? ''}</td>
                  <td style={css(r.debit === '0.00' ? S.td : S.num)}>{money(r.debit, { blankZero: true })}</td>
                  <td style={css(r.credit === '0.00' ? S.td : S.num)}>{money(r.credit, { blankZero: true })}</td>
                  <td style={css(S.num)}>{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={css(S.tfoot)}>
              <td colSpan={5} style={css('height: 40px; padding: 0 12px')}>รวมงวด · ยอดยกไป</td>
              <td style={css(S.num)}>{money(l.total_debit)}</td><td style={css(S.num)}>{money(l.total_credit)}</td><td style={css(S.num)}>{money(l.closing)}</td>
            </tr></tfoot>
          </table>
        </div>
        <p style={css(S.note)}>คลิกเลขเอกสารเพื่อเปิดต้นทาง{acc?.is_control ? ' · ยอดคงเหลือตรงกับอายุลูกหนี้ ✓' : ''}</p>
      </div>
    </Shell>
  );
}
