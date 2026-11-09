# Technical Plan — M1 Contracts + DB schema

> สถานะ: **อนุมัติล่วงหน้า** — Wei สั่งให้ทำงานต่อเนื่องข้ามคืน (2026-11-09 "เริ่มงานยาวไปตลอดทั้งคืนเลยเอาให้เสร็จ") · ตรวจย้อนหลังได้
> อ้างอิง: `PLAN.md` §2, §6 (M1), §7 · `docs/ADR-001-tenancy.md` (ทาง ค) · `docs/ADR-002-posting-engine.md`

## 1. ส่งมอบ / Gate (PLAN §6)
ส่งมอบ: `packages/contracts` (zod + JSON Schema/OpenAPI components) · schema `public` + ตารางบัญชีรวม + RLS · migration สร้าง/ลบบริษัท · seed ผังบัญชี
Gate: schema test · `createCompany()` แล้ว query ตารางบัญชีของบริษัทนั้นได้ · **test อ่านข้ามบริษัทต้อง fail** · migration ย้อนกลับได้ · seed รันซ้ำได้

## 2. โครงฐานข้อมูล
- schema **`public`**: `app_user`, `organization`, `company`, `membership`, `invite`, `plan`, `subscription` (hook), `entitlement`, `audit_console`, `schema_migrations`
- schema **`acct`** (ตารางบัญชีรวม · ทุกตารางมี `company_id uuid NOT NULL REFERENCES public.company` + `ENABLE`/`FORCE RLS` + policy `tenant`):
  `account`, `period`, `contact`, `product`, `number_series`, `document`, `document_line`, `journal`, `journal_line`, `posting_rule`, `posting_rule_version`, `audit_log`
- เงิน `NUMERIC(18,2)` · qty/ราคาต่อหน่วย `NUMERIC(18,4)` · อัตรา `NUMERIC(7,4)` · FX `NUMERIC(18,6)` (PLAN §3)
- **Dr=Cr ชั้น 2**: `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` บน `acct.journal_line` → ตรวจผลรวมต่อ journal ตอน commit · `journal_line` ห้ามมีทั้ง debit และ credit > 0 ในบรรทัดเดียว และห้ามติดลบ (CHECK)
- journal ที่ `posted` ห้าม UPDATE/DELETE (trigger) — แก้ = void + reversal (ADR-002)
- งวด: `period.status` ∈ open/soft_closed/hard_closed · งวด 1–13 ต่อปีบัญชี · journal ลงงวด hard_closed ไม่ได้ (trigger) · soft_closed ตรวจสิทธิ์ที่ชั้นแอป (M3)

## 3. Roles
- `migrator` เป็นเจ้าของทุกตาราง (รัน migration)
- `app` DML เท่านั้น · ไม่ใช่เจ้าของ → RLS มีผลเสมอ
- `console_reader` SELECT + `BYPASSRLS` สำหรับ Console (M8) + audit
- dev: role สร้างใน `docker/init` · production: migration ตรวจว่ามี role ครบ

## 4. Migration
- ไฟล์ SQL คู่ `NNNN_name.up.sql` / `.down.sql` ใน `packages/db/migrations` · runner เล็กใน `packages/db/src/migrate.ts` (ตาราง `public.schema_migrations`, ทำใน transaction, advisory lock แบบ xact)
- `pnpm db:migrate` / `pnpm db:migrate:down` · test: up → down ทั้งหมด → up อีกรอบต้องผ่าน (ย้อนได้)
- ต่อตรง Postgres (55432) ด้วย `migrator` — ไม่ผ่าน PgBouncer

## 5. Data access (`@innovera/db`)
- Kysely + `pg` ผ่าน PgBouncer · type ของตารางเขียนมือใน `src/types.ts` (ตรวจกับ DB จริงด้วย test)
- `withCompany(companyId, fn)` = transaction + `set_config('app.company_id', id, true)` — **ทางเดียว**ที่ export ตัว query ตาราง `acct` (ไม่ export Kysely instance ดิบ)
- `withPublic(fn)` สำหรับตาราง public · `createCompany()` / `deleteCompany()` (ลบได้เฉพาะบริษัทที่ไม่มี journal posted — ใช้ใน test/onboarding)
- ESLint: ห้าม import `kysely`/`pg` นอก `packages/db` (`no-restricted-imports`)

## 6. Seed
- ผังบัญชีจาก `fixtures/sample-company.json` (53 บัญชี) · ปีบัญชี 2569 งวด 1–13 · คู่ค้า/สินค้าตัวอย่างจาก fixtures · รันซ้ำได้ (upsert)
- **TODO (Wei):** CLAUDE.md ระบุ "ผังบัญชีบริการ 186 บัญชี + 24 สูตร" แต่ไม่มีรายการในไฟล์ใด · แบบร่าง ScreenCOA ระบุ 84 บัญชี · fixtures มี 53 → seed 53 ไปก่อน รอรายการจริง
- **TODO (Wei):** ScreenFormula ใช้ 1154200 เป็นภาษีถูกหัก ณ ที่จ่าย แต่ fixtures/ScreenCOA ใช้ 1160100 → ใช้ 1160100 ตาม fixtures
- สูตรลงบัญชี 24 สูตร → M2 (ร่วมกับ engine)

## 7. Contracts (`@innovera/contracts`)
- zod 4: `Money` (string 2 ตำแหน่ง), `Qty`, `Rate`, `AccountCode` (7 หลัก), `DocumentDraftCreate` (สร้างได้แค่ draft · `external_source + external_ref`), `JournalLine`, `Company`, event types ของ webhook (`document.posted`, `document.voided`, `payment.received`, `payment.paid`, `period.closed`)
- export JSON Schema (zod 4 `toJSONSchema`) → `contracts/openapi/components.json` (OpenAPI paths เต็มทำใน M7)

## 8. Tests (Gate)
1. migration up/down/up · 2. ทุกตารางใน `acct` มี `company_id`, RLS เปิด + FORCE, มี policy (สแกน catalog) · 3. leak tests จาก spike (ลืม context, context ค้าง, raw SQL, ปลอม company_id) บน schema จริง · 4. `createCompany()` แล้ว seed + query ได้ · บริษัท B มองไม่เห็น · 5. Dr≠Cr ถูกปฏิเสธตอน commit · journal posted แก้ไม่ได้ · ลงงวด hard_closed ไม่ได้ · 6. seed รันซ้ำแล้วจำนวนแถวเท่าเดิม · 7. contracts: Money ปฏิเสธ number/3 ตำแหน่ง

## 9. ไม่อยู่ใน M1
Posting rule engine (M2) · auth/สิทธิ์ (M3) · UI (M2+) · API endpoints จริงนอกจาก health (M4+)
