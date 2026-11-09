// B3 สูตรลงบัญชี — design/project/ScreenFormula.dc.html
import { css, TopBar } from '@innovera/ui';
import { api } from '../../lib/api';
import { Shell } from '../../lib/shell';
import { RulesEditor, type Rule } from './editor';

export default async function RulesPage() {
  const [rules, accounts] = await Promise.all([api<Rule[]>('/v1/rules'), api<{ code: string; name: string }[]>('/v1/accounts?year=2569&period=13')]);
  return (
    <Shell active="formula">
      {/* TODO(M3): สิทธิ์จริงจาก Innovera ID */}
      <TopBar crumb="บัญชี / สูตรลงบัญชี" right={<span style={css('color: #525252')}>สิทธิ์: ผู้ดูแลระบบ</span>} />
      <RulesEditor rules={rules} accounts={accounts} />
    </Shell>
  );
}
