// ข้อมูลหลัก / คู่ค้า — design/project/ScreenContacts.dc.html · ข้อมูลจาก GET /v1/master/contacts (+ /:id)
import { api } from '../../lib/api';
import { currentPeriod, Shell } from '../../lib/shell';
import type { Account } from '../../finance/_shared/types';
import { ContactsScreen, type ContactDetail, type ContactsOverview } from './_screen';

const ROLES = ['customer', 'vendor', 'contractor', 'employee'];

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ id?: string; q?: string; role?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const role = ROLES.includes(sp.role ?? '') ? sp.role! : '';
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}) }).toString();
  const { year } = await currentPeriod();
  const [overview, accounts] = await Promise.all([
    api<ContactsOverview>(`/v1/master/contacts${qs ? `?${qs}` : ''}`),
    api<Account[]>(`/v1/accounts?year=${year}&period=13`),
  ]);
  // ไม่ได้เลือก = แถวแรก (แบบร่างไฮไลต์แถวแรก)
  const id = sp.id ?? overview.rows[0]?.id;
  const detail = id ? await api<ContactDetail>(`/v1/master/contacts/${encodeURIComponent(id)}`) : null;
  return (
    <Shell active="contacts">
      <ContactsScreen overview={overview} detail={detail} q={q} role={role}
        accounts={accounts.map((a) => ({ code: a.code, name: a.name }))} />
    </Shell>
  );
}
