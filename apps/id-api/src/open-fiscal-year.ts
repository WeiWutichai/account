// เปิดปีบัญชี (สร้างงวด 0–13) ให้บริษัทใน production — ใช้เมื่อเอกสารขึ้น "ไม่มีงวดบัญชีสำหรับวันที่ …"
// รันบนเซิร์ฟเวอร์: bash deploy/deploy-vps.sh year 2569 [--company <ชื่อหรือ id>]
// idempotent (เปิดซ้ำ = ไม่สร้างเพิ่ม) · บันทึก audit log (period.open_year) · ไม่แตะเอกสาร/ยอดใด ๆ
import { createDb } from '@innovera/db';
import { openFiscalYear } from '@innovera/db/close-ops';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const year = Number(arg('year'));
const companyArg = arg('company')?.trim();
if (!Number.isInteger(year)) { console.error('ใช้: tsx src/open-fiscal-year.ts --year <ปี พ.ศ. เช่น 2569> [--company <ชื่อหรือ id>]'); process.exit(2); }

const db = createDb(process.env.DATABASE_URL ?? '', 2);
try {
  const companies = await db.withPublic((tx) => tx.selectFrom('public.company').select(['id', 'name_th']).execute());
  const pick = companyArg ? companies.filter((c) => c.id === companyArg || c.name_th === companyArg) : companies;
  if (pick.length !== 1) {
    console.error(companies.length === 0 ? 'ยังไม่มีบริษัท' : `ระบุ --company ให้ชัด (มี ${companies.length} บริษัท): ${companies.map((c) => `${c.name_th} (${c.id})`).join(' · ')}`);
    process.exit(1);
  }
  const c = pick[0]!;
  const r = await openFiscalYear(db, c.id, { userId: null, role: 'owner' }, year);
  console.log(r.created ? `✓ เปิดปีบัญชี ${year} ให้ ${c.name_th} แล้ว (สร้าง ${r.created} งวด)` : `✓ ${c.name_th} มีงวดปี ${year} ครบอยู่แล้ว — ไม่ได้สร้างเพิ่ม`);
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
