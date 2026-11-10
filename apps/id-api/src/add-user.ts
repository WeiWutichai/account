// เพิ่มผู้ใช้ทดสอบ/ผู้ใช้เพิ่ม ใน production โดยไม่ต้องใช้อีเมล (ระบบยังไม่ต่อผู้ให้บริการอีเมล · คำเชิญส่งไม่ได้) — Wei ขอ demo@innovera.co.th 2026-11-10
// รันบนเซิร์ฟเวอร์ (ต้องมี TTY — พิมพ์รหัสผ่านแบบซ่อน · ไม่มีรหัสผ่านในโค้ด):
//   docker compose -f deploy/compose.prod.yaml --env-file deploy/.env run --rm -it id-api \
//     ./node_modules/.bin/tsx src/add-user.ts --email demo@innovera.co.th --name "Demo" [--role accounting_manager] [--company <ชื่อหรือ id>] [--approval-limit 1000000]
// - ผูกกับบริษัทที่ระบุ (ไม่ระบุ + มีบริษัทเดียว = บริษัทนั้น) และเป็นสมาชิกองค์กรของบริษัทนั้น (member)
// - บทบาทตั้งต้น accounting_manager: อนุมัติใบสำคัญจ่ายที่ Owner สร้างได้ (แบ่งหน้าที่ — ผู้สร้างอนุมัติเองไม่ได้)
// - เข้าสู่ระบบครั้งแรกระบบขอให้ตั้ง 2FA ถ้าองค์กรบังคับ · มีผู้ใช้อีเมลนี้แล้ว = หยุด (ไม่ทับรหัสผ่าน)
import { checkPassword, COMPANY_ROLES, hashPassword, ISSUE_TEXT, type CompanyRole } from '@innovera/auth';
import { createDb } from '@innovera/db';
import { createInterface } from 'node:readline';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
const role = (arg('role') ?? 'accounting_manager') as CompanyRole;
const companyArg = arg('company')?.trim();
const limit = arg('approval-limit') ?? (role === 'accounting_manager' ? '1000000.00' : null);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !name) {
  console.error('ใช้: tsx src/add-user.ts --email <อีเมล> --name "<ชื่อ>" [--role accounting_manager|accountant|viewer|…] [--company <ชื่อหรือ id>] [--approval-limit 1000000]');
  process.exit(2);
}
if (!COMPANY_ROLES.includes(role) || role === 'owner' || role === 'custom') {
  console.error(`บทบาทต้องเป็นหนึ่งใน ${COMPANY_ROLES.filter((r) => r !== 'owner' && r !== 'custom').join(', ')}`);
  process.exit(2);
}
if (limit !== null && !/^\d+(\.\d{1,2})?$/u.test(limit)) { console.error('วงเงินอนุมัติต้องเป็นตัวเลข'); process.exit(2); }
if (!process.stdin.isTTY) { console.error('ต้องรันแบบมี TTY (docker compose run -it) เพื่อพิมพ์รหัสผ่านแบบซ่อน'); process.exit(2); }

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    out._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

const db = createDb(process.env.DATABASE_URL ?? '', 2);
try {
  const exists = await db.withPublic((tx) => tx.selectFrom('public.app_user').select('id').where('email', '=', email).executeTakeFirst());
  if (exists) { console.error(`มีผู้ใช้ ${email} แล้ว — ไม่ทับรหัสผ่าน (เปลี่ยนสิทธิ์ที่หน้า ตั้งค่า → ผู้ใช้และสิทธิ์)`); process.exit(1); }
  const companies = await db.withPublic((tx) => tx.selectFrom('public.company').select(['id', 'name_th', 'org_id']).execute());
  const pick = companyArg ? companies.filter((c) => c.id === companyArg || c.name_th === companyArg) : companies;
  if (pick.length !== 1) {
    console.error(companies.length === 0 ? 'ยังไม่มีบริษัท — ให้ Owner สร้างบริษัทแรกที่ /companies/new ก่อน'
      : `ระบุ --company ให้ชัด (มี ${companies.length} บริษัท): ${companies.map((c) => `${c.name_th} (${c.id})`).join(' · ')}`);
    process.exit(1);
  }
  const company = pick[0]!;
  let password = '';
  for (;;) {
    password = await askHidden(`ตั้งรหัสผ่านสำหรับ ${email} (อย่างน้อย 12 ตัวอักษร): `);
    const confirm = await askHidden('พิมพ์รหัสผ่านอีกครั้ง: ');
    const issues = await checkPassword(password, { email, confirm });
    if (!issues.length) break;
    console.error(`  ✗ ${issues.map((i) => ISSUE_TEXT[i]).join(' · ')} — ลองใหม่`);
  }
  const hash = await hashPassword(password);
  password = '';
  const id = await db.withPublic(async (tx) => {
    const u = await tx.insertInto('public.app_user').values({
      email, display_name: name, password_hash: hash, mfa_enabled: false, email_verified_at: new Date(), terms_accepted_at: new Date(), totp_secret_enc: null, totp_last_step: null,
    }).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('public.password_history').values({ user_id: u.id, password_hash: hash }).execute();
    await tx.insertInto('public.org_membership').values({ org_id: company.org_id, user_id: u.id, org_role: 'member', expires_at: null }).onConflict((oc) => oc.columns(['org_id', 'user_id']).doNothing()).execute();
    await tx.insertInto('public.company_membership').values({ company_id: company.id, user_id: u.id, company_role: role, approval_limit: limit, permissions: null, expires_at: null, last_used_at: null }).execute();
    return u.id;
  });
  console.log(`✓ เพิ่มผู้ใช้ ${email} (${role}${limit ? ` · วงเงินอนุมัติ ${limit}` : ''}) ในบริษัท ${company.name_th} แล้ว (id ${id})`);
} finally {
  await db.close();
}
