'use client';
// ข้อมูลหลัก / คู่ค้า — design/project/ScreenContacts.dc.html
// ตัวเลขทุกตัว (จำนวนราย · ค้างรับ/ค้างจ่าย · ที่อยู่ N · เอกสาร N · ค้างรับ N ใบ · เกินกำหนด · เอกสารล่าสุด) มาจาก API — ข้อความตามแบบร่าง
// TODO(backend) ScreenContacts.dc.html: "นำเข้า Excel" ยังไม่มี API → ปุ่มสถานะ "ใช้ไม่ได้"
// TODO(Wei) ScreenContacts.dc.html: แบบร่างไม่มีปุ่ม บันทึก/ยกเลิก — "แก้ไข" สลับโหมดแก้ไข แล้วแสดง "ยกเลิก" + "บันทึก" แทนปุ่ม "แก้ไข" ระหว่างแก้
// TODO(Wei) ScreenContacts.dc.html: แบบร่างแสดง "1130100 ลูกหนี้การค้า" ในช่องบัญชีลูกหนี้ แต่ข้อมูลตัวอย่างไม่ได้กำหนดบัญชีเฉพาะคู่ค้า (ar_account ว่าง = ตามสูตร) → แสดงค่าว่างตามข้อมูล
import { Button, css, href, money, shortDate, TopBar } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { docNav } from '../../finance/_shared/types';
import { norm } from '../../finance/_shared/num';

type Role = 'customer' | 'vendor' | 'contractor' | 'employee';
type Entity = 'juristic' | 'individual' | 'foreign';
export interface ContactRow {
  id: string; code: string; name: string; roles: Role[]; tax_id: string | null; branch_code: string | null; entity_type: Entity; external_source: string | null; ar: string | null; ap: string | null;
}
export interface ContactsOverview { counts: Record<'total' | Role, number>; rows: ContactRow[] }
export interface ContactFull {
  id: string; code: string; name: string; roles: Role[]; entity_type: Entity; tax_id: string | null; branch_code: string | null; external_source: string | null;
  credit_days: number | null; credit_limit: string | null; ar_account: string | null; ap_account: string | null; ar_account_label: string | null; ap_account_label: string | null;
  wht_received: string | null; pnd_form: '3' | '53' | null; price_level: number; bank_account: string | null;
  address: string | null; ship_address: string | null; phone: string | null; email: string | null; contact_person: string | null;
}
export interface ContactDoc { id: string; doc_no: string; doc_type: string; issue_date: string; due_date: string | null; status: string; grand_total: string }
export interface ContactDetail {
  contact: ContactFull; addressCount: number; docCount: number; lastDoc: string | null; openAr: { count: number; total: string; overdue: number }; docs: ContactDoc[];
}
interface Props { overview: ContactsOverview; detail: ContactDetail | null; q: string; role: string; accounts: { code: string; name: string }[] }

