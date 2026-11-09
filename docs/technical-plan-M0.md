# Technical Plan — M0 Bootstrap + Spike ORM/Tenancy

> สถานะ: **ร่าง — รอ Wei อนุมัติ** (ห้ามเริ่ม build จนกว่าจะอนุมัติ ตาม loop ใน `CLAUDE.md`)
> ร่างโดย Claude Code · 2026-11-09 · อ้างอิง `PLAN.md` §2, §6 (M0), §7, §9 · `CLAUDE.md`
> เมื่ออนุมัติแล้ว ไฟล์นี้ย้ายไป `innovera-platform/docs/` พร้อมเอกสารอื่น

---

## 1. เป้าหมาย M0 และนิยามเสร็จ

**ส่งมอบ** (ตาม PLAN §6): monorepo · CI (lint/typecheck/test) · docker compose (pg, redis, pgbouncer) · `packages/config` · ADR-001 tenancy · ADR-002 ledger · **spike ORM/tenancy วัดผลกับ 300 schema**

**Gate (ปิด M0 ได้เมื่อครบทุกข้อ)**
1. CI เขียวบน branch หลัก — แนบ log จริง
2. `pnpm dev` ขึ้นครบ: 5 แอป (หน้า health/placeholder) + pg + pgbouncer + redis
3. รายงาน spike (§5) พร้อม SQL ที่ ORM สร้างจริง + ตาราง benchmark + ผลทดสอบรั่วข้ามบริษัท
4. ADR-001 (ทางเลือกที่แนะนำ) และ ADR-002 (โครง ledger) เขียนเสร็จ
5. **Wei อนุมัติทางเลือก tenancy** → ถึงเริ่ม M1 ได้

**ไม่อยู่ใน M0:** ตารางบัญชีจริง (M1) · Posting Engine จริง (M2) · auth (M3) · UI ตามแบบร่าง (M2 เป็นต้นไป) · deploy (M3.5)

---

## 2. โครง repo ที่สร้างใน M0

```
innovera-platform/
├─ apps/
│  ├─ accounting-api/     NestJS · GET /health (เช็ค pg ผ่าน pgbouncer + redis)
│  ├─ accounting-web/     Next.js App Router · หน้า placeholder 1 หน้า
│  ├─ id-api/             NestJS · GET /health
│  ├─ id-web/             Next.js · placeholder
│  └─ console-web/        Next.js · placeholder
├─ packages/
│  ├─ config/             tsconfig base (strict) · eslint flat config · prettier
│  ├─ ledger/             โครงเปล่า + type ของ journal (ตาม ADR-002) + test 1 ตัว (Dr=Cr)
│  ├─ db/                 ว่างไว้ — เติมหลังเลือก tenancy (M1)
│  ├─ tax-th/  ui/  contracts/   โครงเปล่า (package.json + index.ts)
├─ spike/tenancy/         โค้ด spike ทั้ง 3 ทาง + harness benchmark (ลบหรือเก็บเป็น archive หลังอนุมัติ)
├─ docker/                compose.yaml · pgbouncer.ini · init SQL
├─ docs/                  PLAN.md · PROGRESS.md · page-map.md · functional-spec-v2.md · ADR-*.md · technical-plan-*.md
├─ design/  design-system/  fixtures/    ย้ายมาจากโฟลเดอร์ AccountSystem เดิมทั้งชุด (MANIFEST/md5 ต้องตรงหลังย้าย)
└─ CLAUDE.md
```

**การย้ายไฟล์**: คัดลอกทั้งโฟลเดอร์ `AccountSystem/` เข้า repo ใหม่ → ตรวจ md5 ตาม `PROGRESS.md` §2 → commit แรกเป็น "docs: import planning docs" ก่อนมีโค้ด · โฟลเดอร์เดิมเก็บไว้อ่านอย่างเดียวจนปิด M0

---

## 3. Toolchain และเวอร์ชัน

ตามกติกา "ใช้เวอร์ชันเสถียรล่าสุด ณ วันเริ่ม M0 · ห้ามเดาจากความจำ":
- **ขั้นแรกของ M0** = รัน `npm view <pkg> version` / ดูหน้า release ของ Node, PostgreSQL, PgBouncer, Redis แล้วบันทึกตาราง "เวอร์ชันที่ pin" ลง ADR-001 ภาคผนวก · pin ใน `package.json` (`packageManager`, `engines`) และ lockfile · image docker pin ด้วย tag เต็ม
- เครื่อง dev: **Node 26.13.0 (LTS "Lithium" ล่าสุด · อัปจาก 20.20.2 เมื่อ 2026-11-09 ผ่าน nvm, ตั้งเป็น default)** · npm 11.20.0 · pnpm 9.0.0 (อัปตาม `packageManager`) · Docker 29.5.2 ✓ · `.nvmrc` = `26.13.0`
- ใช้ `corepack` คุมเวอร์ชัน pnpm · `.nvmrc` คุม Node
- ร่างนี้เขียนตอนเข้า npm registry ไม่ได้ จึงยังไม่ใส่เลขรุ่น — **ไม่ใช่การลืม**

