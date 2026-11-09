// e2e: สมัคร → ยืนยันอีเมล (รหัสจาก public.outbox_email) → ตั้ง 2FA → เข้าสู่ระบบสำเร็จ → ไป accounting-web
//      → เจ้าขององค์กร (ผู้ใช้ dev) เชิญ → เปิด /invite/<token> → ยอมรับ · ออกจากระบบ → เข้าสู่ระบบใหม่ด้วย TOTP
// ภาพหน้าจอ (1440px) เก็บที่ docs/screens/M3/*.e2e.png
import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHOTS = `${ROOT}docs/screens/M3`;
const DB = process.env.E2E_DB_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera';
const ACCOUNTING = process.env.ACCOUNTING_WEB_URL ?? 'http://localhost:3010';
const DEV_STATE = `${ROOT}.playwright/dev-session.json`;
const DEV_ORG = '00000000-0000-4000-8000-0000000000aa';
const DEV_COMPANY = process.env.DEV_COMPANY_ID ?? '00000000-0000-4000-8000-000000000001';

const sql = (q: string): string => execFileSync('psql', [DB, '-At', '-c', q], { encoding: 'utf8' }).trim();
const outbox = (email: string, template: string, key: string): string =>
  sql(`select payload->>'${key}' from public.outbox_email where to_email = '${email}' and template = '${template}' order by id desc limit 1`);

/** TOTP (RFC 6238 · SHA-1 · 6 หลัก · 30 วินาที) — ตรงกับ @innovera/auth totpAt */
function totp(secretB32: string, ms = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretB32.replace(/[\s=]/gu, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/gu)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(ms / 30_000)));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
/** รอให้เข้าช่วงเวลา TOTP ใหม่ (กันรหัสซ้ำกับช่วงที่ใช้ไปแล้ว — id-api ปฏิเสธการใช้ซ้ำ) */
async function nextWindow(page: Page) { await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500); }
async function typeCode(page: Page, code: string) { await page.getByLabel('หลักที่ 1').click(); await page.keyboard.type(code); }

