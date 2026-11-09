'use client';
// B6 ทะเบียนทรัพย์สิน — design/project/ScreenAssets.dc.html
// ค่าเสื่อมของเดือน/สะสม/มูลค่าสุทธิ จาก GET /v1/assets?month= (ตารางเส้นตรงรายเดือน golden 6) · บันทึก JV = POST /v1/assets/depreciation/:year/:no (รันได้ครั้งเดียวต่องวด)
// "สะสม" และ "มูลค่าสุทธิ" ในตาราง = ก่อนค่าเสื่อมเดือนนี้ (แบบร่าง FA-0017: สะสม 0.00 · สุทธิ 78,000.00 · ค่าเสื่อม พ.ย. 1,353.41)
// GET /v1/assets คืนทุกสถานะ (ใช้งาน · เสื่อมครบ · ขายแล้วในปี) พร้อม ราคาทุน/ซาก/วันที่เริ่มใช้/อายุ/บัญชีสินทรัพย์ · ขายแล้ว: สะสม = ถึงวันที่ขาย · สุทธิ 0.00
// TODO(Wei) ScreenAssets.dc.html: ไม่มีแบบร่างฟอร์ม "+ เพิ่มทรัพย์สิน" / แก้ทรัพย์สิน (backend PUT assets/:code พร้อม) · "ส่งออกทะเบียน (ภ.ง.ด.50)" / "ดูรายละเอียดรายตัว" ยังไม่มี API · ตัวกรองหมวด/สถานะ/ซื้อขายในเดือน รอข้อมูลจาก API
// การขายทรัพย์สิน = POST /v1/assets/:code/dispose · บรรทัด "ขาย FA-xxxx: Dr … / Cr …" แสดงเมื่อมีการขายในเดือนนี้ (จาก JV ขายจริง)
// TODO(Wei) ScreenAssets.dc.html: ไม่มีแบบร่างฟอร์ม/ปุ่ม "ขายทรัพย์สิน" — API พร้อม แต่ยังไม่มีจุดเรียกบนหน้าจอ
import { buttonStyle, css, href, money, Tag, thaiDate, thaiMonth } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '../../sales/_lib/client';
import { fromCents, sumMoney, toCents } from '../../sales/_lib/num';
import { Msg } from '../../sales/_lib/ui';

export interface AssetRow {
  code: string; name: string; expense: string; accum: string; amount: string; accumulated: string | null; nbv: string | null;
  cost?: string; salvage?: string; startDate?: string; lifeYears?: string; assetAccount?: string;
  status?: 'active' | 'disposed' | 'fully_depreciated'; sourceDocNo?: string | null;
  disposal?: { date: string; saleAmount: string | null; saleVat: string | null; ref: string | null; journalNo: string | null; lines: [string, string, string][] } | null;
}
interface Props { year: number; period: number; monthEnd: string; assets: AssetRow[]; journalNo: string | null; names: Record<string, string> }

const TH = 'padding: 0 12px; font-weight: 400';
const THN = 'padding: 0 12px; font-weight: 400; text-align: right';
const TD = 'padding: 0 12px';
const NUM = 'padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums';
const FIELD = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px';

/** ค่าก่อนค่าเสื่อมเดือนนี้ (สะสม/สุทธิ) · ราคาทุน */
function view(a: AssetRow) {
  if (a.accumulated === null || a.nbv === null) return { before: null, nbvBefore: null, cost: a.cost ?? null, done: true };
  // ขายแล้ว: สะสม ณ วันที่ขาย (รวมค่าเสื่อมเดือนสุดท้าย) · มูลค่าสุทธิ 0.00 (แบบร่าง FA-0003)
  if (a.status === 'disposed') return { before: a.accumulated, nbvBefore: a.nbv, cost: a.cost ?? fromCents(toCents(a.accumulated) + toCents(a.nbv)), done: true };
  const before = fromCents(toCents(a.accumulated) - toCents(a.amount));
  return { before, nbvBefore: fromCents(toCents(a.nbv) + toCents(a.amount)), cost: a.cost ?? fromCents(toCents(a.accumulated) + toCents(a.nbv)), done: a.status === 'fully_depreciated' };
}

