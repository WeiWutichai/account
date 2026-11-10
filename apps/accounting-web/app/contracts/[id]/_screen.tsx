'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// รายละเอียดสัญญา · API: POST /v1/contracts/billing-run {contractId} · POST /v1/contracts/usage · POST /v1/contract-lines/:id/milestone · POST /v1/contracts/:id/cancel
// ใบแจ้งหนี้จากรอบบิลเป็น "ร่าง" — ผู้ใช้ตรวจและอนุมัติที่หน้าใบแจ้งหนี้ปกติ (/sales/invoices/[id]) · ตารางรับรู้เกิดเมื่ออนุมัติใบแจ้งหนี้ของรายการที่รับรู้ตามช่วงเวลา
import { Button, css, href, money, S, Tag, thaiDate } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { call } from '../../sales/_lib/client';
import { Msg } from '../../sales/_lib/ui';
import { CreatedDrafts } from '../_screen';
import { ContractStatus, CYCLE_LABEL, DocStatus, KIND_LABEL, RECOG_LABEL, ST, thaiYm, type ContractDetail } from '../_lib';

type M = { kind: 'ok' | 'err'; text: string } | null;
interface Created { id: string; contract: string; periodStart: string; periodEnd: string; subtotal: string; vat: string; grandTotal: string }