test('สมัคร → ยืนยันอีเมล → ตั้ง 2FA → เข้าสู่ระบบ → รับคำเชิญ → เข้าสู่ระบบใหม่ด้วย TOTP', async ({ page, browser }) => {
  const email = `e2e.${Date.now()}@example.co.th`;
  const password = 'ช้างเผือกเดินทางไกล-2569';

  // 1) ScreenSignup
  await page.goto('/signup');
  await page.getByLabel('ชื่อ-นามสกุล').fill('ทดสอบ อีทูอี');
  await page.getByLabel('อีเมลที่ใช้ทำงาน').fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: false }).first().fill(password);
  await page.getByRole('checkbox').first().check();
  await page.screenshot({ path: `${SHOTS}/ScreenSignup.filled.e2e.png`, fullPage: true });
  await page.getByRole('button', { name: 'สร้างบัญชีและส่งรหัสยืนยัน' }).click();

  // 2) ยืนยันอีเมล (TODO(Wei) T7: ไม่มีแบบร่าง)
  await page.waitForURL(/\/verify-email/u);
  await expect(page.getByText(/จะส่งรหัสยืนยัน 6 หลักไปที่อีเมลนี้/u)).toBeVisible();
  const code = outbox(email, 'verify_email', 'code');
  expect(code).toMatch(/^\d{6}$/u);
  await typeCode(page, code);
  await page.screenshot({ path: `${SHOTS}/VerifyEmail.e2e.png`, fullPage: true });
  await page.getByRole('button', { name: 'ยืนยันอีเมล' }).click();

  // 3) ScreenTwoFactor — ตั้งค่า 2FA ครั้งแรก
  await page.waitForURL(/\/2fa\?stage=setup/u);
  const keyEl = page.locator('code').first();
  await expect(keyEl).toHaveText(/[A-Z2-7]{4} /u);
  const secret = (await keyEl.textContent())!.replace(/\s/gu, '');
  await expect(page.locator('svg').first()).toBeVisible(); // QR
  await page.screenshot({ path: `${SHOTS}/ScreenTwoFactor.setup.e2e.png`, fullPage: true });
  await page.getByLabel('รหัส 6 หลัก').fill(totp(secret));
  await page.getByRole('button', { name: 'เปิดใช้ 2FA' }).click();
  const codes = page.locator('ol li:nth-child(4) span');
  await expect(codes).toHaveCount(10);
  await page.screenshot({ path: `${SHOTS}/ScreenTwoFactor.backup-codes.e2e.png`, fullPage: true });
  await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();

  // 4) เข้าสู่ระบบสำเร็จ → accounting-web (ปลายทางเริ่มต้น /companies)
  await page.waitForURL((u) => u.href.startsWith(ACCOUNTING), { timeout: 60_000 });
  expect(sql(`select mfa_enabled from public.app_user where email = '${email}'`)).toBe('t');

  // 5) ScreenInviteAccept — เจ้าขององค์กร dev เชิญผู้ใช้ใหม่ แล้วผู้ใช้ใหม่ยอมรับ
  if (existsSync(DEV_STATE)) {
    const owner = await browser.newContext({ storageState: DEV_STATE });
    const res = await owner.request.post('/api/id/v1/invites', { data: { orgId: DEV_ORG, companyId: DEV_COMPANY, email, role: 'accountant' } });
    expect(res.status(), await res.text()).toBe(201);
    await owner.close();
    const token = outbox(email, 'invite', 'token');
    await page.goto(`/invite/${token}`);
    await expect(page.getByText('ตรงกับบัญชีที่เข้าสู่ระบบอยู่ ✓', { exact: false })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/ScreenInviteAccept.e2e.png`, fullPage: true });
    await page.getByRole('button', { name: 'ยอมรับและเข้าร่วม' }).click();
    await page.waitForURL((u) => u.href.startsWith(ACCOUNTING));
    expect(sql(`select count(*) from public.company_membership m join public.app_user u on u.id = m.user_id where u.email = '${email}' and m.company_id = '${DEV_COMPANY}'`)).toBe('1');
  }

  // 6) ScreenProfile → ออกจากระบบ → ScreenLogin → ScreenTwoFactor (ยืนยันรหัส) → สำเร็จ
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'บัญชีของฉัน — Innovera ID' })).toBeVisible();
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).first().click();
  await page.waitForURL(/\/login/u);
  await page.getByLabel('อีเมล').fill(email);
  await page.getByLabel('รหัสผ่าน').fill(password);
  await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
  await page.waitForURL(/\/2fa\?stage=mfa/u);
  await expect(page.getByText(/เข้าสู่ระบบในชื่อ e2e\.\d+@example…/u)).toBeVisible();
  await nextWindow(page); // รหัสช่วงที่ใช้ตอนเปิด 2FA ใช้ซ้ำไม่ได้
  await typeCode(page, totp(secret));
  await page.screenshot({ path: `${SHOTS}/ScreenTwoFactor.mfa.e2e.png`, fullPage: true });
  await page.getByRole('button', { name: 'ยืนยันและเข้าสู่ระบบ' }).click();
  await page.waitForURL((u) => u.href.startsWith(ACCOUNTING), { timeout: 60_000 });
});

test('ลืมรหัสผ่าน → ตรวจอีเมล (นับถอยหลัง) → ตั้งรหัสผ่านใหม่จากลิงก์ → ขอรหัส 2FA', async ({ page }) => {
  const email = sql("select email from public.app_user where email like 'e2e.%@example.co.th' order by created_at desc limit 1");
  test.skip(!email, 'ต้องรันเทสต์สมัครก่อน');
  await page.goto('/password/reset');
  await page.getByLabel('อีเมลของบัญชี Innovera ID').fill(email);
  await page.getByRole('button', { name: 'ส่งลิงก์ตั้งรหัสผ่านใหม่' }).click();
  await expect(page.getByText(/ส่งแล้วไปที่ e2e\.\d+@…/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งอีเมลอีกครั้ง' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/ScreenPasswordReset.step2.e2e.png`, fullPage: true });
  const token = outbox(email, 'reset_password', 'token');
  await page.goto(`/password/reset?token=${encodeURIComponent(token)}`);
  await page.getByLabel('รหัสผ่านใหม่').first().fill('นกกระจอกบินข้ามทุ่ง-2570');
  await page.getByLabel('ยืนยันรหัสผ่านใหม่').fill('นกกระจอกบินข้ามทุ่ง-2570');
  await page.screenshot({ path: `${SHOTS}/ScreenPasswordReset.step3.e2e.png`, fullPage: true });
  await page.getByRole('button', { name: 'บันทึกรหัสผ่านและเข้าสู่ระบบ' }).click();
  await page.waitForURL(/\/2fa\?stage=mfa/u); // "หลังตั้งใหม่ระบบจะขอรหัส 2FA ตามปกติ"
});
