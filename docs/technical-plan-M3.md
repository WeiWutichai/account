# Technical Plan — M3 Innovera ID (ขั้นต่ำ)

> สถานะ: **อนุมัติล่วงหน้า** (Wei สั่งทำต่อเนื่องข้ามคืน 2026-11-09) · อ้างอิง `PLAN.md` §2 (Innovera ID), §6 (M3) · Spec v2 §3, §5.1 · แบบร่าง 12 ไฟล์ใน `docs/page-map.md` (A1–A7, G2)

## 1. ส่งมอบ / Gate (PLAN §6)
ส่งมอบ: signup / ยืนยันอีเมล / login / 2FA (TOTP + backup codes) / lockout / ลืมรหัสผ่าน / เชิญ + รับคำเชิญ / บทบาทองค์กร · UI A1–A7 + G2 · OAuth 2.1 server **เลื่อนไป M7**
Gate: unit ≥ 90% ใน `packages/auth` · e2e: signup → 2FA → invite → accept · OWASP ASVS L2 checklist (`docs/asvs-l2-M3.md`)

## 2. โครง
- **`packages/auth`** (pure TS, ไม่พึ่ง Nest — แบบเดียวกับ ledger): Argon2id (`@node-rs/argon2`, m=19 MiB t=2 p=1 ตาม OWASP) · TOTP RFC 6238 (SHA-1 · 6 หลัก · 30 วิ · ±1 ช่วง · ห้ามใช้รหัสซ้ำในช่วงเดิม) เขียนเองบน `node:crypto` + test vector ของ RFC · backup codes 10 ชุด (`@node-rs/bcrypt`, ใช้ได้ครั้งเดียว) · นโยบายรหัสผ่าน (≥ 12 ตัว · ตรวจรายการรั่วไหลแบบ offline top-list · ห้ามซ้ำ 5 รหัสล่าสุด) · token สุ่ม (32 byte, เก็บเฉพาะ SHA-256) · JWT EdDSA (`jose`)
- **`apps/id-api`** (Nest, :4100): `/v1/auth/*` signup · verify-email (OTP 6 หลัก) · login · 2fa (verify / setup / enable / backup) · refresh · logout · password/forgot · password/reset · `/v1/me` · `/v1/orgs/:id/members|invites` · `/v1/invites/:token` (ดู/รับ/ปฏิเสธ) · `/v1/companies` (รายการ · สร้าง) · `/.well-known/jwks.json`
- **Session**: access JWT 15 นาที (claims: sub, sid, amr) ใน cookie `inn_at` (HttpOnly · Secure ใน production · SameSite=Lax · Domain = โดเมนแม่ ใช้ร่วมทุกแอป) · refresh token แบบ opaque หมุนทุกครั้ง (`inn_rt`, path `/v1/auth`) · ใช้ refresh ซ้ำ = เพิกถอนทั้ง family · อายุ session ตามนโยบายองค์กร (แบบร่าง: 12 ชม.)
- **pending-session** หลังรหัสผ่านถูกแต่ยังไม่ผ่าน 2FA: cookie `inn_mfa` ลงนาม HMAC ผูก IP/UA อายุ 5 นาที (PLAN §2 แนว PropSpace P1.8) · "เชื่อถืออุปกรณ์นี้ 30 วัน" = cookie `inn_dev` (HMAC ของ user+device id ที่เก็บใน DB เพิกถอนได้)
- **Lockout** (Redis): รหัสผ่านผิด 10 ครั้ง/บัญชี/15 นาที + 50 ครั้ง/IP → ล็อก 15 นาที · 2FA ผิด 5 ครั้ง → ล็อก 15 นาที (ข้อความในแบบร่าง ScreenTwoFactor) · counter แบบ atomic `INCR` + `EXPIRE`
- **อีเมล**: v1 ใช้ `outbox_email` (ตาราง) + log ใน dev · ตัวส่งจริง (SMTP/SES) = TODO(M3.5) · ข้อความตอบกลับ "ลืมรหัสผ่าน" เหมือนกันทุกกรณี (กันเดาบัญชี)
- **accounting-api**: guard อ่าน `inn_at` → ตรวจ JWT ด้วย JWKS ของ id-api → ตรวจ `company_membership` ของบริษัทที่เลือก (header `x-company-id` จาก client ตาม FR-TN-04) → role/สิทธิ์ต่อ request · header dev `x-role` ใช้ได้เฉพาะ `NODE_ENV=test` เท่านั้น