const ROLE_TEXT: Record<Role, string> = { customer: 'ลูกค้า', vendor: 'ผู้ขาย', contractor: 'ผู้รับเหมา', employee: 'พนักงาน' };
const ROLES: Role[] = ['customer', 'vendor', 'contractor', 'employee'];
const ENTITY_TEXT: Record<Entity, string> = { juristic: 'นิติบุคคล', individual: 'บุคคลธรรมดา', foreign: 'ต่างประเทศ' };
// ตัวเลือกตามแบบร่าง → ค่าที่เก็บใน contact.wht_received (ประเภทเงินได้ใน /v1/wht-types)
const WHT_RECEIVED: [string, string][] = [['service', '3% ค่าบริการ'], ['transport_domestic+service', '1% ขนส่ง / 3% บริการ'], ['', 'ไม่หัก']];
const PND: [string, string][] = [['53', '53 นิติบุคคล'], ['3', '3 บุคคลธรรมดา']];
const LEVELS: [number, string][] = [[1, 'ราคา 1 (ปกติ)'], [2, 'ราคา 2 (ตัวแทน)']];
const DOC_LINK = ['IV', 'RV', 'BN', 'CN', 'DN', 'DP', 'QO', 'SO'];
const STATUS_TEXT: Record<string, string> = { draft: 'ร่าง', pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', posted: 'ลงบัญชีแล้ว', void: 'ยกเลิก', voided: 'ยกเลิก' };

const LABEL = 'display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252';
const INPUT = 'height: 40px; padding: 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 15px';
const SELECT_RO = '; color: #161616; opacity: 1';
const TAB = 'height: 40px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #525252; font-family: inherit; font-size: 14px';
const TAB_ON = 'height: 40px; padding: 0 12px; border: 0; border-bottom: 2px solid #0f62fe; background: transparent; color: #161616; font-family: inherit; font-size: 14px; font-weight: 600';
const ROLE_TAG = 'font-size: 12px; padding: 2px 8px; border-radius: 4px; background: #e0e0e0';
const SR = 'position: absolute; width: 1px; height: 1px; overflow: hidden';

/** ไม่มีสาขา = สำนักงานใหญ่ 00000 (เหมือน branchText ของหน้าขาย) */
const branchOf = (c: { branch_code: string | null }) => c.branch_code ?? '00000';
const foreignNoTax = (c: { entity_type: Entity; tax_id: string | null }) => c.entity_type === 'foreign' && !c.tax_id;
const rowSub = (c: ContactRow) => (foreignNoTax(c) ? `${c.code} · ต่างประเทศ · ไม่มีเลขผู้เสียภาษี` : [c.code, c.tax_id, c.tax_id ? branchOf(c) : null].filter(Boolean).join(' · '));
const detailSub = (c: ContactFull) => (foreignNoTax(c)
  ? `${c.code} · ต่างประเทศ · ไม่มีเลขผู้เสียภาษี`
  : [c.code, c.tax_id ? `เลขผู้เสียภาษี ${c.tax_id}` : null, c.tax_id ? `สาขา ${branchOf(c)}` : null, ENTITY_TEXT[c.entity_type]].filter(Boolean).join(' · '));

interface Form {
  code: string; name: string; roles: Role[]; entityType: Entity; taxId: string; branchCode: string; contactPerson: string; phone: string; email: string;
  address: string; shipAddress: string; creditDays: string; creditLimit: string; arAccount: string; apAccount: string; whtReceived: string; pndForm: string; priceLevel: number; bankAccount: string;
}
const formOf = (c: ContactFull | null): Form => ({
  code: c?.code ?? '', name: c?.name ?? '', roles: c?.roles ?? ['customer'], entityType: c?.entity_type ?? 'juristic', taxId: c?.tax_id ?? '', branchCode: c?.branch_code ?? '',
  contactPerson: c?.contact_person ?? '', phone: c?.phone ?? '', email: c?.email ?? '', address: c?.address ?? '', shipAddress: c?.ship_address ?? '',
  creditDays: c?.credit_days === null || c?.credit_days === undefined ? '' : String(c.credit_days), creditLimit: c?.credit_limit ? money(c.credit_limit) : '',
  arAccount: c?.ar_account_label ?? '', apAccount: c?.ap_account_label ?? '', whtReceived: c?.wht_received ?? '',
  pndForm: c?.pnd_form ?? (c?.entity_type === 'individual' ? '3' : '53'), priceLevel: c?.price_level ?? 1, bankAccount: c?.bank_account ?? '',
});

export function ContactsScreen({ overview, detail, q, role, accounts }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { counts, rows } = overview;
  const selected = creating ? null : detail?.contact.id;
  const qs = (p: Record<string, string>) => {
    const s = new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...p });
    for (const [k, v] of [...s.entries()]) if (!v) s.delete(k);
    const t = s.toString();
    return t ? `?${t}` : '?';
  };
  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get('q');
    router.push(qs({ q: typeof v === 'string' ? v.trim() : '', id: '' }));
  };

  return (
    <>
      <TopBar crumb="ข้อมูลหลัก / คู่ค้า" right={<span style={css('color: #525252')}>{`${counts.total} ราย · ลูกค้า ${counts.customer} · ผู้ขาย ${counts.vendor} · ผู้รับเหมา ${counts.contractor}`}</span>} />
      <div style={css('padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px')}>
        <div style={css('display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px')}>
          <h1 style={css('margin: 0; font-size: 22px; line-height: 30px; font-weight: 600')}>คู่ค้า</h1>
          <div style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
            {/* TODO(backend): นำเข้า Excel ยังไม่มี API */}
            <Button size={36} disabled title="ยังไม่มี API นำเข้า Excel">นำเข้า Excel</Button>
            <Button size={36} kind="primary" onClick={() => setCreating(true)}>เพิ่มคู่ค้า</Button>
          </div>
        </div>
        <div style={css('display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start')}>
          <section style={css('flex: 1 1 440px; min-width: 0; border: 1px solid #e0e0e0')}>
            <form onSubmit={search} role="search" style={css('display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap')}>
              <label style={css('display: flex; flex: 1 1 200px; height: 40px; background: #f4f4f4; border-bottom: 1px solid #8d8d8d; align-items: center; padding: 0 16px')}>
                <span style={css(SR)}>ค้นหา</span>
                <input name="q" defaultValue={q} placeholder="ชื่อ / เลขผู้เสียภาษี / รหัส" style={css('flex: 1; border: 0; background: transparent; font-family: inherit; font-size: 14px; outline: none')} />
              </label>
              <select aria-label="บทบาท" value={role} onChange={(e) => router.push(qs({ role: e.target.value, id: '' }))} style={css('height: 40px; padding: 0 32px 0 16px; border: 0; border-bottom: 1px solid #8d8d8d; background: #f4f4f4; font-family: inherit; font-size: 14px')}>
                <option value="">ทุกบทบาท</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
              </select>
            </form>
            <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
              <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
                <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>คู่ค้า</th><th style={css('padding: 0 12px; font-weight: 400')}>บทบาท</th>
                <th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ค้างรับ</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>ค้างจ่าย</th>
              </tr></thead>
              <tbody>
                {rows.map((c) => {
                  const on = c.id === selected;
                  return (
                    <tr key={c.id} style={css(`border-top: 1px solid #e0e0e0${on ? '; background: #e0e0e0' : ''}`)} aria-current={on ? 'true' : undefined}>
                      <td style={css('height: 48px; padding: 4px 12px')}>
                        <a href={qs({ id: c.id })} onClick={() => setCreating(false)} style={css('text-decoration: none; font-weight: 500')}>{c.name}</a>
                        {c.external_source === 'tms' && <>{' '}<span style={css('font-size: 11px; padding: 1px 6px; background: #393939; color: #ffffff; border-radius: 4px')}>TMS</span></>}
                        <br /><span style={css('font-size: 13px; color: #525252')}>{rowSub(c)}</span>
                      </td>
                      <td style={css('padding: 0 12px')}>
                        {c.roles.map((r, i) => <span key={r}>{i > 0 && ' '}<span style={css(`${ROLE_TAG}${on ? '; border: 1px solid #8d8d8d' : ''}`)}>{ROLE_TEXT[r]}</span></span>)}
                      </td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(c.ar)}</td>
                      <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(c.ap)}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={4} style={css('height: 48px; padding: 0 12px; color: #525252')}>—</td></tr>}
              </tbody>
            </table>
          </section>
          {creating
            ? <Panel key="new" detail={null} accounts={accounts} onDone={() => setCreating(false)} qs={qs} />
            : detail && <Panel key={detail.contact.id} detail={detail} accounts={accounts} onDone={() => undefined} qs={qs} />}
        </div>
      </div>
    </>
  );
}

