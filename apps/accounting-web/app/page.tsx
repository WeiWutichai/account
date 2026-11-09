// S1 หน้าแรก — คิวงาน · design/project/Main.dc.html (Sidebar active="home")
// ตัวเลขฝั่งขายมาจาก accounting-api · บิลซื้อ (M5) / ธนาคาร-ภาษี-ปิดงวด (M6) ยังไม่มีโมดูล → "—"
import { thaiMonth } from '@innovera/ui';
import { api, type Context } from './lib/api';
import { Shell } from './lib/shell';
import { addDays, docHref, docNo, type Account, type DocDetail, type DocRow, whenText } from './sales/_lib/doc';
import { Home, type HomeData } from './sales/_lib/Home';
import { fromCents, toCents } from './sales/_lib/num';
import { appToday } from './sales/_lib/server';

export const SERVICE_HOME = 'accounting-web';
const PSTATUS: Record<string, string> = { open: 'เปิด', soft_closed: 'ปิดอ่อน', hard_closed: 'ปิดแข็ง' };
const WEEKDAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export default async function HomePage() {
  const today = appToday();
  const ctx = await api<Context>('/v1/context');
  const p = ctx.period;
  const year = p?.fiscal_year ?? Number(today.slice(0, 4)) + 543;
  const period = p?.period_no ?? Number(today.slice(5, 7));
  const [docs, accounts] = await Promise.all([api<DocRow[]>('/v1/documents'), api<Account[]>(`/v1/accounts?year=${year}&period=${period}`)]);

  const pending = docs.filter((d) => d.status === 'pending_approval');
  const details = await Promise.all(pending.slice(0, 10).map((d) => api<DocDetail>(`/v1/documents/${d.id}`)));
  const open = docs.filter((d) => (d.doc_type === 'IV' || d.doc_type === 'DN') && d.status === 'posted' && toCents(d.outstanding) > 0n);
  const week = addDays(today, 7);
  const dueSoon = open.filter((d) => d.due_date && d.due_date >= today && d.due_date <= week);
  // งวดบัญชี = เดือนปฏิทิน (ปีบัญชี ม.ค.–ธ.ค. ของบริษัทตัวอย่าง) — TODO(M6): ปีบัญชีที่ไม่เริ่ม ม.ค.
  const ym = `${year - 543}-${String(period).padStart(2, '0')}`;
  const bal = (code: string) => accounts.find((a) => a.code === code)?.balance ?? '0.00';
  const bankName = accounts.find((a) => a.code === '1100100')?.name ?? '';
  const bank = /\[[^\]]+\]/u.exec(bankName)?.[0] ?? '';
  const pl = accounts.filter((a) => a.type === 'revenue' || a.type === 'expense').reduce((s, a) => s + toCents(a.balance), 0n);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];

  const data: HomeData = {
    topLine: `วัน${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${thaiMonth(m)} ${y + 543} · งวด ${period}/${year} ${p ? PSTATUS[p.status] ?? p.status : ''} · ปิดงวด ${period}/${year} เหลือ — ขั้น`,
    pending: { count: pending.length, iv: pending.filter((x) => x.doc_type === 'IV').length },
    arDue: { total: fromCents(dueSoon.reduce((s, x) => s + toCents(x.outstanding), 0n)), count: dueSoon.length, overdue: open.filter((x) => x.due_date && x.due_date < today).length },
    // TODO(M5/backend): AP/EXP/JV รออนุมัติ · ชื่อผู้ส่ง (document_event.actor → ชื่อจาก Innovera ID)
    queue: details.map((x) => {
      const sent = [...x.events].reverse().find((e) => e.event === 'submitted');
      return { id: x.doc.id, no: docNo(x.doc), href: docHref(x.doc), contact: x.contact?.name ?? '—', sent: sent ? whenText(sent.at, today) : '—', total: x.doc.grand_total, sender: '—', approvable: true };
    }),
    close: { title: `ปิดงวด ${period}/${year}`, draftsLeft: docs.filter((x) => (x.status === 'draft' || x.status === 'pending_approval') && x.issue_date.startsWith(ym)).length, bankLabel: bank, month: thaiMonth(period) },
    cash: { bankLabel: `เงินฝากออมทรัพย์ ${bank} (GL)`, bank: bal('1100100'), ar: bal('1130100'), ap: bal('2110100'), profitLabel: `กำไรสุทธิ ${thaiMonth(1)}–${thaiMonth(period)}`, profit: fromCents(-pl) },
  };
  return (
    <Shell active="home">
      <Home data={data} />
    </Shell>
  );
}
