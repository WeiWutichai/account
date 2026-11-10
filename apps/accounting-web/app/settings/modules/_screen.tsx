'use client';
// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// ตั้งค่า / โมดูล — เปิด/ปิดโมดูล (สต็อก · หลายสกุลเงิน · สาขา · ซอฟต์แวร์) และค่าตั้งที่รอผู้สอบบัญชียืนยัน
// ทุกค่าบันทึกผ่าน endpoint เดิมของแต่ละกลุ่ม (ตรวจรูปแบบที่ server · 422 แสดงข้อความไทยจาก API) — ระบบไม่ตัดสินนโยบายเอง
import { Button, css, S, Tag, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { req } from '../../_p2a/req';
import type { CompanyModules } from '../../_p2a/types';
import { P2A_INPUT, PendingAuditor, TempBanner } from '../../_p2a/ui';

type ModuleKey = keyof CompanyModules;
const MODULES: { key: ModuleKey; name: string; desc: string; page: { href: string; label: string } }[] = [
  { key: 'inventory', name: 'สินค้าคงคลัง', desc: 'คลังสินค้า · ใบรับ/เบิก/โอน/ปรับยอด · ต้นทุนถัวเฉลี่ย · สร้างบัญชี 1200100 / 2130100 / 5020100 / 5020900 และคลังตั้งต้น', page: { href: '/inventory', label: 'ไปหน้าสต็อก' } },
  { key: 'multi_currency', name: 'หลายสกุลเงิน', desc: 'สกุลเงิน · อัตราแลกเปลี่ยน (กรอกเอง) · เอกสาร/รับ/จ่ายสกุลต่างประเทศ · ปรับมูลค่าสิ้นงวด · สร้างบัญชี 4910100 / 5920100', page: { href: '/fx', label: 'ไปหน้าสกุลเงินและสาขา' } },
  { key: 'branches', name: 'สาขา', desc: 'ทะเบียนสาขา (รหัส 5 หลัก) · เอกสาร/รายงานภาษี/ภ.พ.30 แยกสาขา · สร้างสำนักงานใหญ่ 00000', page: { href: '/fx#branches', label: 'ไปทะเบียนสาขา' } },
  { key: 'software', name: 'ซอฟต์แวร์ / สัญญา', desc: 'สัญญา · รายได้รับล่วงหน้า · ภ.พ.36 / ภ.ง.ด.54 · สินทรัพย์ไม่มีตัวตน · สร้างบัญชีของโมดูล', page: { href: '/contracts', label: 'ไปหน้าสัญญา' } },
];

type Api = 'inventory' | 'fx' | 'swt';
interface Cfg { key: string; group: string; label: string; def: unknown; api: Api; options?: { value: unknown; label: string }[]; kind?: 'json' | 'text' }
const BOOL = (on: string, off: string) => [{ value: false, label: off }, { value: true, label: on }];
// ตาราง config ใน docs/technical-plan-P2A.md "config ที่รอยืนยัน [ผู้สอบบัญชี]" — ค่าตั้งต้นชั่วคราวตามตาราง
const CONFIG: Cfg[] = [
  { key: 'inventory.method', group: 'สินค้าคงคลัง', label: 'วิธีบันทึกสินค้า', def: 'periodic', api: 'inventory', options: [{ value: 'periodic', label: 'periodic — ปรับยอดสิ้นงวด' }, { value: 'perpetual', label: 'perpetual — ลงต้นทุนทุกครั้งที่เคลื่อนไหว' }] },
  { key: 'inventory.costing', group: 'สินค้าคงคลัง', label: 'วิธีคำนวณต้นทุน', def: 'avco', api: 'inventory', options: [{ value: 'avco', label: 'avco — ถัวเฉลี่ยเคลื่อนที่' }, { value: 'fifo', label: 'fifo — เข้าก่อนออกก่อน (Phase 3)' }] },
  { key: 'inventory.writedown_nrv', group: 'สินค้าคงคลัง', label: 'ตีราคาต่ำกว่าทุน/NRV สิ้นปี', def: false, api: 'inventory', options: BOOL('true — ตีราคา', 'false — ไม่ตีราคา') },
  { key: 'fx.rate_source', group: 'หลายสกุลเงิน', label: 'อัตราแลกเปลี่ยนที่ใช้ (กรอกเอง)', def: 'bot_mid', api: 'fx', options: [{ value: 'bot_mid', label: 'bot_mid — อัตรากลาง ธปท.' }, { value: 'bot_buy', label: 'bot_buy — อัตรารับซื้อ ธปท.' }, { value: 'bot_sell', label: 'bot_sell — อัตราขาย ธปท.' }] },
  { key: 'fx.revalue_period_end', group: 'หลายสกุลเงิน', label: 'ปรับมูลค่าลูกหนี้/เจ้าหนี้สกุลต่างประเทศสิ้นงวด', def: false, api: 'fx', options: BOOL('true — ปรับมูลค่า + กลับรายการต้นงวดถัดไป', 'false — ไม่ปรับ') },
  { key: 'branch.vat_filing', group: 'สาขา', label: 'การยื่น ภ.พ.30', def: 'separate', api: 'fx', options: [{ value: 'separate', label: 'separate — ยื่นแยกสาขา' }, { value: 'combined', label: 'combined — ยื่นรวม (ต้องได้รับอนุมัติจากกรมสรรพากร)' }] },
  { key: 'branch.numbering', group: 'สาขา', label: 'เลขที่เอกสาร', def: 'shared', api: 'fx', options: [{ value: 'shared', label: 'shared — ใช้ร่วมทุกสาขา' }, { value: 'per_branch', label: 'per_branch — แยกต่อสาขา' }] },
  { key: 'revenue.standard', group: 'ซอฟต์แวร์ / สัญญา', label: 'มาตรฐานการรับรู้รายได้', def: 'npae', api: 'swt', options: [{ value: 'npae', label: 'npae — TFRS for NPAEs' }, { value: 'tfrs', label: 'tfrs — TFRS 15 เต็ม' }] },
  { key: 'revenue.ssp_allocation', group: 'ซอฟต์แวร์ / สัญญา', label: 'การปันส่วนราคาในสัญญา', def: 'contract_price', api: 'swt', options: [{ value: 'contract_price', label: 'contract_price — ตามราคาในสัญญา' }, { value: 'relative_ssp', label: 'relative_ssp — ตามราคาขายแบบเอกเทศ' }] },
  { key: 'revenue.vat_point_subscription', group: 'ซอฟต์แวร์ / สัญญา', label: 'จุดภาษีของค่าบริการรายงวด', def: 'on_payment', api: 'swt', options: [{ value: 'on_payment', label: 'on_payment — เมื่อรับเงิน (ม.78/1 เดิม)' }, { value: 'on_invoice', label: 'on_invoice — เมื่อออกใบกำกับ' }] },
  { key: 'tax.pp36.enabled', group: 'ภาษีจ่ายต่างประเทศ', label: 'ภ.พ.36 ค่าบริการจากต่างประเทศ', def: true, api: 'swt', options: BOOL('true — ใช้', 'false — ไม่ใช้') },
  { key: 'tax.pnd54.treaty_rates', group: 'ภาษีจ่ายต่างประเทศ', label: 'อัตราตามอนุสัญญาภาษีซ้อน (ภ.ง.ด.54) · ว่าง = อัตราตามประมวล', def: {}, api: 'swt', kind: 'json' },
  { key: 'tax.pnd54.gross_up', group: 'ภาษีจ่ายต่างประเทศ', label: 'ผู้จ่ายออกภาษีแทน (gross-up)', def: false, api: 'swt', options: BOOL('true — ออกภาษีแทน', 'false — หักจากผู้รับ') },
  { key: 'tax.pnd54.gross_up_account', group: 'ภาษีจ่ายต่างประเทศ', label: 'บัญชีค่าใช้จ่ายภาษีที่ออกแทน (รหัส 7 หลัก)', def: null, api: 'swt', kind: 'text' },
  { key: 'asset.intangible.capitalize_dev', group: 'สินทรัพย์ไม่มีตัวตน', label: 'บันทึกต้นทุนพัฒนาซอฟต์แวร์เองเป็นสินทรัพย์', def: false, api: 'swt', options: BOOL('true — บันทึกเป็นสินทรัพย์', 'false — ค่าใช้จ่าย') },
];
const PATH: Record<Api, string> = { inventory: 'inventory/settings', fx: 'fx/settings', swt: 'swt/settings' };
const show = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

export function ModulesScreen({ modules, values }: { modules: CompanyModules; values: Record<string, unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; kind: 'ok' | 'err'; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(CONFIG.filter((c) => c.kind).map((c) => [c.key, c.kind === 'json' ? JSON.stringify(values[c.key] ?? c.def) : String(values[c.key] ?? '')])));

  async function toggle(m: ModuleKey, on: boolean) {
    if (!on && !window.confirm(`ปิดโมดูล ${MODULES.find((x) => x.key === m)?.name ?? m}? ข้อมูลที่บันทึกแล้วยังอยู่ครบ`)) return;
    setBusy(m); setMsg(null);
    const r = m === 'inventory' ? await req(`inventory/${on ? 'enable' : 'disable'}`, 'POST', {})
      : m === 'software' ? await req('modules/software', 'PUT', { on })
      : await req(`modules/${m}/${on ? 'enable' : 'disable'}`, 'POST', {});
    setBusy(null);
    setMsg(r.ok ? { key: m, kind: 'ok', text: on ? 'เปิดโมดูลแล้ว' : 'ปิดโมดูลแล้ว' } : { key: m, kind: 'err', text: r.error });
    if (r.ok) router.refresh();
  }
  async function save(c: Cfg, value: unknown) {
    setBusy(c.key); setMsg(null);
    const r = await req(`${PATH[c.api]}/${encodeURIComponent(c.key)}`, 'PUT', { value });
    setBusy(null);
    setMsg(r.ok ? { key: c.key, kind: 'ok', text: 'บันทึกแล้ว' } : { key: c.key, kind: 'err', text: r.error });
    if (r.ok) router.refresh();
  }
  function saveText(c: Cfg) {
    const t = (drafts[c.key] ?? '').trim();
    if (c.kind === 'json') {
      let v: unknown;
      try { v = t ? JSON.parse(t) : {}; } catch { setMsg({ key: c.key, kind: 'err', text: 'รูปแบบ JSON ไม่ถูกต้อง' }); return; }
      void save(c, v);
    } else void save(c, t || null);
  }
  const note = (key: string) => (msg?.key === key
    ? <div role="status" style={css(`margin-top: 4px; font-size: 13px; color: ${msg.kind === 'ok' ? '#0e6027' : '#a2191f'}`)}>{msg.text}</div> : null);
  const groups = [...new Set(CONFIG.map((c) => c.group))];

  return (
    <>
      <TopBar crumb="ตั้งค่า / โมดูล" />
      <div style={css(S.content)}>
        <TempBanner />
        <div><h1 style={css(S.h1)}>โมดูลเสริม</h1><span style={css(S.sub)}>เปิดใช้ต่อบริษัท · ปิดอยู่ = ระบบทำงานแบบเดิมทุกอย่าง · ค่าตั้งด้านล่างเป็นค่าชั่วคราวที่รอผู้สอบบัญชียืนยัน</span></div>

        <section aria-label="โมดูล" style={css(S.tableBox)}>
          <table style={css(S.table)}>
            <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>โมดูล</th><th style={css(S.th)}>รายละเอียด</th><th style={css(S.th)}>สถานะ</th><th style={css(S.th)}></th></tr></thead>
            <tbody>
              {MODULES.map((m) => {
                const on = modules[m.key];
                return (
                  <tr key={m.key} style={css(S.tr)}>
                    <td style={css('height: 56px; padding: 8px 12px; font-weight: 600; white-space: nowrap')}>{m.name}<div style={css('font-weight: 400; font-size: 12px; color: #6f6f6f')}>{m.key}</div></td>
                    <td style={css('padding: 8px 12px; color: #525252')}>{m.desc}{note(m.key)}</td>
                    <td style={css('padding: 0 12px; white-space: nowrap')}>{on ? <Tag kind="success">เปิดใช้</Tag> : <Tag kind="neutral">ปิด</Tag>}</td>
                    <td style={css('padding: 8px 12px; text-align: right; white-space: nowrap')}>
                      <span style={css('display: inline-flex; gap: 8px')}>
                        {on && <a href={m.page.href} style={css('font-size: 14px; text-decoration: none; align-self: center')}>{m.page.label}</a>}
                        {on ? <Button size={32} kind="danger" disabled={busy !== null} onClick={() => void toggle(m.key, false)}>ปิดโมดูล</Button>
                          : <Button size={32} kind="primary" disabled={busy !== null} onClick={() => void toggle(m.key, true)}>เปิดใช้</Button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section aria-label="ค่าตั้งรอยืนยัน" style={css(S.tableBox)}>
          <div style={css('padding: 12px 16px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center')}>
            <strong style={css('font-weight: 600')}>ค่าตั้งที่รอผู้สอบบัญชียืนยัน</strong>
            <span style={css('font-size: 13px; color: #525252')}>ค่าตั้งต้นชั่วคราวตาม docs/technical-plan-P2A.md · เปลี่ยนได้แต่ระบบยังไม่ถือเป็นนโยบายที่ยืนยันแล้ว</span>
          </div>
          <table style={css(`${S.table}; min-width: 960px`)}>
            <thead><tr style={css(S.theadRow)}><th style={css(S.thFirst)}>ค่าตั้ง</th><th style={css(S.th)}>ค่าปัจจุบัน</th><th style={css(S.th)}>ค่าตั้งต้นชั่วคราว</th><th style={css(S.th)}>สถานะ</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr style={css('border-top: 1px solid #e0e0e0; background: #f4f4f4')}><td colSpan={4} style={css('height: 32px; padding: 0 12px; font-size: 13px; font-weight: 600; color: #525252')}>{g}</td></tr>
                  {CONFIG.filter((c) => c.group === g).map((c) => {
                    const cur = values[c.key];
                    const known = c.key in values;
                    return (
                      <tr key={c.key} style={css(S.tr)}>
                        <td style={css('padding: 8px 12px; vertical-align: top')}>{c.label}<div style={css("font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #6f6f6f")}>{c.key}</div></td>
                        <td style={css('padding: 8px 12px; vertical-align: top; min-width: 320px')}>
                          {!known ? <span style={css('color: #525252')}>— (ไม่มีสิทธิ์อ่านหรือ API ไม่ตอบ)</span>
                            : c.options ? (
                              <select aria-label={c.key} disabled={busy !== null} value={JSON.stringify(cur)} onChange={(e) => void save(c, JSON.parse(e.target.value) as unknown)} style={css(`${P2A_INPUT}; width: 100%`)}>
                                {c.options.map((o) => <option key={JSON.stringify(o.value)} value={JSON.stringify(o.value)}>{o.label}</option>)}
                                {!c.options.some((o) => JSON.stringify(o.value) === JSON.stringify(cur)) && <option value={JSON.stringify(cur)}>{show(cur)}</option>}
                              </select>
                            ) : (
                              <div style={css('display: flex; gap: 8px; align-items: flex-start')}>
                                {c.kind === 'json'
                                  ? <textarea aria-label={c.key} value={drafts[c.key] ?? ''} onChange={(e) => setDrafts({ ...drafts, [c.key]: e.target.value })} placeholder='{"SG": {"pnd54_royalty": "0.10"}}' style={css("flex: 1; min-height: 64px; padding: 8px 12px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: 'IBM Plex Mono', monospace; font-size: 13px; resize: vertical")} />
                                  : <input aria-label={c.key} value={drafts[c.key] ?? ''} placeholder="เช่น 5xxxxxx" onChange={(e) => setDrafts({ ...drafts, [c.key]: e.target.value })} style={css(`${P2A_INPUT}; flex: 1`)} />}
                                <Button size={40} disabled={busy !== null} onClick={() => saveText(c)}>บันทึก</Button>
                              </div>
                            )}
                          {note(c.key)}
                        </td>
                        <td style={css("padding: 8px 12px; vertical-align: top; font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #525252")}>{show(c.def)}</td>
                        <td style={css('padding: 8px 12px; vertical-align: top')}><PendingAuditor /></td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