export function AssetsScreen({ year, period, monthEnd, assets, journalNo, names }: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const mon = thaiMonth(period);
  const month = `${mon} ${year}`;
  const rows = assets.map((a) => ({ a, v: view(a) }));
  const shown = rows.filter(({ a }) => !q.trim() || `${a.code} ${a.name}`.toLowerCase().includes(q.trim().toLowerCase()));
  const total = sumMoney(assets.map((a) => a.amount));
  const costTotal = sumMoney(rows.map((r) => r.v.cost));
  const accumTotal = sumMoney(rows.map((r) => r.v.before));
  const nbvTotal = sumMoney(rows.map((r) => r.v.nbvBefore));
  const active = rows.filter((r) => !r.v.done).length;
  const prevEnd = (() => { const d = new Date(Date.UTC(year - 543, period - 1, 0)); return d.toISOString().slice(0, 10); })();
  const posted = journalNo !== null;
  // JV ค่าเสื่อม: Dr ค่าเสื่อมตามบัญชีค่าใช้จ่าย / Cr ค่าเสื่อมสะสมตามบัญชี (เดียวกับ runDepreciation)
  const group = (key: 'expense' | 'accum') => [...new Set(assets.map((a) => a[key]))].map((acc) => ({ acc, amount: sumMoney(assets.filter((a) => a[key] === acc).map((a) => a.amount)) })).filter((g) => toCents(g.amount) > 0n);
  const dr = group('expense');
  const cr = group('accum');
  // ขายในเดือนนี้ → บรรทัดตัวอย่าง "ขาย FA-0003: Dr 1100100 เงินฝาก … / Cr 2150100 ภาษีขาย …" (ชื่อย่อตามแบบร่าง)
  const sold = assets.filter((a) => a.disposal && a.disposal.date.slice(0, 7) === monthEnd.slice(0, 7));
  const saleLabel = (a: AssetRow, acc: string): string => {
    if (acc === a.assetAccount) return 'ราคาทุน';
    if (acc === a.accum) return 'สะสม';
    if (acc === '5910100') return 'ขาดทุนจากการจำหน่าย';
    if (acc === '2150100') return 'ภาษีขาย';
    if (acc.startsWith('1100')) return 'เงินฝาก';
    return names[acc] ?? '';
  };

  async function run() {
    if (!window.confirm(`บันทึก JV ค่าเสื่อม ${month} ยอด ${money(total)}?`)) return;
    setBusy(true); setMsg(null);
    const r = await call<{ total: string; journalNo: string | null }>(`assets/depreciation/${year}/${period}`, 'POST', {});
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: r.data.journalNo ? `บันทึก ${r.data.journalNo} ค่าเสื่อม ${money(r.data.total)} แล้ว` : 'ไม่มีค่าเสื่อมในงวดนี้' });
    router.refresh();
  }

  function status(a: AssetRow, done: boolean) {
    if (a.status === 'disposed' && a.disposal) {
      const last = a.disposal.date.slice(0, 7) === monthEnd.slice(0, 7);
      return <Tag kind="neutral">{last ? `ขายแล้ว · เดือนสุดท้าย ${Number(a.disposal.date.slice(8, 10))} วัน` : 'ขายแล้ว'}</Tag>;
    }
    if (done) return <Tag kind="neutral">{a.salvage && toCents(a.salvage) > 0n ? `เสื่อมครบ · คงซาก ${money(a.salvage).replace(/\.00$/u, '')} บาท` : 'เสื่อมครบ'}</Tag>;
    if (a.startDate && a.startDate.slice(0, 7) === monthEnd.slice(0, 7)) {
      const days = Number(monthEnd.slice(8, 10)) - Number(a.startDate.slice(8, 10)) + 1;
      return <Tag kind="info">{`ใหม่ · เดือนแรก ${days} วัน`}</Tag>;
    }
    return <Tag kind="success">ใช้งาน</Tag>;
  }

  return (
    <>
      <header style={css('height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>บัญชี / ทะเบียนทรัพย์สิน</span>
        {posted ? <Tag kind="success">{`ค่าเสื่อม ${month} บันทึกแล้ว`}</Tag> : <Tag kind="warning">{`ค่าเสื่อม ${month} ยังไม่บันทึก`}</Tag>}
      </header>
      <div style={css('padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px')}>
          <div><h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>ทะเบียนทรัพย์สินถาวร</h1><span style={css('font-size: 13px; color: #525252')}>วิธีเส้นตรง · คิดรายเดือน · เดือนแรกและเดือนสุดท้ายคิดตามจำนวนวันที่ใช้จริง · เชื่อมจากบิลซื้อที่ลงบัญชีสินทรัพย์อัตโนมัติ</span></div>
          <div style={css('display: flex; gap: 8px')}><button type="button" style={buttonStyle('secondary', 36)}>ส่งออกทะเบียน (ภ.ง.ด.50)</button><button type="button" style={buttonStyle('primary', 36)}>+ เพิ่มทรัพย์สิน</button></div>
        </div>
        <div style={css('display: flex; gap: 32px; padding: 16px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; font-size: 14px; flex-wrap: wrap')}>
          <div><span style={css('color: #525252; font-size: 13px')}>ราคาทุนรวม</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(costTotal)}</div><span style={css('color: #525252')}>{assets.length} รายการ · ใช้งาน {active}</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>ค่าเสื่อมสะสม</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(fromCents(-toCents(accumTotal)), { paren: true })}</div><span style={css('color: #525252')}>ถึง {thaiDate(prevEnd)}</span></div>
          <div><span style={css('color: #525252; font-size: 13px')}>มูลค่าตามบัญชีสุทธิ</span><div style={css('font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums')}>{money(nbvTotal)}</div></div>
          <div><span style={css('color: #525252; font-size: 13px')}>ค่าเสื่อมเดือน {mon} (คำนวณแล้ว)</span><div style={css(`font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: ${posted ? '#0e6027' : '#684e00'}`)}>{money(total)}</div><span style={css('color: #525252')}>{posted ? `บันทึกแล้ว ${journalNo}` : 'รอบันทึก JV อัตโนมัติ'}</span></div>
        </div>
        <Msg msg={msg} />
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 14px')}>
          <input aria-label="ค้นหาทรัพย์สิน" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัส / ชื่อทรัพย์สิน / เลขเครื่อง" style={css(`${FIELD}; width: 320px`)} />
          <select aria-label="หมวด" style={css(FIELD)}><option>ทุกหมวด</option><option>อุปกรณ์สำนักงาน</option><option>คอมพิวเตอร์</option><option>เครื่องตกแต่ง</option><option>ยานพาหนะ</option><option>ส่วนปรับปรุงอาคารเช่า</option><option>สินทรัพย์ไม่มีตัวตน</option></select>
          <select aria-label="สถานะ" style={css(FIELD)}><option>สถานะ: ใช้งาน + ใหม่</option><option>ตัดจำหน่าย / ขายแล้ว</option><option>เสื่อมครบแล้ว</option><option>ทั้งหมด</option></select>
          <label style={css('display: flex; align-items: center; gap: 8px')}><input type="checkbox" /> แสดงเฉพาะที่ซื้อ/ขายในเดือนนี้ (คิดตามวัน)</label>
        </div>
        <section style={css('border: 1px solid #e0e0e0; overflow-x: auto')}>
          <table style={css('width: 100%; min-width: 1200px; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
              <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>รหัส</th><th style={css(TH)}>ทรัพย์สิน</th><th style={css(TH)}>หมวด / บัญชี</th><th style={css(TH)}>วันที่เริ่มใช้</th><th style={css(THN)}>อายุ (ปี)</th><th style={css(THN)}>ราคาทุน</th><th style={css(THN)}>ซาก</th><th style={css(THN)}>ค่าเสื่อม {mon}</th><th style={css(THN)}>สะสม</th><th style={css(THN)}>มูลค่าสุทธิ</th><th style={css(TH)}>สถานะ</th>
            </tr></thead>
            <tbody>
              {shown.map(({ a, v }) => (
                <tr key={a.code} style={css(`border-top: 1px solid #e0e0e0${v.done && a.status !== 'disposed' ? '; color: #525252' : ''}`)}>
                  <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{a.code}</td>
                  <td style={css(TD)}><a href={href('assets')} style={css(`text-decoration: none; font-weight: 500${v.done && a.status !== 'disposed' ? '; color: #525252' : ''}`)}>{a.name}</a>
                    {a.disposal ? <div style={css('font-size: 13px; color: #525252')}>ขาย {thaiDate(a.disposal.date)} ราคา {money(a.disposal.saleAmount ?? '0.00')}{a.disposal.ref ? ` (${a.disposal.ref})` : ''}</div>
                      : a.sourceDocNo ? <div style={css('font-size: 13px; color: #525252')}>จาก {a.sourceDocNo}</div> : null}</td>
                  <td style={css(TD)}>{a.assetAccount ? `${names[a.assetAccount] ?? ''} · ${a.assetAccount}` : '—'}</td>
                  <td style={css(`${TD}; font-variant-numeric: tabular-nums`)}>{a.startDate ? thaiDate(a.startDate) : '—'}</td>
                  <td style={css(NUM)}>{a.lifeYears ? String(Number(a.lifeYears)) : '—'}</td>
                  <td style={css(NUM)}>{v.cost ? money(v.cost) : '—'}</td>
                  <td style={css(NUM)}>{a.salvage ? money(a.salvage) : '—'}</td>
                  <td style={css(NUM)}>{money(a.amount)}</td>
                  <td style={css(NUM)}>{v.before ? money(v.before) : '—'}</td>
                  <td style={css(NUM)}>{v.nbvBefore ? money(v.nbvBefore) : '—'}</td>
                  <td style={css(TD)}>{status(a, v.done)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}>
              <td colSpan={5} style={css('height: 40px; padding: 0 12px')}>รวม {assets.length} รายการ</td>
              <td style={css(NUM)}>{money(costTotal)}</td><td style={css('padding: 0 12px; text-align: right')}></td><td style={css(NUM)}>{money(total)}</td><td style={css(NUM)}>{money(accumTotal)}</td><td style={css(NUM)}>{money(nbvTotal)}</td><td></td>
            </tr></tfoot>
          </table>
        </section>
        <div style={css('display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px; align-items: start')}>
          <section style={css('border: 1px solid #e0e0e0; padding: 16px; font-size: 14px; display: flex; flex-direction: column; gap: 10px')}>
            <strong>วิธีคำนวณ (เส้นตรง คิดตามวันในเดือนแรก/สุดท้าย)</strong>
            <table style={css('border-collapse: collapse; width: 100%')}><tbody>
              <tr><td style={css('height: 28px; color: #525252')}>ค่าเสื่อมต่อปี</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>(ราคาทุน − ซาก) ÷ อายุ</td></tr>
              <tr><td style={css('height: 28px; color: #525252')}>เดือนเต็ม</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>ค่าเสื่อมต่อปี ÷ 12</td></tr>
              <tr><td style={css('height: 28px; color: #525252')}>เดือนแรก / เดือนสุดท้าย</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>ค่าเสื่อมต่อปี × วันที่ใช้ ÷ วันในปี (365/366)</td></tr>
              <tr style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 28px; color: #525252')}>ตัวอย่าง FA-0017 (78,000 − 1) ÷ 3 = 25,999.67/ปี</td><td style={css('text-align: right; font-variant-numeric: tabular-nums')}>พ.ย. 19 วัน: 25,999.67 × 19 ÷ 365 = <strong>1,353.41</strong></td></tr>
              <tr><td style={css('height: 28px; color: #525252')}>เดือนสุดท้ายปรับให้สะสม = ราคาทุน − ซาก พอดี</td><td style={css('text-align: right; color: #525252')}>ป้องกันเศษสตางค์ค้าง</td></tr>
            </tbody></table>
            <span style={css('font-size: 13px; color: #525252')}>อัตราภาษีสูงสุดตาม พ.ร.ฎ. 145: อาคาร 5% · ยานพาหนะ/อุปกรณ์ 20% · คอมพิวเตอร์ 33.33% (หรือ 3 ปี) · ระบบเตือนเมื่อกำหนดอายุต่ำกว่าเกณฑ์</span>
          </section>
          <section style={css('background: #f4f4f4; border: 1px solid #e0e0e0')}>
            <div style={css('display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e0e0e0')}><strong style={css('font-weight: 600')}>ตัวอย่างการลงบัญชี — JV ค่าเสื่อม {month}</strong><span style={css('font-size: 13px; color: #525252')}>สูตร DEPR-M · ลงวันที่ {thaiDate(monthEnd).slice(0, 5)}</span></div>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px')}><tbody>
              {dr.map((g, i) => (
                <tr key={`dr-${g.acc}`} style={css(i ? 'border-top: 1px solid #e0e0e0' : '')}><td style={css('height: 32px; padding: 0 16px')}>Dr {g.acc} {names[g.acc] ?? ''}</td><td style={css('width: 110px; text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(g.amount)}</td><td style={css('width: 110px')}></td></tr>
              ))}
              {cr.map((g) => (
                <tr key={`cr-${g.acc}`} style={css('border-top: 1px solid #e0e0e0')}><td style={css('height: 32px; padding: 0 16px 0 32px')}>Cr {g.acc} {names[g.acc] ?? ''}</td><td></td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(g.amount)}</td></tr>
              ))}
              <tr style={css('border-top: 1px solid #8d8d8d; font-weight: 600')}><td style={css('height: 32px; padding: 0 16px')}>รวม</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(total)}</td><td style={css('text-align: right; padding: 0 16px; font-variant-numeric: tabular-nums')}>{money(total)}</td></tr>
            </tbody></table>
            <div style={css('padding: 12px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252; display: flex; flex-direction: column; gap: 4px')}>{sold.map((a) => (
              <span key={a.code}><strong style={css('color: #161616')}>ขาย {a.code}:</strong> {a.disposal!.lines.map(([side, acc, amt], i) => `${i ? ' / ' : ''}${side} ${acc} ${saleLabel(a, acc)} ${money(amt)}`).join('')}</span>
            ))}<span>ค่าเสื่อมบันทึกอัตโนมัติวันสิ้นเดือน (ตั้งค่าได้) · ย้อนคำนวณใหม่เมื่อแก้วันที่เริ่มใช้ / อายุ · ล็อกเมื่อปิดงวด</span></div>
          </section>
        </div>
      </div>
      <div style={css('position: sticky; bottom: 0; margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; height: 64px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px')}>
        <span style={css('color: #525252')}>ค่าเสื่อม {month} คำนวณครบ {assets.length} รายการ · {posted ? `บันทึกแล้ว ${journalNo}` : 'ยังไม่บันทึก'}</span>
        <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
          <button type="button" style={buttonStyle('secondary')}>ดูรายละเอียดรายตัว</button>
          {(() => {
            const off = busy || posted || toCents(total) === 0n;
            return <button type="button" disabled={off} onClick={() => void run()} style={buttonStyle('primary', 40, off)}>บันทึก JV ค่าเสื่อม {mon}</button>;
          })()}
        </div>
      </div>
    </>
  );
}
