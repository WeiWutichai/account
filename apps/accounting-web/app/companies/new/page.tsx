// A3 สร้างบริษัทใหม่ — design/project/ScreenCompanyCreate.dc.html (ตัวช่วย 5 ขั้น · แบบร่างแสดงขั้น 2 "ปีบัญชี & ผังบัญชี")
// ขั้น 3 ยอดยกมา = /setup/opening-balance (ไปผ่าน /companies/select ซึ่งตั้ง cookie บริษัทให้)
import { css, href } from '@innovera/ui';
import { idApi, planLabel, type CompanyItem } from '../../lib/id';
import { CreateWizard, type PlanNote } from './wizard';

interface OrgOverview { companies: { id: string }[]; subscription: { plan: string; companyLimit: number } | null }

export default async function CompanyCreatePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const sp = await searchParams;
  const companies = await idApi<CompanyItem[]>('/v1/companies');
  // บริษัทใหม่เข้าองค์กรแรกที่ผู้ใช้เป็นเจ้าของ (id-api createCompany) → นับบริษัทของแผนจากองค์กรนั้น
  const owned = companies.find((c) => c.org_role === 'owner');
  let plan: PlanNote | null = null;
  if (owned) {
    const org = await idApi<OrgOverview>(`/v1/orgs/${owned.org_id}`);
    if (org.subscription) plan = { nth: org.companies.length + 1, plan: planLabel(org.subscription.plan), limit: org.subscription.companyLimit };
  }
  // วันนี้ตามนาฬิกาของแอป (APP_TODAY ใน dev) — ใช้หาวันเริ่มปีบัญชีถัดไปเป็นค่าตั้งต้นของ "เริ่มใช้ระบบตั้งแต่"
  const today = process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);
  return (
    <div style={css("min-height: 1000px; background: #f4f4f4; color: #161616; font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.6; display: flex; flex-direction: column")}>
      <header style={css('height: 48px; background: #161616; color: #f4f4f4; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; font-size: 14px')}>
        <div style={css('display: flex; align-items: center; gap: 12px')}><span style={css('width: 24px; height: 24px; background: #0f62fe; display: inline-block')} /><span style={css('font-weight: 600')}>Innovera</span><span style={css('color: #a8a8a8')}>Accounting</span></div>
        <a href={href('companies')} style={css('color: #c6c6c6; text-decoration: none')}>← กลับไปเลือกบริษัท</a>
      </header>
      <CreateWizard initialStep={sp.step === '2' ? 2 : 1} plan={plan} today={today} planHref={href('plan')} companiesHref={href('companies')} />
    </div>
  );
}