## 3. ฐานข้อมูล (migration 0006, public — ไม่ใช่ข้อมูลบัญชี ไม่ใช้ RLS)
`app_user` + `email_verified_at, totp_secret_enc, totp_last_step, locale, phone_masked, last_login_at` · `password_history` · `backup_code` · `auth_session` (refresh family, hash, ip, ua, expires, revoked) · `trusted_device` · `email_token` (verify/reset · hash · หมดอายุ · ใช้ครั้งเดียว) · `outbox_email` · `login_event` (บันทึกการเข้าสู่ระบบ — แท็บในแบบร่าง ScreenOrgMembers) · `organization` + `security_policy jsonb` (2FA บังคับ · อายุ session) · `org_membership` + `expires_at` (Guest) · `company_membership` + `permissions jsonb` (override รายคน) + `scope` + `expires_at` + `require_2fa` · `invite` + `kind` (member/auditor) + `invited_by` + `revoked_at` + `declined_at` · `company` + `setup_step` (ขั้นที่ค้างของตัวช่วยตั้งค่า) + `modules jsonb` + `chart_template`
- TOTP secret เข้ารหัส AES-256-GCM ด้วยคีย์จาก env (`ID_DATA_KEY`) — ไม่เก็บ plaintext
- ทุก migration ย้อนได้ (down) · test up/down/up เดิม

## 4. บทบาท
- องค์กร: owner / admin / billing_admin / member / guest (มีอยู่แล้วใน M1 ตรงกับ ScreenOrgMembers)
- บริษัท (ตามแบบร่าง ScreenUsers/ScreenUserEdit): `owner` · `accounting_manager` · `accountant` · `ar_clerk` · `petty_cash_holder` · `viewer` · `auditor` · `custom` + เมทริกซ์สิทธิ์ (พื้นที่ × อ่าน/สร้าง/ผ่านรายการ/ยกเลิก) ตั้งต้นจากบทบาท ปรับรายคนได้ · ค่าตั้งต้นของเมทริกซ์ = ตารางย่อใน ScreenUsers.dc.html
- **TODO(Wei) T6**: Spec v2 §3.1 ใช้ชุด owner/admin/accountant/staff/viewer/auditor แต่แบบร่างใช้ชุดข้างบน → ทำตามแบบร่าง (ลำดับความสำคัญ 2 > 3) แต่**ต้องให้ Wei ยืนยัน**

## 5. UI
- id-web (:3100): ScreenLogin · ScreenSignup · ScreenTwoFactor · ScreenPasswordReset · ScreenInviteAccept · ScreenProfile · ScreenOrgMembers · ScreenPlan
- accounting-web (:3010): ScreenCompanyPicker (`/companies`) · ScreenCompanyCreate (`/companies/new`) · ScreenUsers (`/settings/users`) · ScreenUserEdit (`/settings/users/[id]`)
- ปุ่ม SSO (Google Workspace / Microsoft 365) · ส่งรหัสทาง SMS · Group view · SAML → แสดงตามแบบร่างแต่ยังไม่ทำงาน (TODO Phase 2/M7 พร้อมข้อความในโค้ด) — **ไม่ตัดออกจากหน้าจอ** ตามกติกา 1 หน้าจอ = 1 ไฟล์
- ข้อความ Phase 2 (Subscription) ในแบบร่างคงไว้ตามไฟล์

## 6. Tests
1. `packages/auth`: RFC 6238 vectors · argon2 verify/needsRehash · backup code ใช้ครั้งเดียว · นโยบายรหัสผ่าน · token hash · JWT sign/verify/หมดอายุ — coverage ≥ 90% (vitest `--coverage`)
2. id-api (DB + Redis จริง): signup → verify → login → 2FA setup/enable → logout → login + TOTP · lockout 5 ครั้ง · refresh reuse → เพิกถอน family · reset ไม่บอกว่ามีบัญชีหรือไม่ · reset ห้ามซ้ำ 5 รหัส · invite → accept ด้วยอีเมลตรง/ไม่ตรง/หมดอายุ/ปฏิเสธ
3. accounting-api: ไม่มี cookie → 401 · ไม่มี membership → 403 · มี membership → ได้ข้อมูลบริษัทนั้นเท่านั้น
4. e2e (Playwright): signup → 2FA → invite → accept
5. ASVS L2 checklist ข้อที่เกี่ยวกับ V2 (authentication) V3 (session) V4 (access control) — บันทึกผลรายข้อ

## 7. ไม่อยู่ใน M3
OAuth 2.1/PKCE server (M7) · SSO Google/Microsoft/SAML (Phase 2) · SMS · ชำระเงิน/เปลี่ยนแผน (Phase 2 — ScreenPlan แสดงอย่างเดียว) · ส่งอีเมลจริง (M3.5)
