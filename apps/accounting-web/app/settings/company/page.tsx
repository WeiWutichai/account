// G1 ตั้งค่าบริษัท — design/project/ScreenSettings.dc.html · ข้อมูลจาก GET /v1/company-settings
import { api } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { CompanySettingsScreen, type CompanySettings } from './_screen';

export default async function CompanySettingsPage() {
  const s = await api<CompanySettings>('/v1/company-settings');
  return (
    <Shell active="settings">
      <CompanySettingsScreen settings={s} />
    </Shell>
  );
}