---

## 4. Docker compose (dev)

| service | หมายเหตุ |
|---|---|
| `postgres` | รุ่นเสถียรล่าสุด (≥16) · volume แยก · init: สร้าง role `app` (ไม่ใช่ superuser) + role `migrator` |
| `pgbouncer` | **pool_mode = transaction** · max_client_conn 1000 · default_pool_size ปรับได้ (ใช้วัดใน spike) · แอปต่อผ่าน pgbouncer เสมอ ยกเว้น migration ต่อ pg ตรง |
| `redis` | สำหรับ BullMQ + rate limit (ใช้จริงตั้งแต่ M3) |

- `pnpm dev` = `docker compose up -d` + `turbo dev`
- ห้ามใช้ session state ใน connection (prepared statement แบบ named, `SET` แบบไม่ LOCAL, advisory lock แบบ session) — spike ต้องตรวจว่า ORM แต่ละตัวไม่ทำสิ่งเหล่านี้ผ่าน pgbouncer

---

## 5. Spike ORM/Tenancy (หัวใจของ M0)

### 5.1 คำถามที่ต้องตอบ
1. Prisma ใช้ `SET LOCAL search_path TO co_x, public` สลับบริษัทได้จริงหรือไม่ (คาดว่าไม่ได้ เพราะ SQL ที่สร้างใส่ชื่อ schema กำกับ)
2. ทางเลือกไหนปลอดภัยที่สุดเรื่อง**อ่าน/เขียนข้ามบริษัทโดยไม่ตั้งใจ**
3. ทางเลือกไหนทนได้ที่ 300 บริษัท (และประเมินถึง 3,000) ผ่าน PgBouncer transaction mode
4. ผลต่อ migration, backup/restore รายบริษัท, query ข้ามบริษัทจาก Console (X-pages), และ `company.db_dsn` (DB แยกของ Enterprise)

### 5.2 ทางเลือกที่ทดลอง (ตาม PLAN §2)
| | การเข้าถึงข้อมูล | กลไกแยกบริษัท |
|---|---|---|
| **ก** | Prisma เฉพาะ `public` + **Kysely** สำหรับตารางบัญชีใน `co_<ulid>` (ทดลอง Drizzle คู่ถ้ามีเวลา) | schema-per-company + `SET LOCAL search_path` ใน transaction |
| **ข** | Prisma client ต่อบริษัท (`?schema=co_x`) เก็บใน LRU cache | schema-per-company + client แยก |
| **ค** | ORM เดียว (Prisma หรือ Kysely) ตารางรวมทุกบริษัท + `company_id` | Postgres Row-Level Security + `SET LOCAL app.company_id` |

### 5.3 ชุดข้อมูลและ harness
- tenant template **~40 ตาราง** จำลองโครงจริง (document, document_line, journal, journal_line, account, contact, product, tax_entry, settlement, audit_log …) — คอลัมน์และ index ใกล้ของจริง ไม่ต้องครบ
- สร้าง **300 บริษัท** · บริษัทละ 2,000 journal × 4 บรรทัด (บริษัทใหญ่ 10 แห่ง × 50,000 journal)
- harness (TS + `autocannon` หรือ k6) ยิงผ่าน API จริงของ `accounting-api` 4 แบบ:
  - **W1** สร้างเอกสาร + journal 4 บรรทัดใน transaction เดียว
  - **W2** รายการเอกสาร 25 แถวแบบกรอง
  - **W3** งบทดลองของบริษัท (aggregate journal_line)
  - **W4** ผสม 70/20/10 สุ่มบริษัทแบบ Zipf (บริษัทใหญ่โดนบ่อย)
- concurrency 50 / 200 client · วัด 5 นาทีต่อชุด

