// F5 เงินสดย่อย (imprest) — design/project/ScreenPettyCash.dc.html · ข้อมูลจาก GET /v1/petty-cash
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import { findDoc } from '../_shared/data';
import { today, type Account, type Contact } from '../_shared/types';
import { PettyCashScreen, type PettyItem, type PettySummary } from './_screen';

interface WhtType { key: string; rate: string; label: string }

export default async function PettyCashPage() {
  const { year } = await currentPeriod();
  const [sum, accounts, contacts, types] = await Promise.all([
    api<PettySummary>('/v1/petty-cash'), api<Account[]>(`/v1/accounts?year=${year}&period=13`), api<Contact[]>('/v1/contacts'), api<Record<string, WhtType>>('/v1/wht-types'),
  ]);
  // ผู้รับเงินของรายการที่หัก ณ ที่จ่าย: บุคคลธรรมดา / นิติบุคคล ตามเลขผู้เสียภาษี (ขึ้นต้น 0 = นิติบุคคล · เหมือน pndOf ของ @innovera/tax-th)
  const items: PettyItem[] = await Promise.all(sum.items.map(async (i) => {
    if (!i.wht_type) return { ...i, individual: null };
    const d = await findDoc(i.id);
    const tax = d?.contact && 'tax_id' in d.contact ? (d.contact as { tax_id: string | null }).tax_id : null;
    return { ...i, individual: !(tax ?? '').startsWith('0') };
  }));
  const reimbursed = sum.items.map((i) => i.batch_ref).filter((b): b is string => Boolean(b)).map((b) => /(\d{4}-\d{2}-\d{2})/u.exec(b)?.[1] ?? '').filter(Boolean).sort();
  return (
    <Shell active="pettycash">
      <PettyCashScreen today={today()} summary={{ ...sum, items }} lastReimbursed={reimbursed.at(-1) ?? null}
        accounts={accounts.filter((a) => a.code.startsWith('5')).map((a) => ({ code: a.code, name: a.name }))} accountNames={Object.fromEntries(accounts.map((a) => [a.code, a.name]))}
        contacts={contacts.filter((c) => c.kind !== 'customer').map((c) => ({ id: c.id, code: c.code, name: c.name }))}
        whtTypes={Object.values(types).map((t) => ({ key: t.key, label: t.label, rate: t.rate }))} />
    </Shell>
  );
}
