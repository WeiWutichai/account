'use client';
// "ตัวอย่างการลงบัญชี" ฝั่งซื้อ (ScreenPurchaseBill / ScreenExpense / ScreenPurchaseCreditNote.dc.html) — Posting Engine จริง (POST /v1/rules/preview)
// ด้วยชุดยอดเดียวกับที่ approvePurchase ส่งให้ engine · เอกสารที่ลงบัญชีแล้วแสดง journal จริง
import { css, money } from '@innovera/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { call } from '../../sales/_lib/client.ts';
import { toCents } from '../../sales/_lib/num.ts';
import type { JournalRow } from './types.ts';

type Tuple = [string, string, string];
export interface PSource { rule: string; docType: string; amounts: Record<string, string> | null; lines: { amount: string; account: string | null }[]; cash?: string | null }

export function PJournal({ note, source, posted, names, suffixCr, footer, extra = '' }: {
  note: string; source: PSource; posted: JournalRow[] | null; names: Record<string, string>; suffixCr?: string; footer?: ReactNode; extra?: string;
}) {
  const [lines, setLines] = useState<Tuple[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(source);

  useEffect(() => {
    if (posted?.length) return;
    if (!source.amounts || !source.rule || !source.lines.length) { setLines([]); return; }
    const timer = setTimeout(() => {
      const input = {
        docType: source.docType, amounts: source.amounts,
        lines: source.lines.map((l) => ({ amounts: { amount: l.amount }, ...(l.account ? { account: l.account } : {}) })),
        contact: { apAccount: '2110100' }, accounts: source.cash ? { cash: source.cash } : {},
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
  return (
    <section style={css(`background: #f4f4f4; border: 1px solid #e0e0e0${extra ? `; ${extra}` : '; max-width: 560px'}`)}>
      <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่างการลงบัญชี</strong><span style={css('font-size: 13px; color: #525252')}>{note}</span></div>
      <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}>
        <tbody>
          {rows.map(([side, acc, amt], i) => (
            <tr key={i} style={i ? css('border-top: 1px solid #e0e0e0') : undefined}>
              <td style={css(side === 'Dr' ? 'height: 32px; padding: 0 16px' : 'height: 32px; padding: 0 16px 0 32px')}>{side} {acc} {names[acc] ?? ''}{side === 'Cr' && suffixCr ? ` ${suffixCr}` : ''}</td>
              {side === 'Dr'
                ? <><td style={css('width: 110px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(amt)}</td><td style={css('width: 110px')}></td></>
                : <><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(amt)}</td></>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={3} style={css('height: 32px; padding: 0 16px; color: #525252; font-size: 13px')}>{err ?? '—'}</td></tr>}
        </tbody>
      </table>
      {footer}
    </section>
  );
}