type Tab = 'general' | 'address' | 'acct' | 'docs';

function Panel({ detail, accounts, onDone, qs }: { detail: ContactDetail | null; accounts: { code: string; name: string }[]; onDone: () => void; qs: (p: Record<string, string>) => string }) {
  const router = useRouter();
  const c = detail?.contact ?? null;
  const isNew = !c;
  // TODO(Wei) ScreenContacts.dc.html: แบบร่างไม่มีฟอร์ม "เพิ่มคู่ค้า" — ใช้แผงขวาเดียวกันแบบว่าง เริ่มที่แท็บ ทั่วไป (ต้องมีรหัส/ชื่อ/บทบาท)
  const [tab, setTab] = useState<Tab>(isNew ? 'general' : 'acct');
  const [editing, setEditing] = useState(isNew);
  const [f, setF] = useState<Form>(() => formOf(c));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ro = !editing;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const accountCode = (label: string): string | null | false => {
    const t = label.trim();
    if (!t) return null;
    const code = /^(\d{7})\b/u.exec(t)?.[1];
    return code && accounts.some((a) => a.code === code) ? code : false;
  };

  async function save() {
    setErr(null);
    const ar = accountCode(f.arAccount);
    const ap = accountCode(f.apAccount);
    if (ar === false || ap === false) { setErr('บัญชีไม่อยู่ในผังบัญชี'); return; }
    const limit = f.creditLimit.trim() ? norm(f.creditLimit) : '';
    if (f.creditLimit.trim() && !limit) { setErr('วงเงินเครดิตไม่ถูกต้อง'); return; }
    if (f.creditDays.trim() && !/^\d+$/u.test(f.creditDays.trim())) { setErr('เครดิตเทอมต้องเป็นจำนวนวัน'); return; }
    const body = {
      code: f.code.trim(), name: f.name.trim(), roles: f.roles, entityType: f.entityType, taxId: f.taxId.trim() || null, branchCode: f.branchCode.trim() || null,
      address: f.address.trim() || null, shipAddress: f.shipAddress.trim() || null, contactPerson: f.contactPerson.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null,
      creditDays: f.creditDays.trim() ? Number(f.creditDays.trim()) : null, creditLimit: limit || null, arAccount: ar, apAccount: ap,
      whtReceived: f.whtReceived || null, pndForm: f.pndForm as '3' | '53', priceLevel: f.priceLevel, bankAccount: f.bankAccount.trim() || null,
    };
    setBusy(true);
    const res = await fetch(isNew ? '/api/proxy/master/contacts' : `/api/proxy/master/contacts/${c.id}`, { method: isNew ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = (await res.json()) as { id?: string; error?: string | string[] };
    setBusy(false);
    if (!res.ok) { setErr(Array.isArray(r.error) ? r.error.join(' · ') : (r.error ?? 'บันทึกไม่สำเร็จ')); return; }
    if (isNew && r.id) { onDone(); router.push(qs({ id: r.id })); }
    setEditing(false);
    router.refresh();
  }
  function cancel() {
    if (isNew) { onDone(); return; }
    setF(formOf(c)); setEditing(false); setErr(null);
  }

  const text = (label: string, k: 'code' | 'name' | 'taxId' | 'branchCode' | 'contactPerson' | 'phone' | 'email' | 'bankAccount', extra = '') => (
    <label style={css(LABEL)}>{label}<input value={f[k]} readOnly={ro} onChange={(e) => set(k, e.target.value)} style={css(`${INPUT}${extra}`)} /></label>
  );
  const tabs: [Tab, string][] = [['general', 'ทั่วไป'], ['address', `ที่อยู่ ${detail?.addressCount ?? 0}`], ['acct', 'สำหรับนักบัญชี'], ['docs', `เอกสาร ${detail?.docCount ?? 0}`]];

  return (
    <section style={css('flex: 1 1 420px; min-width: 0; border: 1px solid #e0e0e0; display: flex; flex-direction: column')}>
      <div style={css('display: flex; justify-content: space-between; align-items: flex-start; padding: 16px; border-bottom: 1px solid #e0e0e0; gap: 12px')}>
        <div>
          <h2 style={css('margin: 0; font-size: 18px; font-weight: 600')}>{c ? c.name : 'เพิ่มคู่ค้า'}</h2>
          {c && <span style={css('font-size: 13px; color: #525252')}>{detailSub(c)}</span>}
        </div>
        {editing
          ? <div style={css('display: flex; gap: 8px')}><Button size={32} onClick={cancel}>ยกเลิก</Button><Button size={32} kind="primary" disabled={busy} onClick={() => void save()}>บันทึก</Button></div>
          : <Button size={32} onClick={() => setEditing(true)}>แก้ไข</Button>}
      </div>
      <div role="tablist" style={css('display: flex; border-bottom: 1px solid #e0e0e0; font-size: 14px; padding: 0 8px')}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={css(tab === k ? TAB_ON : TAB)}>{label}</button>
        ))}
      </div>
      {err && <div role="alert" style={css('margin: 16px 16px 0; padding: 8px 12px; border-left: 3px solid #da1e28; background: #fff1f1; font-size: 14px')}>{err}</div>}

      {tab === 'acct' && (
        <div role="tabpanel" style={css('padding: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px')}>
          <label style={css(LABEL)}>เครดิตเทอม (วัน)<input value={f.creditDays} readOnly={ro} inputMode="numeric" onChange={(e) => set('creditDays', e.target.value)} style={css(`${INPUT}; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(LABEL)}>วงเงินเครดิต<input value={f.creditLimit} readOnly={ro} inputMode="decimal" onChange={(e) => set('creditLimit', e.target.value)}
            onBlur={(e) => { const n = norm(e.target.value); if (n) set('creditLimit', money(n)); }} style={css(`${INPUT}; text-align: right; font-variant-numeric: tabular-nums`)} /></label>
          <label style={css(LABEL)}>บัญชีลูกหนี้ (แทนค่าในสูตร)<input value={f.arAccount} readOnly={ro} list="contact-accounts" onChange={(e) => set('arAccount', e.target.value)} style={css(INPUT)} /></label>
          <label style={css(LABEL)}>บัญชีเจ้าหนี้<input value={f.apAccount} readOnly={ro} list="contact-accounts" placeholder="ว่าง = ตามสูตร" onChange={(e) => set('apAccount', e.target.value)} style={css(INPUT)} /></label>
          <label style={css(LABEL)}>WHT ที่ลูกค้าหักเรา<select value={f.whtReceived} disabled={ro} onChange={(e) => set('whtReceived', e.target.value)} style={css(`${INPUT}${SELECT_RO}`)}>
            {/* ค่าที่เก็บไว้แต่ไม่อยู่ในตัวเลือกของแบบร่าง → แสดงค่าดิบ ไม่ทับข้อมูล */}
            {f.whtReceived && !WHT_RECEIVED.some(([v]) => v === f.whtReceived) && <option value={f.whtReceived}>{f.whtReceived}</option>}
            {WHT_RECEIVED.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
          </select></label>
          <label style={css(LABEL)}>แบบ ภ.ง.ด.<select value={f.pndForm} disabled={ro} onChange={(e) => set('pndForm', e.target.value)} style={css(`${INPUT}${SELECT_RO}`)}>
            {PND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label style={css(LABEL)}>ระดับราคาขาย<select value={f.priceLevel} disabled={ro} onChange={(e) => set('priceLevel', Number(e.target.value))} style={css(`${INPUT}${SELECT_RO}`)}>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {f.priceLevel > 2 && <option value={f.priceLevel}>{`ราคา ${f.priceLevel}`}</option>}
          </select></label>
          {text('บัญชีธนาคารรับโอน', 'bankAccount')}
          <datalist id="contact-accounts">{accounts.map((a) => <option key={a.code} value={`${a.code} ${a.name}`} />)}</datalist>
        </div>
      )}

      {/* TODO(Wei) ScreenContacts.dc.html: แท็บนี้ไม่มีเนื้อหาในแบบร่าง */}
      {tab === 'general' && (
        <div role="tabpanel" style={css('padding: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px')}>
          {text('รหัส', 'code')}
          {text('ชื่อ', 'name')}
          <fieldset style={css('grid-column: 1 / -1; margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #525252')}>
            <legend style={css('padding: 0; margin-bottom: 4px')}>บทบาท</legend>
            <div style={css('display: flex; gap: 16px; flex-wrap: wrap; font-size: 15px; color: #161616')}>
              {ROLES.map((r) => (
                <label key={r} style={css('display: inline-flex; gap: 6px; align-items: center')}>
                  <input type="checkbox" disabled={ro} checked={f.roles.includes(r)} onChange={(e) => set('roles', e.target.checked ? ROLES.filter((x) => x === r || f.roles.includes(x)) : f.roles.filter((x) => x !== r))} />
                  {ROLE_TEXT[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <label style={css(LABEL)}>ประเภท<select value={f.entityType} disabled={ro} onChange={(e) => set('entityType', e.target.value as Entity)} style={css(`${INPUT}${SELECT_RO}`)}>
            {(Object.keys(ENTITY_TEXT) as Entity[]).map((k) => <option key={k} value={k}>{ENTITY_TEXT[k]}</option>)}
          </select></label>
          {text('เลขผู้เสียภาษี', 'taxId', '; font-variant-numeric: tabular-nums')}
          {text('สาขา', 'branchCode', '; font-variant-numeric: tabular-nums')}
          {text('ผู้ติดต่อ', 'contactPerson')}
          {text('โทรศัพท์', 'phone')}
          {text('อีเมล', 'email')}
        </div>
      )}

      {/* TODO(Wei) ScreenContacts.dc.html: แท็บนี้ไม่มีเนื้อหาในแบบร่าง */}
      {tab === 'address' && (
        <div role="tabpanel" style={css('padding: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px')}>
          <label style={css(LABEL)}>ที่อยู่<textarea value={f.address} readOnly={ro} rows={4} onChange={(e) => set('address', e.target.value)} style={css(`${INPUT}; height: auto; padding: 8px 16px; resize: vertical`)} /></label>
          <label style={css(LABEL)}>ที่อยู่จัดส่ง<textarea value={f.shipAddress} readOnly={ro} rows={4} onChange={(e) => set('shipAddress', e.target.value)} style={css(`${INPUT}; height: auto; padding: 8px 16px; resize: vertical`)} /></label>
        </div>
      )}

      {/* TODO(Wei) ScreenContacts.dc.html: แท็บนี้ไม่มีเนื้อหาในแบบร่าง */}
      {tab === 'docs' && (
        <div role="tabpanel">
          <table style={css('width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px')}>
            <thead><tr style={css('background: #f4f4f4; color: #525252; font-size: 13px; text-align: left')}>
              <th style={css('height: 40px; padding: 0 12px; font-weight: 400')}>วันที่</th><th style={css('padding: 0 12px; font-weight: 400')}>เลขที่</th>
              <th style={css('padding: 0 12px; font-weight: 400')}>สถานะ</th><th style={css('padding: 0 12px; font-weight: 400; text-align: right')}>จำนวนเงิน</th>
            </tr></thead>
            <tbody>
              {(detail?.docs ?? []).map((d) => (
                <tr key={d.id} style={css('border-top: 1px solid #e0e0e0')}>
                  <td style={css('height: 40px; padding: 0 12px; font-variant-numeric: tabular-nums')}>{shortDate(d.issue_date)}</td>
                  <td style={css('padding: 0 12px')}>{DOC_LINK.includes(d.doc_type) ? <a href={docNav(d).view} style={css('text-decoration: none')}>{d.doc_no}</a> : d.doc_no}</td>
                  <td style={css('padding: 0 12px; color: #525252')}>{STATUS_TEXT[d.status] ?? d.status}</td>
                  <td style={css('padding: 0 12px; text-align: right; font-variant-numeric: tabular-nums')}>{money(d.grand_total)}</td>
                </tr>
              ))}
              {!detail?.docs.length && <tr style={css('border-top: 1px solid #e0e0e0')}><td colSpan={4} style={css('height: 40px; padding: 0 12px; color: #525252')}>—</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div style={css('padding: 12px 16px; border-top: 1px solid #e0e0e0; font-size: 13px; color: #525252')}>
          {`ค้างรับ ${detail.openAr.count} ใบ ${money(detail.openAr.total)} · เกินกำหนด ${detail.openAr.overdue} ใบ · `}
          <a href={href('aging')}>อายุลูกหนี้</a>
          {` · เอกสารล่าสุด ${detail.lastDoc ?? '—'}`}
        </div>
      )}
    </section>
  );
}
