// สร้างบัญชีผู้ใช้คนแรกของ production (Wei เลือก "แบบ ข ใช้งานจริง" 2026-11-10) — ไม่มีข้อมูลตัวอย่าง ไม่มีรหัสผ่านในโค้ด
// รันบนเซิร์ฟเวอร์ (ต้องมี TTY เพื่อพิมพ์รหัสผ่านแบบซ่อน):
//   docker compose -f deploy/compose.prod.yaml --env-file deploy/.env run --rm -it id-api \
//     ./node_modules/.bin/tsx src/bootstrap-owner.ts --email you@example.com --name "ชื่อ นามสกุล" [--console-admin]
// หลังสร้าง: เข้าสู่ระบบที่ https://id.<DOMAIN> → ระบบบังคับตั้ง 2FA → สร้างบริษัทที่ https://app.<DOMAIN>/companies/new
//   (สร้างบริษัทแรก = สร้างองค์กร + แผนทดลอง + ผังบัญชีให้อัตโนมัติ · ผู้ใช้เป็น Owner)
// ปลอดภัย: ใช้ได้เฉพาะตอนยังไม่มีผู้ใช้ในระบบ (ป้องกันการตั้งรหัสผ่านทับบัญชีจริง)
import { checkPassword, hashPassword, ISSUE_TEXT } from '@innovera/auth';
import { createDb } from '@innovera/db';
import { createInterface } from 'node:readline';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
const consoleAdmin = process.argv.includes('--console-admin');
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !name) {
  console.error('ใช้: tsx src/bootstrap-owner.ts --email <อีเมล> --name "<ชื่อที่แสดง>" [--console-admin]');
  process.exit(2);
}
if (!process.stdin.isTTY) {
  console.error('ต้องรันแบบมี TTY (docker compose run -it) เพื่อพิมพ์รหัสผ่านแบบซ่อน');
  process.exit(2);
}

/** อ่านรหัสผ่านจาก TTY โดยไม่แสดงตัวอักษร */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

const db = createDb(process.env.DATABASE_URL ?? '', 2);
try {
  const existing = await db.withPublic((tx) => tx.selectFrom('public.app_user').select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirstOrThrow());
  if (Number(existing.n) > 0) {
    console.error(`มีผู้ใช้ในระบบแล้ว ${existing.n} คน — คำสั่งนี้ใช้สร้างผู้ใช้คนแรกเท่านั้น (ผู้ใช้ถัดไปให้ Owner เชิญจากหน้า ตั้งค่า → ผู้ใช้)`);
    process.exit(1);
  }
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
      email, display_name: name, password_hash: hash, mfa_enabled: false, email_verified_at: new Date(), terms_accepted_at: new Date(),
      totp_secret_enc: null, totp_last_step: null,
    }).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('public.password_history').values({ user_id: u.id, password_hash: hash }).execute();
    if (consoleAdmin) await tx.insertInto('public.innovera_staff').values({ user_id: u.id, role: 'admin' }).execute();
    return u.id;
  });
  console.log(`✓ สร้างผู้ใช้ ${email} แล้ว (id ${id})${consoleAdmin ? ' · เป็น admin ของ Console' : ''}`);
  console.log('ขั้นต่อไป: เข้าสู่ระบบที่ https://id.<DOMAIN> → ตั้ง 2FA ตามที่ระบบบังคับ → สร้างบริษัทแรกที่ https://app.<DOMAIN>/companies/new');
} finally {
  await db.close();
}
