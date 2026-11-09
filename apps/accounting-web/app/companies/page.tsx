// A2 เลือกบริษัท — design/project/ScreenCompanyPicker.dc.html (หัวหน้าของตัวเอง ไม่มี Sidebar ตามแบบร่าง)
import { COMPANY_ROLE_LABEL, type CompanyRole } from '@innovera/auth';
import { css, href, thaiDate, thaiMonth } from '@innovera/ui';
import { cookies } from 'next/headers';
import { bkkThaiDate, idApi, maskEmail, planLabel, type CompanyItem, type Me } from '../lib/id';
import { COOKIE } from '../lib/session';
import { CompanyList, type Card, type Group } from './picker';

const STEP_NAME = ['ข้อมูลบริษัท', 'ปีบัญชี & ผังบัญชี', 'ยอดยกมา', 'ภาษี & เลขที่เอกสาร', 'ทีมและแอปเชื่อมต่อ']; // ชื่อขั้นตาม ScreenCompanyCreate
const READ_ONLY = new Set(['viewer', 'auditor']);
const MEMBER_ORG_ROLES = new Set(['owner', 'admin', 'billing_admin', 'member']);
const PLAN_ADMIN = new Set(['owner', 'admin', 'billing_admin']);

/** '01-01' → 'ม.ค.–ธ.ค.' · '04-01' → 'เม.ย.–มี.ค.' */
function fiscalLabel(start: string): string {
  const m = Number(start.slice(0, 2)) || 1;
  return `${thaiMonth(m)}–${thaiMonth(((m + 10) % 12) + 1)}`;
}
/** ตัวย่อในกล่อง 48px — ตัดคำนำหน้านิติบุคคลและวงเล็บเหลี่ยมออก แล้วใช้อักษรตัวแรก */
function initials(name: string): string {
  const core = name.replace(/^(บริษัท|บจก\.|หจก\.|ห้างหุ้นส่วนจำกัด)\s*/u, '').replace(/[[\]]/gu, '').trim();
  return (core.charAt(0) || '?').toUpperCase();
}
const roleLabel = (r: string): string => COMPANY_ROLE_LABEL[r as CompanyRole] ?? r;

function toCard(c: CompanyItem, current: string | undefined, guest: boolean): Card {
  if (!c.setup_done) {
    const step = Math.min(5, Math.max(1, c.setup_step));
    return { id: c.id, name: c.name_th, initials: initials(c.name_th), current: c.id === current, sub: `สร้าง ${bkkThaiDate(c.created_at)} · ยังตั้งค่าไม่เสร็จ (ขั้น ${step}/5 ${STEP_NAME[step - 1]})`, state: 'setup' };
  }
  const parts = guest ? [] : [c.branch_code === '00000' ? 'สำนักงานใหญ่' : `สาขา ${c.branch_code}`, `ปีบัญชี ${fiscalLabel(c.fiscal_year_start)}`];
  parts.push(`บทบาท ${roleLabel(c.company_role)}`);
  if (c.expires_at) parts.push(`เข้าถึงถึง ${thaiDate(c.expires_at.slice(0, 10))}`);
  if (c.id === current) parts.push('ใช้งานล่าสุด');
  return { id: c.id, name: c.name_th, initials: initials(c.name_th), current: c.id === current, sub: parts.join(' · '), state: READ_ONLY.has(c.company_role) ? 'readonly' : 'active' };
}

export default async function CompanyPickerPage() {
  const [me, jar] = await Promise.all([idApi<Me>('/v1/me'), cookies()]);
  const current = jar.get(COOKIE.company)?.value;
  const groups: Group[] = [];
  for (const c of me.companies) {
    let g = groups.find((x) => x.orgId === c.org_id);
    if (!g) {
      const member = MEMBER_ORG_ROLES.has(c.org_role ?? '');
      g = {
        orgId: c.org_id,
        title: member ? `องค์กร: ${c.org_name} · แผน ${planLabel(c.plan_code)} (${c.company_limit ?? '—'} บริษัท / ${c.seat_limit ?? '—'} ที่นั่ง)` : `องค์กร: ${c.org_name} · คุณถูกเชิญเป็นที่ปรึกษา`,
        planLink: member && PLAN_ADMIN.has(c.org_role ?? ''),
        member,
        cards: [],
      };
      groups.push(g);
    }
    g.cards.push(toCard(c, current, !g.member));
  }

  return (
    <div style={css("min-height: 1000px; background: #f4f4f4; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; display: flex; flex-direction: column")}>
      <header style={css('height: 48px; background: #161616; color: #f4f4f4; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; font-size: 14px')}>
        <div style={css('display: flex; align-items: center; gap: 12px')}><span style={css('width: 24px; height: 24px; background: #0f62fe; display: inline-block')} /><span style={css('font-weight: 600')}>Innovera</span><span style={css('color: #a8a8a8')}>Accounting</span></div>
        <div style={css('display: flex; align-items: center; gap: 16px')}>
          {/* TODO(M7): ลิงก์ไปแอป TMS จริง (ScreenApps) — ตอนนี้ไปหน้าแอปเชื่อมต่อ */}
          <a href={href('apps')} style={css('color: #c6c6c6; text-decoration: none')}>TMS ↗</a>
          <a href={href('profile')} style={css('color: #c6c6c6; text-decoration: none')}>{me.user.display_name} · {maskEmail(me.user.email)}</a>
          <form method="post" action="/companies/logout" style={css('display: inline')}>
            <button type="submit" style={css('color: #c6c6c6; text-decoration: none; background: none; border: 0; padding: 0; font: inherit; cursor: pointer')}>ออกจากระบบ</button>
          </form>
        </div>
      </header>
      <main style={css('flex: 1; display: flex; justify-content: center; padding: 48px 32px; box-sizing: border-box')}>
        <CompanyList groups={groups} companyCount={me.companies.length} planHref={href('plan')} />
      </main>
    </div>
  );
}
