// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// /tax/foreign — ภาษีจ่ายต่างประเทศ (Phase 2A SWT): ภ.พ.36 (GET /v1/tax/pp36) · ภ.ง.ด.54 (GET /v1/tax/pnd54 · /v1/pnd54-types) · ประเทศผู้ติดต่อต่างประเทศ (GET /v1/foreign-contacts)
// ตัวเลขทุกตัวมาจาก API · อัตรา/เงื่อนไขทั้งหมดเป็นค่าตั้ง "รอยืนยัน" (ผู้สอบบัญชี) ตาม packages/db/src/foreign-tax.ts
import { css } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { today } from '../../finance/_shared/types';
import { ModuleOff, MODULE_OFF_RE, PageHead, ST } from '../../contracts/_lib';
import { ForeignTaxScreen, type ForeignContact, type Pnd54Report, type Pnd54Type, type Pp36Report } from './_screen';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/u;
const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

export default async function ForeignTaxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const month = sp.month && YM.test(sp.month) ? sp.month : today().slice(0, 7);
  const tab = sp.tab === 'pnd54' || sp.tab === 'contacts' ? sp.tab : 'pp36';
  try {
    await api('/v1/contracts-metrics');
  } catch (e) {
    if (!(e instanceof Error) || !MODULE_OFF_RE.test(e.message)) throw e;
    return (
      <Shell active="foreigntax">
        <PageHead crumb="โมดูลเพิ่มเติม / ภาษีจ่ายต่างประเทศ" title="ภาษีจ่ายต่างประเทศ (ภ.พ.36 · ภ.ง.ด.54)" />
        <div style={css(ST.page)}><ModuleOff /></div>
      </Shell>
    );
  }
  const { year } = await currentPeriod();
  const [pp36, pnd54, types, accounts, contacts] = await Promise.all([
    api<Pp36Report>(`/v1/tax/pp36?month=${month}`), api<Pnd54Report>(`/v1/tax/pnd54?month=${month}`), api<Record<string, Pnd54Type>>('/v1/pnd54-types'),
    api<{ code: string; name: string; type: string }[]>(`/v1/accounts?year=${year}&period=13`),
    // GET /v1/foreign-contacts มีใน branch นี้ · API เดิมยังไม่มี → ใช้รายชื่อผู้ติดต่อ (ไม่มีประเทศ)
    api<ForeignContact[]>('/v1/foreign-contacts').catch(async () => (await api<(ForeignContact & { entity_type: string })[]>('/v1/contacts')).filter((c) => c.entity_type === 'foreign').map((c) => ({ ...c, country: c.country ?? null }))),
  ]);
  const cur = today().slice(0, 7);
  const months = [...new Set([cur, prevMonth(cur), prevMonth(prevMonth(cur)), month])].sort().reverse();
  return (
    <Shell active="foreigntax">
      <PageHead crumb="โมดูลเพิ่มเติม / ภาษีจ่ายต่างประเทศ" title="ภาษีจ่ายต่างประเทศ (ภ.พ.36 · ภ.ง.ด.54)"
        sub="เกิดตอนจ่ายเงินให้ผู้ขายต่างประเทศ (PV / ค่าใช้จ่ายจ่ายทันที) · ภ.พ.36 ยื่นภายในวันที่ 7 ของเดือนถัดไป · ภ.ง.ด.54 ตามเดือนที่จ่าย · อัตราและเงื่อนไขรอผู้สอบบัญชียืนยัน" />
      <div style={css(ST.page)}>
        <ForeignTaxScreen month={month} months={months} tab={tab} today={today()} pp36={pp36} pnd54={pnd54} types={Object.values(types)} contacts={contacts}
          payAccounts={accounts.filter((a) => a.type === 'asset' && /^1[01]/u.test(a.code)).map((a) => ({ code: a.code, name: a.name }))} />
      </div>
    </Shell>
  );
}
