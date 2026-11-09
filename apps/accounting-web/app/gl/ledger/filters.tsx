'use client';
import { css, parseThaiDate, S } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LedgerFilters({ accounts, account, range, from, to }: { accounts: { code: string; name: string }[]; account: string; range: string; from: string; to: string }) {
  const router = useRouter();
  const [acc, setAcc] = useState(`${account} ${accounts.find((a) => a.code === account)?.name ?? ''}`);
  const [rng, setRng] = useState(range);
  const go = (a = acc, r = rng) => {
    const code = a.slice(0, 7);
    const [f, t] = r.split('–').map((x) => parseThaiDate(x.trim()));
    router.push(`/gl/ledger?account=${code}&from=${f ?? from}&to=${t ?? to}`);
  };
  return (
    <div style={css('display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px 24px')}>
      <label style={css(`grid-column: span 2; ${S.label}`)}>บัญชี
        <input list="acc-list" value={acc} onChange={(e) => setAcc(e.target.value)} onBlur={() => go()} style={css(S.input)} />
        <datalist id="acc-list">{accounts.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
      </label>
      <label style={css(S.label)}>ช่วงวันที่<input value={rng} onChange={(e) => setRng(e.target.value)} onBlur={() => go()} style={css(`${S.input}; font-variant-numeric: tabular-nums`)} /></label>
      {/* TODO(M4): กรองตามคู่ค้า/มิติ — ต้องมีเอกสารที่ผูกคู่ค้า/มิติก่อน */}
      <label style={css(S.label)}>คู่ค้า<select style={css(S.input)}><option>ทั้งหมด</option></select></label>
      <label style={css(S.label)}>มิติ<select style={css(S.input)}><option>ทั้งหมด</option></select></label>
    </div>
  );
}
