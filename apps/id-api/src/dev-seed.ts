// pnpm db:seed (ต่อจาก packages/db dev-seed) — ผู้ใช้ Innovera ID สำหรับ dev/e2e · DEV ONLY
// บัญชี: wei@innovera.co.th · รหัสผ่าน DEV_PASSWORD ด้านล่าง · 2FA คีย์ JBSWY3DPEHPK3PXP (คีย์ตัวอย่างในแบบร่าง ScreenTwoFactor)
// เป็น Owner ของบริษัท dev + องค์กร Innovera Group (แผน Business trial)
import { encrypt, hashPassword } from '@innovera/auth';
import { createDb } from '@innovera/db';
import { DEV_DATA_KEY } from './config.ts';

if (process.env.NODE_ENV === 'production') throw new Error('dev-seed ห้ามรันใน production');
export const DEV_USER = { email: 'wei@innovera.co.th', name: 'Wei [นามสกุล]', password: 'innovera-dev-password-2569', totp: 'JBSWY3DPEHPK3PXP' };
const COMPANY_ID = process.env.DEV_COMPANY_ID ?? '00000000-0000-4000-8000-000000000001';
const ORG_ID = '00000000-0000-4000-8000-0000000000aa';

const db = createDb(process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera', 2);
const pw = await hashPassword(DEV_USER.password);
await db.withPublic(async (tx) => {
  const u = await tx.insertInto('public.app_user').values({
    email: DEV_USER.email, display_name: DEV_USER.name, password_hash: pw, mfa_enabled: true, email_verified_at: new Date(), terms_accepted_at: new Date(),
    totp_secret_enc: encrypt(DEV_USER.totp, process.env.ID_DATA_KEY ?? DEV_DATA_KEY), totp_last_step: null,
  }).onConflict((oc) => oc.column('email').doUpdateSet({ password_hash: pw, mfa_enabled: true, totp_secret_enc: encrypt(DEV_USER.totp, process.env.ID_DATA_KEY ?? DEV_DATA_KEY), totp_last_step: null }))
    .returning('id').executeTakeFirstOrThrow();
  await tx.insertInto('public.org_membership').values({ org_id: ORG_ID, user_id: u.id, org_role: 'owner', expires_at: null }).onConflict((oc) => oc.columns(['org_id', 'user_id']).doNothing()).execute();
  await tx.insertInto('public.company_membership').values({ company_id: COMPANY_ID, user_id: u.id, company_role: 'owner', approval_limit: null, permissions: null, expires_at: null, last_used_at: null })
    .onConflict((oc) => oc.columns(['company_id', 'user_id']).doNothing()).execute();
  await tx.insertInto('public.subscription').values({ org_id: ORG_ID, plan_code: 'business', status: 'trialing', renews_at: '2027-03-01', company_limit: 3, seat_limit: 10, trial_ends_at: null })
    .onConflict((oc) => oc.column('org_id').doNothing()).execute();
});
console.log(`ผู้ใช้ dev: ${DEV_USER.email} (Owner ของบริษัท dev)`);
await db.close();