### 5.4 สิ่งที่วัดและเกณฑ์ผ่าน
| ตัววัด | เกณฑ์ |
|---|---|
| ความถูกต้องการแยกบริษัท | **0 รั่ว** — test ยิง request ของบริษัท A แล้วพยายามอ่าน/เขียน B ทุกทาง (ลืม set context, ใส่ id ผิด, raw query) ต้อง fail ทั้งหมด · ทางที่ "ลืมแล้วรั่ว" ต้องมีตัวกันชั้นที่ 2 |
| SQL ที่ ORM สร้าง | log จริงของ W1–W3 ทุกทางเลือก (เปิด statement log ที่ pg) แนบในรายงาน |
| p95 latency W1/W2/W3/W4 | บันทึกเทียบกัน · ไม่ตั้งเกณฑ์ตายตัว แต่ทางที่ช้ากว่าทางอื่น >2 เท่าต้องอธิบาย |
| connection ที่ pg จริง | ต้องคงที่ตาม pool ของ pgbouncer ไม่โตตามจำนวนบริษัท |
| หน่วยความจำแอป | วัดตอน 300 บริษัท (สำคัญกับทาง ข) |
| เวลา migrate | เพิ่ม 1 คอลัมน์ + 1 index ให้ครบ 300 บริษัท · สร้างบริษัทใหม่ 1 แห่ง (< 5 วินาที) |
| backup/restore รายบริษัท | `pg_dump -n co_x` แล้ว restore ใส่ DB ว่าง · เวลาที่ใช้ · ทาง ค ต้องเสนอวิธีแทน |
| query ข้ามบริษัท (Console) | นับเอกสารต่อบริษัททั้งระบบ — ความยากและเวลา |
| ความเข้ากับ pgbouncer transaction mode | ไม่มี error prepared statement / session state ตลอดการทดสอบ |

### 5.5 การตัดสิน
ตารางคะแนนในรายงาน (น้ำหนัก: ความปลอดภัยการแยกบริษัท 35 · ความเรียบง่ายของโค้ดที่ทีมต้องเขียนทุกวัน 25 · ประสิทธิภาพ/connection 20 · ops (migrate/backup/restore/Console) 20) → Claude Code **แนะนำ 1 ทาง** พร้อมเหตุผลใน ADR-001 → **Wei ตัดสิน**
- ถ้าเลือก ค ต้องแก้ `PLAN.md` §2 และ `CLAUDE.md` (เลิก schema-per-company) ก่อนเริ่ม M1

---

## 6. ADR ที่เขียนใน M0

**ADR-001 Tenancy** — ผล spike · ทางที่แนะนำ · รูปแบบ tenant context ในโค้ด (เช่น `withCompany(companyId, tx => …)` เป็นทางเดียวที่เข้าถึงตารางบัญชีได้ + lint rule ห้าม import client ตรง) · ตารางเวอร์ชันที่ pin

**ADR-002 Posting Engine (โครง)** — เขียนให้ M2 ใช้ได้ทันที:
- `packages/ledger` pure TS ไม่พึ่ง Nest/DB · input = เอกสาร + rule (ข้อมูล) · output = journal lines หรือ error ที่ระบุสาเหตุ
- `Money` = wrapper ของ `decimal.js` (เก็บเป็น string ใน JSON/API, `NUMERIC` ใน DB) · ห้าม `number` · last-line rounding เป็นฟังก์ชันกลาง
- Dr=Cr 2 ชั้น: engine throw + DB **constraint trigger แบบ DEFERRABLE INITIALLY DEFERRED** บน `journal_line` ตรวจผลรวมต่อ journal ตอน commit (ข้อเสนอสำหรับ §9 ข้อ 2 — ยืนยันใน TP ของ M1)
- golden tests 1–10 (PLAN §3) อ่านค่าจาก `fixtures/sample-company.json` เท่านั้น · M0 ใส่ test ตัวแรก (IV2611-0052 → Dr 1130100 10,700 / Cr 4100200 10,000 / Cr 2150400 700) ให้ CI รันได้

---

## 7. CI และกติกาโค้ด

- jobs: `pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test` (turbo cache) → ตรวจ md5 ของ `design/MANIFEST.json` และ `fixtures/*.json` ตรงกับไฟล์อ้างอิง (กันแก้ไฟล์ร่วมโดยไม่ตั้งใจ)
- ESLint: `no-explicit-any` error · ห้าม `@ts-ignore` · กฎเฉพาะ: ห้ามตัวแปร/field ชื่อ amount/total/vat/wht/price เป็นชนิด `number` · ห้าม `href="#"` (jsx)
- TypeScript `strict` + `noUncheckedIndexedAccess`
- commit แบบ `chore(m0): …` / `feat(ledger): …` · 1 เรื่องต่อ commit · 1 PR สำหรับ M0

---

## 8. ลำดับงานและประมาณเวลา

