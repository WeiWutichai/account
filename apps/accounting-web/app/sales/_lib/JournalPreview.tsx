// "ตัวอย่างการลงบัญชี" (ScreenInvoice.dc.html / ScreenCreditNote.dc.html) — คำนวณด้วย Posting Engine จริง (POST /v1/rules/preview)
// ด้วยยอดชุดเดียวกับที่ approveDocument ส่งให้ engine · เอกสารที่ลงบัญชีแล้วแสดง journal จริง
import { css, money } from '@innovera/ui';
import { useEffect, useState } from 'react';
import { call } from './client.ts';
import type { DocDetail, Totals } from './doc.ts';
import { toCents } from './num.ts';

export type Tuple = [string, string, string];
export interface PreviewSource {
  rule: string; docType: string; totals: Totals | null; lineAccounts: (string | null)[]; deposit?: string; receiveAccount?: string | null; grandTotal?: string;
}

/** บรรทัดบัญชีจาก engine (หรือ journal จริงถ้าลงบัญชีแล้ว) · err = ข้อความจาก engine เช่น สูตรไม่ดุล */
export function usePreview(source: PreviewSource, posted: DocDetail['journal'] | null): { rows: Tuple[]; err: string | null } {
  const [lines, setLines] = useState<Tuple[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(source);

  useEffect(() => {
    if (posted?.length) return;
    const t = source.totals;
    if (!t || !source.rule) { setLines([]); return; }
    const timer = setTimeout(() => {
      const input = {
        docType: source.docType,
        amounts: { grand_total: source.grandTotal ?? t.grandTotal, net: t.net, vat: t.vat, discount: t.discount, subtotal: t.subtotal, deposit: source.deposit ?? '0.00' },
        lines: t.lines.map((l, i) => ({ amounts: { amount: l.amount }, ...(source.lineAccounts[i] ? { account: source.lineAccounts[i] } : {}) })),
        contact: { arAccount: '1130100' },
        accounts: source.receiveAccount ? { cash: source.receiveAccount } : {},
      };
      void call<{ lines: Tuple[] }>('rules/preview', 'POST', { code: source.rule, input }).then((r) => {
        if (r.ok) { setLines(r.data.lines); setErr(null); } else { setLines([]); setErr(r.error); }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [key, posted]);

  const rows: Tuple[] = posted?.length
    ? posted.map((j) => (toCents(j.debit) !== 0n ? ['Dr', j.account_code, j.debit] : ['Cr', j.account_code, j.credit]))
    : lines;
  return { rows, err };
}

export function JournalPreview({ title, note, source, posted, names, amountWidth = '120px' }: {
  title: string; note: string; source: PreviewSource; posted: DocDetail['journal'] | null; names: Record<string, string>; amountWidth?: string;
}) {
  const { rows, err } = usePreview(source, posted);

  return (
    <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0; max-width: 560px')}>
      <div style={css('display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-size: 15px; font-weight: 600')}>{title}</strong><span style={css('font-size: 13px; color: #525252')}>{note}</span></div>
      <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}>
        <tbody>
          {rows.map(([side, acc, amt], i) => (
            <tr key={i} style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
              <td style={css(side === 'Dr' ? 'height: 32px; padding: 0 16px' : 'height: 32px; padding: 0 16px 0 32px')}>{side} {acc} {names[acc] ?? ''}</td>
              {side === 'Dr'
                ? <><td style={css(`width: ${amountWidth}; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums`)}>{money(amt)}</td><td style={css(`width: ${amountWidth}; text-align: right; padding: 0 16px`)}></td></>
                : <><td style={css(`width: ${amountWidth}`)}></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(amt)}</td></>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={3} style={css('height: 32px; padding: 0 16px; color: #525252; font-size: 13px')}>{err ?? '—'}</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
