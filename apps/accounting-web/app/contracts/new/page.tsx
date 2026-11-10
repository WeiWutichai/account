// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// /contracts/new — สร้างสัญญา (POST /v1/contracts) · ลูกค้าจาก GET /v1/contacts · สินค้า/บริการจาก GET /v1/master/products · บัญชีรายได้จาก GET /v1/accounts (type revenue)
import { css } from '@innovera/ui';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { today } from '../../finance/_shared/types';
import { ModuleOff, MODULE_OFF_RE, PageHead, ST, type ContractRow } from '../_lib';
import { ContractForm } from './_form';

interface ContactRow { id: string; code: string; name: string; kind: string; roles?: string[] }
interface ProductRow { code: string; name: string; kind: string; price: string | null; vat: boolean; revenue_account: string | null }

export default async function NewContractPage() {
  let contracts: ContractRow[];
  try {
    await api('/v1/contracts-metrics');
    contracts = await api<ContractRow[]>('/v1/contracts');
  } catch (e) {
    if (!(e instanceof Error) || !MODULE_OFF_RE.test(e.message)) throw e;
    return (
      <Shell active="contracts">
        <PageHead crumb="โมดูลเพิ่มเติม / สัญญา / สร้างสัญญา" title="สร้างสัญญา" />
        <div style={css(ST.page)}><ModuleOff /></div>
      </Shell>
    );
  }
  const { year } = await currentPeriod();
  const [contacts, products, accounts] = await Promise.all([
    api<ContactRow[]>('/v1/contacts'), api<{ rows: ProductRow[] }>('/v1/master/products'), api<{ code: string; name: string; type: string; active?: boolean }[]>(`/v1/accounts?year=${year}&period=13`),
  ]);
  const customers = contacts.filter((c) => c.kind === 'customer' || c.kind === 'both' || (c.roles ?? []).includes('customer')).map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const next = `CT-${String(contracts.length + 1).padStart(3, '0')}`;
  return (
    <Shell active="contracts">
      <PageHead crumb="โมดูลเพิ่มเติม / สัญญา / สร้างสัญญา" title="สร้างสัญญา" sub="สัญญาที่บันทึกมีสถานะ “ใช้งาน” ทันที · รอบบิลสร้างใบแจ้งหนี้ร่างตามรอบ (วันที่ใบแจ้งหนี้ = วันเริ่มรอบ)" />
      <div style={css(ST.page)}>
        <ContractForm today={today()} suggestedCode={contracts.some((c) => c.code === next) ? '' : next} customers={customers}
          products={products.rows.filter((p) => p.kind !== 'expense').map((p) => ({ code: p.code, name: p.name, price: p.price, vat: p.vat, revenueAccount: p.revenue_account }))}
          revenueAccounts={accounts.filter((a) => a.type === 'revenue' && a.active !== false).map((a) => ({ code: a.code, name: a.name }))} />
      </div>
    </Shell>
  );
}