| # | งาน | ประมาณ |
|---|---|---|
| 1 | ตรวจ/ pin เวอร์ชัน · git repo · import เอกสาร (ตรวจ md5) | 0.5 วัน |
| 2 | `packages/config` + โครง monorepo + 5 แอป health/placeholder | 1 วัน |
| 3 | docker compose + pgbouncer + `pnpm dev` | 0.5 วัน |
| 4 | CI + lint rules เฉพาะ | 0.5 วัน |
| 5 | tenant template + data generator 300 บริษัท | 1 วัน |
| 6 | spike ก / ข / ค + test รั่วข้ามบริษัท | 2–3 วัน |
| 7 | benchmark + migrate/backup/restore/Console | 1 วัน |
| 8 | รายงาน spike + ADR-001 + ADR-002 + `packages/ledger` test แรก | 1 วัน |
| | **รวม** | **7.5–8.5 วันทำงาน** |

**ประมาณ milestone ถัดไป (หยาบ ปรับหลัง spike):** M1 4–6 วัน · M2 10–15 · M3 8–10 · M3.5 3–4 · M4 12–15 · M5 10–12 · M6 12–15 · M7 8–10 · M8 8–10

**ลำดับ milestone (PLAN §9 ข้อ 8):** ไม่เสนอเปลี่ยน — Posting Engine ก่อน auth ถูกแล้ว เพราะ engine เป็น pure TS ทดสอบได้โดยไม่ต้องมีผู้ใช้

---

## 9. ข้อเสนอเบื้องต้นสำหรับคำถาม PLAN §9 ที่เหลือ (ตัดสินใน TP ของ milestone ที่เกี่ยว)

| ข้อ | ข้อเสนอ | ตัดสินใน |
|---|---|---|
| 2 Dr=Cr ที่ DB | constraint trigger deferred (ดู §6) | M1 |
| 3 ตัวเลข | `Money`/`Qty`/`Rate` helper บน decimal.js · ความละเอียดตาม PLAN §3 | M1 |
| 4 posting_rule | rule เป็น JSON ตาม schema (zod) · แก้ = สร้าง version ใหม่ (immutable) · journal เก็บ `rule_version_id` | M2 |
| 5 jobs | BullMQ queue แยก: `webhook-out` (retry + dead-letter), `depreciation-monthly`, `statement-import`, `pdf-render`, `email` · job data มี `company_id` เสมอ และ worker เข้า tenant context ก่อนทำงาน | M4–M6 |
| 6 PDF | **Playwright render HTML** — แบบพิมพ์ D1–D15 ในแบบร่างเป็น HTML + Sarabun อยู่แล้ว ใช้ต่อได้ตรงแบบที่สุด · บาทเป็นตัวอักษรอยู่ใน `packages/tax-th` | M4 |
| 7 Audit hash chain | ตาราง append-only ต่อบริษัท · `hash = sha256(prev_hash ‖ canonical_json(event))` · เก็บ `key_id` ผู้ลงนาม · job ตรวจทั้ง chain ทุกคืน | M7 |

---

## 10. ความเสี่ยง 3 อันดับแรก

1. **Tenancy เลือกผิด** — แก้ทีหลังแพงที่สุด → spike วัดจริง + test รั่วข้ามบริษัทเป็น gate
2. **ตัวเลขภาษีไม่ตรงข้ามหน้า** (ภ.พ.30 ↔ รายงานภาษี ↔ GL) → golden tests จาก fixtures ชุดเดียว + test "ภ.พ.30 = รายงาน = GL" ใน M6 · ข้อสังเกตใน `PROGRESS.md` §4 (ภาษีขายสินค้า IV2611-0001) ต้องปิดก่อน M6
3. **ขอบเขต UI 76 หน้าแบบเคร่งครัด** ใหญ่กว่าเวลาที่มี → ทำตาม milestone ใน `docs/page-map.md` · หน้าที่ไม่จำเป็นต่อนิยาม "เสร็จ" (Console, MCP) เลื่อนได้ตาม PLAN

---

## 11. สิ่งที่ต้องให้ Wei ตอบก่อนเริ่ม

1. **อนุมัติ Technical Plan นี้** (หรือระบุจุดที่ต้องแก้)
2. **ที่เก็บ repo + CI**: GitHub private + GitHub Actions? (ถ้าใช้ที่อื่นบอกชื่อ) · ชื่อ repo `innovera-platform` ตาม PLAN?
3. ~~ใครเป็นคน build M0~~ — **Claude Code ในเครื่องนี้** (Wei ตอบ 2026-11-09) · Cowork ไม่แก้ไฟล์ใน repo ระหว่าง build ยกเว้นแจ้งผ่าน Wei
4. ~~อัป Node เป็น LTS~~ — ทำแล้ว (26.13.0)