/** เงินเป็นสตางค์ (BigInt) */
const c = (v: string): bigint => { const neg = v.startsWith('-'); const [i = '0', f = ''] = (neg ? v.slice(1) : v).split('.'); const x = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2)); return neg ? -x : x; };
const s = (x: bigint): string => { const neg = x < 0n; const a = neg ? -x : x; return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`; };

export function ContractDetailScreen({ d, today, accountNames }: { d: ContractDetail; today: string; accountNames: Record<string, string> }) {
  const router = useRouter();
  const k = d.contract;
  const cancelled = k.status === 'cancelled';
  const [msg, setMsg] = useState<M>(null);
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(today);
  const [created, setCreated] = useState<Created[] | null>(null);
  const [ms, setMs] = useState<Record<string, string>>({});
  const usageLines = d.lines.filter((l) => l.kind === 'usage');
  const [u, setU] = useState({ lineNo: usageLines[0]?.line_no ?? 0, usageDate: today, qty: '', externalRef: '' });
  const [cancel, setCancel] = useState({ open: false, date: today, reason: '' });

  async function act<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, ok: (data: T) => string) {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return false; }
    setMsg({ kind: 'ok', text: ok(r.data) });
    router.refresh();
    return true;
  }
  const billing = () => act(() => call<{ asOf: string; created: Created[] }>('contracts/billing-run', 'POST', { asOf, contractId: k.id }), (x) => {
    setCreated(x.created);
    return x.created.length ? `สร้างใบแจ้งหนี้ร่าง ${x.created.length} ใบ — เปิดแต่ละใบเพื่อตรวจและอนุมัติ` : `ไม่มีรอบบิลที่ถึงกำหนด ณ ${thaiDate(x.asOf)}`;
  });
  const usage = () => act(() => call<{ id: string; created: boolean }>('contracts/usage', 'POST', { contractCode: k.code, lineNo: u.lineNo, usageDate: u.usageDate, qty: u.qty.replace(/,/gu, ''),
    ...(u.externalRef.trim() ? { externalSource: 'manual', externalRef: u.externalRef.trim() } : {}) }), (x) => (x.created ? 'บันทึกยอดใช้งานแล้ว — ออกบิลในรอบบิลถัดไป' : 'มียอดใช้งานอ้างอิงนี้อยู่แล้ว (ไม่บันทึกซ้ำ)')).then((ok) => { if (ok) setU({ ...u, qty: '', externalRef: '' }); });
  const milestone = (lineId: string) => act(() => call('contract-lines/' + lineId + '/milestone', 'POST', { date: ms[lineId] ?? today }), () => 'บันทึกงานเสร็จแล้ว — ใบแจ้งหนี้ออกในรอบบิลถัดไป (หรือกดรันรอบบิล)');
  const doCancel = () => act(() => call(`contracts/${k.id}/cancel`, 'POST', { date: cancel.date, reason: cancel.reason }), () => 'ยกเลิกสัญญาแล้ว — ใบแจ้งหนี้ที่ออกแล้วไม่เปลี่ยน').then((ok) => { if (ok) setCancel({ ...cancel, open: false }); });

  // ตารางรับรู้ต่อรายการ: scheduleLines (API ใหม่) · ไม่มี = แสดงรวมรายงวด
  const byLine = new Map<string, { period: string; amount: string; recognized: string }[]>();
  for (const r of d.scheduleLines ?? []) byLine.set(r.contract_line_id, [...(byLine.get(r.contract_line_id) ?? []), r]);
  const total = (rows: { amount: string; recognized: string }[]) => {
    const a = rows.reduce((t, r) => t + c(r.amount), 0n);
    const rec = rows.reduce((t, r) => t + c(r.recognized), 0n);
    return { amount: s(a), recognized: s(rec), pending: s(a - rec) };
  };
  const all = total(d.schedule);

  return (
    <>
      <section aria-label="ข้อมูลสัญญา" style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
        <div><span style={css(ST.cardLabel)}>สถานะ</span><div><ContractStatus status={k.status} />{k.cancelled_on ? <span style={css('font-size: 13px; color: #525252')}> ให้บริการถึง {thaiDate(k.cancelled_on)}</span> : null}</div></div>
        <div><span style={css(ST.cardLabel)}>ช่วงสัญญา</span><div style={css('font-variant-numeric: tabular-nums')}>{thaiDate(k.start_date)} – {thaiDate(k.end_date)}</div></div>
        <div><span style={css(ST.cardLabel)}>รอบบิล</span><div>{CYCLE_LABEL[k.billing_cycle]}{k.auto_renew ? ' · ต่ออายุอัตโนมัติ' : ''}</div></div>
        <div><span style={css(ST.cardLabel)}>ตารางรับรู้ทั้งหมด</span><div style={css('font-variant-numeric: tabular-nums')}>{money(all.amount)}</div></div>
        <div><span style={css(ST.cardLabel)}>รับรู้แล้ว / รอรับรู้</span><div style={css('font-variant-numeric: tabular-nums')}>{money(all.recognized)} / {money(all.pending)}</div></div>
        {k.notes && <div><span style={css(ST.cardLabel)}>หมายเหตุ</span><div>{k.notes}</div></div>}
      </section>
      <Msg msg={msg} />

      <section aria-labelledby="h-bill" style={css(ST.box)}>
        <h2 id="h-bill" style={css(ST.h2)}>รอบบิลของสัญญานี้</h2>
        <div style={css('display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap')}>
          <label style={css(ST.label)}>ออกบิลถึงวันที่<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={css(`${ST.input}; height: 36px`)} /></label>
          <Button kind="primary" size={36} disabled={busy || !asOf} onClick={() => void billing()}>รันรอบบิล</Button>
          <span style={css('font-size: 13px; color: #525252')}>สร้างใบแจ้งหนี้ “ร่าง” ทุกรอบที่เริ่มไม่เกินวันที่นี้และยังไม่มีใบ · ไม่ลงบัญชีเอง</span>
        </div>
        {created && created.length > 0 && <CreatedDrafts rows={created} />}
      </section>

      <section aria-labelledby="h-lines" style={css('display: flex; flex-direction: column; gap: 12px')}>
        <h2 id="h-lines" style={css(ST.h2)}>รายการในสัญญา</h2>
        <div style={css(S.tableBox)}>
          <table style={css(`${S.table}; min-width: 1100px`)}>
            <thead><tr style={css(S.theadRow)}>
              <th style={css(S.thFirst)}>#</th><th style={css(S.th)}>ประเภท</th><th style={css(S.th)}>รายละเอียด</th><th style={css(S.th)}>วิธีรับรู้</th><th style={css(`${S.th}; text-align: right`)}>ยอด</th>
              <th style={css(S.th)}>VAT</th><th style={css(S.th)}>บัญชีรายได้</th><th style={css(S.th)}>ช่วง</th><th style={css(S.th)}>งานเสร็จ</th>
            </tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.id} style={css(S.tr)}>
                <td style={css('height: 44px; padding: 0 12px; color: #525252')}>{l.line_no}</td>
                <td style={css(S.td)}>{KIND_LABEL[l.kind]}</td>
                <td style={css(S.td)}>{l.description}{l.product_code ? <span style={css('font-size: 13px; color: #525252')}> · {l.product_code}</span> : null}</td>
                <td style={css(S.td)}>{RECOG_LABEL[l.recognition]}</td>
                <td style={css(S.num)}>{l.kind === 'usage' ? `${l.unit_price ?? ''} / ${l.usage_unit ?? 'หน่วย'}` : money(l.amount)}</td>
                <td style={css(S.td)}>{l.vat ? '7%' : 'ไม่มี'}</td>
                <td style={css(S.td)}>{l.revenue_account ? `${l.revenue_account} ${accountNames[l.revenue_account] ?? ''}` : 'ตามสินค้า/สูตร'}</td>
                <td style={css(`${S.td}; font-variant-numeric: tabular-nums; font-size: 13px`)}>{l.start_date || l.end_date ? `${l.start_date ? thaiDate(l.start_date) : '…'} – ${l.end_date ? thaiDate(l.end_date) : '…'}` : 'ตามสัญญา'}</td>
                <td style={css(S.td)}>{l.recognition !== 'milestone' ? <span style={css('color: #a8a8a8')}>—</span> : l.milestone_done_on ? <Tag kind="success">{`เสร็จ ${thaiDate(l.milestone_done_on)}`}</Tag> : (
                  <span style={css('display: inline-flex; gap: 6px; align-items: center')}>
                    <input type="date" aria-label={`วันที่งานเสร็จ บรรทัด ${l.line_no}`} value={ms[l.id] ?? today} onChange={(e) => setMs({ ...ms, [l.id]: e.target.value })} style={css(`${ST.cell}; width: 140px`)} />
                    <Button kind="secondary" size={32} disabled={busy || cancelled} onClick={() => void milestone(l.id)}>บันทึกงานเสร็จ</Button>
                  </span>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {usageLines.length > 0 && (
        <section aria-labelledby="h-usage" style={css(ST.box)}>
          <h2 id="h-usage" style={css(ST.h2)}>ยอดใช้งาน (usage)</h2>
          <div style={css('display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap')}>
            <label style={css(ST.label)}>รายการ<select value={u.lineNo} onChange={(e) => setU({ ...u, lineNo: Number(e.target.value) })} style={css(`${ST.input}; height: 36px`)}>
              {usageLines.map((l) => <option key={l.id} value={l.line_no}>{l.line_no}. {l.description}</option>)}</select></label>
            <label style={css(ST.label)}>วันที่ใช้งาน<input type="date" value={u.usageDate} onChange={(e) => setU({ ...u, usageDate: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
            <label style={css(ST.label)}>จำนวน<input inputMode="decimal" value={u.qty} onChange={(e) => setU({ ...u, qty: e.target.value })} style={css(`${ST.input}; height: 36px; width: 120px; text-align: right`)} /></label>
            <label style={css(ST.label)}>เลขอ้างอิง (ถ้ามี · กันบันทึกซ้ำ)<input value={u.externalRef} onChange={(e) => setU({ ...u, externalRef: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
            <Button kind="primary" size={36} disabled={busy || !u.qty.trim() || cancelled} onClick={() => void usage()}>บันทึกยอดใช้งาน</Button>
          </div>
          <table style={css(S.table)}>
            <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>วันที่</th><th style={css(S.th)}>รายการ</th><th style={css(`${S.th}; text-align: right`)}>จำนวน</th><th style={css(S.th)}>อ้างอิง</th><th style={css(S.th)}>ออกบิล</th></tr></thead>
            <tbody>
              {d.usage.length === 0 && <tr style={css(S.tr)}><td colSpan={5} style={css('height: 36px; padding: 0 12px; color: #525252')}>ยังไม่มียอดใช้งาน</td></tr>}
              {d.usage.map((x) => (
                <tr key={x.id} style={css(S.tr)}>
                  <td style={css('height: 36px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{thaiDate(x.usage_date)}</td>
                  <td style={css(S.td)}>{d.lines.find((l) => l.id === x.contract_line_id)?.description ?? ''}</td>
                  <td style={css(S.num)}>{x.qty}</td>
                  <td style={css(S.td)}>{x.external_ref ? `${x.external_source ?? ''} ${x.external_ref}` : '—'}</td>
                  <td style={css(S.td)}>{x.document_id ? <a href={`${href('invoice')}/${x.document_id}`} style={css('text-decoration: none')}>ออกบิลแล้ว</a> : <Tag kind="warning">รอรอบบิล</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="h-iv" style={css('display: flex; flex-direction: column; gap: 12px')}>
        <h2 id="h-iv" style={css(ST.h2)}>ใบแจ้งหนี้จากสัญญา ({d.invoices.length})</h2>
        <div style={css(S.tableBox)}>
          <table style={css(S.table)}>
            <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>เลขที่</th><th style={css(S.th)}>วันที่</th><th style={css(S.th)}>รอบเริ่ม</th>
              <th style={css(`${S.th}; text-align: right`)}>ก่อน VAT</th><th style={css(`${S.th}; text-align: right`)}>VAT</th><th style={css(`${S.th}; text-align: right`)}>รวม</th><th style={css(S.th)}>สถานะ</th></tr></thead>
            <tbody>
              {d.invoices.length === 0 && <tr style={css(S.tr)}><td colSpan={7} style={css('height: 40px; padding: 0 12px; color: #525252')}>ยังไม่มีใบแจ้งหนี้ — กด “รันรอบบิล”</td></tr>}
              {d.invoices.map((iv) => (
                <tr key={iv.id} style={css(S.tr)}>
                  <td style={css('height: 40px; padding: 0 12px')}><a href={`${href('invoice')}/${iv.id}`} style={css('text-decoration: none; font-weight: 500')}>{iv.doc_no ?? 'ร่าง (ยังไม่มีเลข)'}</a></td>
                  <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{thaiDate(iv.issue_date)}</td>
                  <td style={css(`${S.td}; font-variant-numeric: tabular-nums`)}>{iv.contract_period_start ? thaiDate(iv.contract_period_start) : 'เพิ่มเติม'}</td>
                  <td style={css(S.num)}>{money(iv.subtotal)}</td><td style={css(S.num)}>{money(iv.vat)}</td><td style={css(S.num)}>{money(iv.grand_total)}</td>
                  <td style={css(S.td)}><DocStatus status={iv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-sch" style={css('display: flex; flex-direction: column; gap: 12px')}>
        <h2 id="h-sch" style={css(ST.h2)}>ตารางรับรู้รายได้ (รายการที่รับรู้ตามช่วงเวลา)</h2>
        {d.schedule.length === 0 ? <span style={css('font-size: 14px; color: #525252')}>ยังไม่มีตารางรับรู้ — เกิดเมื่ออนุมัติใบแจ้งหนี้ของรายการที่รับรู้ตามช่วงเวลา</span> : (
          <div style={css(S.tableBox)}>
            <table style={css(S.table)}>
              <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>งวด (เดือน)</th><th style={css(`${S.th}; text-align: right`)}>ยอดตามตาราง</th><th style={css(`${S.th}; text-align: right`)}>รับรู้แล้ว</th><th style={css(`${S.th}; text-align: right`)}>รอรับรู้</th></tr></thead>
              <tbody>
                {(byLine.size ? d.lines.filter((l) => byLine.has(l.id)).map((l) => ({ key: l.id, title: `${l.line_no}. ${l.description}`, rows: byLine.get(l.id)! })) : [{ key: 'all', title: 'รวมทุกรายการ', rows: d.schedule }]).map((g) => {
                  const t = total(g.rows);
                  return (
                    <Fragment key={g.key}>
                      <tr style={css('border-top: 1px solid #e0e0e0; background: #f4f4f4')}><td colSpan={4} style={css('height: 32px; padding: 0 12px; font-weight: 600')}>{g.title}</td></tr>
                      {g.rows.map((r) => {
                        const pend = s(c(r.amount) - c(r.recognized));
                        return (
                          <tr key={`${g.key}-${r.period}`} style={css(S.tr)}>
                            <td style={css('height: 32px; padding: 0 12px 0 24px')}>{thaiYm(r.period)}</td>
                            <td style={css(S.num)}>{money(r.amount)}</td>
                            <td style={css(S.num)}>{money(r.recognized, { blankZero: true })}</td>
                            <td style={css(S.num)}>{money(pend, { blankZero: true })}</td>
                          </tr>
                        );
                      })}
                      <tr style={css(S.tfoot)}><td style={css('height: 32px; padding: 0 12px')}>รวม</td><td style={css(S.num)}>{money(t.amount)}</td><td style={css(S.num)}>{money(t.recognized)}</td><td style={css(S.num)}>{money(t.pending)}</td></tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <span style={css('font-size: 13px; color: #525252')}>รับรู้รายได้รายงวดที่หน้า <a href="/contracts#h-rec" style={css('text-decoration: none')}>สัญญา → รับรู้รายได้รับล่วงหน้ารายงวด</a></span>
      </section>

      <section aria-labelledby="h-cancel" style={css(ST.box)}>
        <h2 id="h-cancel" style={css(ST.h2)}>ยกเลิกสัญญา</h2>
        {cancelled ? <span style={css('font-size: 14px; color: #525252')}>สัญญานี้ยกเลิกแล้ว</span> : !cancel.open ? (
          <div><Button kind="danger" size={36} onClick={() => setCancel({ ...cancel, open: true })}>ยกเลิกสัญญา…</Button></div>
        ) : (
          <div style={css('display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap')}>
            <label style={css(ST.label)}>วันสุดท้ายที่ให้บริการ<input type="date" value={cancel.date} onChange={(e) => setCancel({ ...cancel, date: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
            <label style={css(`${ST.label}; flex: 1 1 300px`)}>เหตุผล<input value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} style={css(`${ST.input}; height: 36px`)} /></label>
            <Button kind="danger" size={36} disabled={busy} onClick={() => void doCancel()}>ยืนยันยกเลิกสัญญา</Button>
            <Button kind="ghost" size={36} onClick={() => setCancel({ ...cancel, open: false })}>ปิด</Button>
          </div>
        )}
        <span style={css('font-size: 13px; color: #525252')}>ไม่ออกรอบบิลที่เริ่มหลังวันยกเลิก · ใบแจ้งหนี้ที่ออกแล้วไม่เปลี่ยน · นับเป็น churn ของเดือนนั้น</span>
      </section>
    </>
  );
}
