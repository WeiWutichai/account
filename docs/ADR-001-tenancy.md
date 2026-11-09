# ADR-001 — Tenancy และการเข้าถึงข้อมูล

- สถานะ: **เสนอ — รอ Wei ตัดสิน** (ห้ามเริ่ม M1 จนกว่าอนุมัติ)
- อ้างอิง: `docs/spike-tenancy-report.md` · `spike/tenancy/` · `PLAN.md` §2, §9 ข้อ 1

## บริบท
ระบบบัญชีหลายบริษัท (เป้าหมายหลักร้อยถึงหลักพันบริษัท) ต่อ Postgres ผ่าน PgBouncer transaction mode · ความเสี่ยงสูงสุดคือข้อมูลรั่วข้ามบริษัท · Prisma ใช้ `search_path` สลับบริษัทไม่ได้ (พิสูจน์แล้วใน spike)

## ทางเลือก
- ก: schema ต่อบริษัท + Prisma (public) + Kysely (tenant) — 71.5 คะแนน
- ข: schema ต่อบริษัท + Prisma client ต่อบริษัท — 70 คะแนน
- ค: ตารางรวม + `company_id` + Row-Level Security — **79 คะแนน**

## ตัดสิน (เสนอ)
**ค** — ตารางรวม + `company_id` + RLS (`ENABLE` + `FORCE`) · data access ด้วย **Kysely** เป็นหลัก (Prisma ไม่ใช้ ลดเครื่องมือให้เหลือชุดเดียว — ยืนยันใน TP M1) · context บริษัทตั้งด้วย `set_config('app.company_id', …, true)` ภายใน transaction เท่านั้น ผ่าน `withCompany()`

เงื่อนไขบังคับ: ดูรายงาน §7 ข้อ 1–6 (role ไม่ใช่เจ้าของตาราง, test policy ทุกตาราง, index ขึ้นต้น company_id, ตารางยอดรายงวด, migration แบบ expand/contract, เครื่องมือ export/import รายบริษัทก่อน M3.5, role BYPASSRLS เฉพาะ Console + audit)

## ผลที่ตามมา
- ✅ DB กันการรั่วทุกทาง รวม raw SQL และการปลอม company_id · สร้างบริษัทใหม่ทันที · catalog เล็ก · query ข้ามบริษัทของ Console ง่าย
- ⚠️ ต้องสร้างเครื่องมือ backup/restore/ย้าย DB รายบริษัทเอง · migration กระทบทุกบริษัทพร้อมกัน · ต้องระวัง noisy neighbor (บริษัทใหญ่) → index/partition
- 📝 ต้องแก้ `PLAN.md` §2 และ `CLAUDE.md` (สถาปัตยกรรม: schema-per-company → ตารางรวม + RLS) หลังอนุมัติ

## เวอร์ชันที่ pin (ตรวจจริง 2026-11-09)

| เครื่องมือ | เวอร์ชัน | หมายเหตุ |
|---|---|---|
| Node | 26.13.0 (LTS "Lithium") | `.nvmrc` |
| pnpm | 12.18.0 | `packageManager` + corepack 0.34.6 |
| turbo | 2.11.10 | |
| TypeScript | 6.0.3 | 7.0.2 มีแล้ว แต่ typescript-eslint 8.72 รองรับ < 6.1 |
| ESLint / typescript-eslint | 10.14.0 / 8.72.1 | |
| NestJS | 12.4.2 | ESM |
| Next.js / React | 16.4.5 / 19.3.1 | |
| Prisma | 7.10.1 | npm `latest` ของ CLI ชี้ 8.0.0-rc.33 (ไม่ใช่ stable) |
| Kysely | 0.29.8 | |
| pg | 8.23.1 | |
| decimal.js | 10.6.0 | |
| Vitest | 5.1.0 | |
| PostgreSQL | 18.6 | image `postgres:18.6` |
| PgBouncer | 1.26.1 | image `edoburu/pgbouncer:v1.26.1-p0` · transaction mode |
| Redis | 8.10.3 | image `redis:8.10.3` |
| Docker (เครื่อง dev) | 29.5.2 | |
