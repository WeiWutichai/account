// B2 บันทึกรายวัน — design/project/ScreenJournal.dc.html · ?id= แก้ร่าง · ?no= ดูรายการที่ผ่านแล้ว (ลิงก์จากแยกประเภท)
import { api, type Context } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { JournalForm, type JournalView, type Template } from './form';

export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [ctx, accounts, contacts, templates] = await Promise.all([
    api<Context>('/v1/context'),
    api<{ code: string; name: string; is_control: boolean }[]>(`/v1/accounts?year=2569&period=13`),
    api<{ id: string; code: string; name: string }[]>('/v1/contacts'),
    api<Template[]>('/v1/journals/templates'),
  ]);
  const existing = sp.id ? await api<JournalView>(`/v1/journals/${sp.id}`) : sp.no ? await api<JournalView>(`/v1/journals/by-no/${encodeURIComponent(sp.no)}`) : null;
  return (
    <Shell active="journal">
      <JournalForm ctx={ctx} accounts={accounts} contacts={contacts} templates={templates} existing={existing} today={process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10)} />
    </Shell>
  );
}
