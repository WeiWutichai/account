// X2 องค์กรลูกค้า (tenants) ← design/project/ConsoleTenants.dc.html
import { Shell } from '../Shell';
import { Tag } from '../ui';
import { getFlags, getTenants } from '../lib/data';
import { needsAttention } from '../lib/rules';
import { Tenants } from './Tenants';

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const [tenants, flags, { org }] = await Promise.all([getTenants(), getFlags(), searchParams]);
  const attention = tenants.filter((t) => needsAttention(t)).length;
  return (
    <Shell active="tenants" crumb="Innovera Console / องค์กร (tenants)" status={<Tag tone={attention ? 'warning' : 'success'}>{tenants.length} องค์กร · {attention} ต้องดู</Tag>}>
      <Tenants tenants={tenants} flags={flags.filter((f) => f.scope === 'org')} initial={org ?? null} nowIso={new Date().toISOString()} />
    </Shell>
  );
}
