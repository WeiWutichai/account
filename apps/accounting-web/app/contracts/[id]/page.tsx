// TODO(Wei): หน้าชั่วคราว รอแบบร่างจาก Claude Design
// /contracts/[id] — รายละเอียดสัญญา (GET /v1/contracts/:id): รายการ · ใบแจ้งหนี้ที่สร้าง · ตารางรับรู้รายได้ต่อรายการ · ยอดใช้งาน
// การทำงาน: รอบบิลสัญญานี้ · บันทึกยอดใช้งาน · บันทึกงานเสร็จ (milestone) · ยกเลิกสัญญา
import { css } from '@innovera/ui';
import { notFound } from 'next/navigation';
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { today } from '../../finance/_shared/types';
import { PageHead, ST, type ContractDetail } from '../_lib';
import { ContractDetailScreen } from './_screen';

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/u.test(id)) notFound();
  const { year } = await currentPeriod();
  let d: ContractDetail;
  try {
    d = await api<ContractDetail>(`/v1/contracts/${id}`);
  } catch (e) {
    if (e instanceof Error && /ไม่พบสัญญา/u.test(e.message)) notFound();
    throw e;
  }
  const [contacts, accounts] = await Promise.all([
    api<{ id: string; code: string; name: string }[]>('/v1/contacts'), api<{ code: string; name: string }[]>(`/v1/accounts?year=${year}&period=13`),
  ]);
  const customer = contacts.find((c) => c.id === d.contract.contact_id);
  return (
    <Shell active="contracts">
      <PageHead crumb={`โมดูลเพิ่มเติม / สัญญา / ${d.contract.code}`} title={`สัญญา ${d.contract.code}`} sub={customer ? `${customer.code} · ${customer.name}` : undefined} />
      <div style={css(ST.page)}>
        <ContractDetailScreen d={d} today={today()} accountNames={Object.fromEntries(accounts.map((a) => [a.code, a.name]))} />
      </div>
    </Shell>
  );
}
