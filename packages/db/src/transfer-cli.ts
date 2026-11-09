// pnpm --filter @innovera/db company:export <company_id> <file.json>   (READER_DATABASE_URL = console_reader)
// pnpm --filter @innovera/db company:import <file.json>                (MIGRATE_DATABASE_URL = migrator · ปลายทางต้อง migrate ถึงเวอร์ชันเดียวกัน)
import { readFileSync, writeFileSync } from 'node:fs';
import { exportCompany, importCompany, type CompanyDump } from './company-transfer.ts';

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'export' && a && b) {
  const dump = await exportCompany(process.env.READER_DATABASE_URL ?? 'postgres://console_reader:console_reader@localhost:56432/innovera', a);
  writeFileSync(b, JSON.stringify(dump));
  console.log(`export ${a} → ${b} (${Object.values(dump.acct).reduce((n, r) => n + r.length, 0)} แถว · schema ${dump.schemaVersion})`);
} else if (cmd === 'import' && a) {
  const counts = await importCompany(process.env.MIGRATE_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera', JSON.parse(readFileSync(a, 'utf8')) as CompanyDump, { withMemberships: true });
  console.log('import:', counts);
} else {
  console.error('ใช้: export <company_id> <file.json> | import <file.json>');
  process.exit(2);
}
