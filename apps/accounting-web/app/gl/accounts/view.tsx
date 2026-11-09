'use client';
import { Button, buttonStyle, css, money, S } from '@innovera/ui';
import { useMemo, useRef, useState } from 'react';

export interface AccountRow { code: string; name: string; type: string; category: string | null; binding: string | null; is_control: boolean; active: boolean; balance: string | null; has_activity: boolean }

const GROUPS: Record<string, string> = { '1': 'สินทรัพย์', '2': 'หนี้สิน', '3': 'ส่วนของเจ้าของ', '4': 'รายได้', '5': 'ค่าใช้จ่าย' };
const TD = 'padding: 0 12px';

function sum(xs: (string | null)[]): string {
  // รวมด้วยจำนวนเต็มสตางค์ (BigInt) — ห้าม float
  const cents = xs.reduce((a, x) => a + (x ? BigInt(x.replace('.', '')) : 0n), 0n);
  const neg = cents < 0n;
  const abs = (neg ? -cents : cents).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export function CoaView({ rows, periodLabel, year, period }: { rows: AccountRow[]; periodLabel: string; year: number; period: number }) {
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [collapseUnused, setCollapseUnused] = useState(false); // แบบร่าง: ไม่ติ๊ก
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const f = rows.filter((r) => (!q || r.code.includes(q) || r.name.includes(q)) && (!onlyActive || r.has_activity));
    return Object.entries(GROUPS).map(([k, title]) => ({ k, title, rows: f.filter((r) => r.code.startsWith(k)) }))
      .filter((g) => g.rows.length > 0 && !(collapseUnused && g.rows.every((r) => !r.has_activity)));
  }, [rows, q, onlyActive, collapseUnused]);

  async function upload(f: File) {
    setMsg('กำลังนำเข้า…');
    const res = await fetch(`/api/proxy/import?year=${year}`, { method: 'POST', headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: f });
    const r = (await res.json()) as { ok?: boolean; issues?: { sheet: string; row: number; message: string }[]; error?: string };
    setMsg(r.ok ? 'นำเข้าแล้ว — โหลดหน้าใหม่เพื่อดูผล' : r.error ?? (r.issues ?? []).map((i) => `${i.sheet} แถว ${i.row}: ${i.message}`).join(' · '));
  }

  return (
    <>
      <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
        <h1 style={css(S.h1)}>ผังบัญชี</h1>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button size={36} onClick={() => file.current?.click()}>นำเข้า Excel</Button>
          <a href={`/api/proxy/accounts/export?year=${year}&period=${period}`} style={buttonStyle('secondary', 36, false, 'border-left: 0; text-decoration: none')}>ส่งออก</a>
          {/* TODO(Wei): แบบร่างไม่มีฟอร์มเพิ่มบัญชี — รอแบบร่าง (ใช้นำเข้า Excel ไปก่อน) */}
          <Button kind="primary" size={36} onClick={() => setMsg('ฟอร์มเพิ่มบัญชียังไม่มีในแบบร่าง — ใช้ "นำเข้า Excel" ชีต ผังบัญชี ไปก่อน')}>เพิ่มบัญชี</Button>
        </div>
      </div>
      <div style={css('display: flex; gap: 8px; align-items: center; flex-wrap: wrap')}>
        <label style={css('display: flex; flex: 1 1 280px; max-width: 400px; height: 40px; background: #f4f4f4; border-bottom: 1px solid #8d8d8d; align-items: center; padding: 0 16px')}>
          <span style={css('position: absolute; width: 1px; height: 1px; overflow: hidden')}>ค้นหา</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัสหรือชื่อบัญชี" style={css('flex: 1; border: 0; background: transparent; font-family: inherit; font-size: 14px; outline: none')} />
        </label>
        <label style={css('display: flex; gap: 8px; align-items: center; font-size: 14px')}><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> แสดงเฉพาะที่มีรายการ</label>
        <label style={css('display: flex; gap: 8px; align-items: center; font-size: 14px')}><input type="checkbox" checked={collapseUnused} onChange={(e) => setCollapseUnused(e.target.checked)} /> ย่อหมวดที่ไม่ใช้</label>
      </div>
      {msg && <div role="status" style={css('padding: 12px 16px; border: 1px solid #e0e0e0; border-left: 3px solid #0f62fe; font-size: 14px')}>{msg}</div>}
      <div style={css(S.tableBox)}>
        <table style={css('width: 100%; min-width: 900px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
          <thead><tr style={css(S.theadRow)}>
            <th style={css(S.thFirst)}>รหัส</th><th style={css(S.th)}>ชื่อบัญชี</th><th style={css(S.th)}>ประเภท</th><th style={css(S.th)}>คุม / ผูกกับ</th>
            <th style={css(`${S.th}; text-align: right`)}>ยอดคงเหลือ {periodLabel}</th><th style={css(S.th)}>สถานะ</th>
          </tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g.k} style={css('border-top: 1px solid #e0e0e0; background: #f4f4f4')}>
                <td style={css('height: 40px; padding: 0 12px; font-weight: 600')}>{g.k}</td>
                <td style={css('padding: 0 12px; font-weight: 600')}>{g.title}</td>
                <td colSpan={2} />
                <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600')}>{money(sum(g.rows.map((r) => r.balance)), { paren: true })}</td>
                <td />
              </tr>,
              ...g.rows.map((r) => {
                const grey = r.active ? '' : '; color: #525252';
                const status = !r.active ? (r.has_activity ? 'ปิดใช้ · มีประวัติ ลบไม่ได้' : 'ปิดใช้') : r.is_control ? 'ใช้งาน · ล็อกประเภท' : 'ใช้งาน';
                return (
                  <tr key={r.code} style={css(S.tr)}>
                    <td style={css(`height: 40px; padding: 0 12px 0 28px${grey}`)}>{r.code}</td>
                    <td style={css(`${TD}${grey}`)}>{r.name}</td>
                    <td style={css(`${TD}${grey}`)}>{r.category ?? ''}</td>
                    <td style={css(`${TD}; color: #525252`)}>{r.binding ?? '—'}</td>
                    <td style={css(`${S.num}${grey}`)}>{money(r.balance, { paren: true })}</td>
                    <td style={css(TD)}><span style={css('font-size: 13px; color: #525252')}>{status}</span></td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}
