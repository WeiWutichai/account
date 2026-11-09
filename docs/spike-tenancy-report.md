# รายงาน Spike ORM / Tenancy (M0)

> 2026-11-09 · Claude Code · โค้ดและผลดิบ: `spike/tenancy/` (`results/*.json`) · ตอบ PLAN §9 ข้อ 1
> สรุป: **แนะนำทาง ค (ตารางรวม + `company_id` + Row-Level Security)** — รอ Wei ตัดสิน (ADR-001)

## 1. สิ่งที่ทดลอง

| | การเข้าถึงข้อมูล | กลไกแยกบริษัท |
|---|---|---|
| **ก** | Prisma 7 (เฉพาะ `public`) + Kysely 0.29 (ตาราง tenant) | schema ต่อบริษัท `co_<ulid>` + `set_config('search_path', …, true)` ใน transaction |
| **ข** | Prisma 7 client ต่อบริษัท (`PrismaPg(pool, { schema })`) ใช้ `pg.Pool` ร่วม + LRU | schema ต่อบริษัท |
| **ค** | Kysely บน schema `cshared` | ตารางรวม + `company_id` + RLS (`FORCE`) + `set_config('app.company_id', …, true)` |

สภาพแวดล้อม: Postgres 18.6 · PgBouncer 1.26.1 **transaction mode** (pool 20) · Node 26.13 · Apple Silicon (docker) · แอปต่อด้วย role `app` (ไม่ใช่ superuser ไม่ใช่เจ้าของตาราง)
ข้อมูล: **300 บริษัท** (10 ใหญ่ × 50,000 เอกสาร · 290 × 2,000) = 1.08 ล้านเอกสาร · 4.32 ล้านบรรทัด journal ต่อทาง · ตาราง tenant 38 ตาราง (6 หลัก + 32 เติม) · DB รวม 2.9 GB

## 2. คำถามข้อ 1: Prisma + `SET LOCAL search_path` ใช้ได้หรือไม่ → **ไม่ได้**
ตั้ง `search_path` เป็น schema ของบริษัทแล้วเรียก `tx.document.count()` ได้ error
> The table `public.document` does not exist in the current database.

Prisma ใส่ชื่อ schema กำกับทุกตารางเอง (ทาง ข เห็นชัด: `FROM "co_01m70hg6…"."document"`) · หลักฐาน `results/prisma-search-path.json` · test `คำถามข้อ 1` ใน `test/leak.test.ts`

## 3. การรั่วข้ามบริษัท (`results/leak-matrix.json` · 17/17 test ผ่าน ทั้งชุดเล็กและชุดเต็ม)

| กรณี | ก | ข | ค |
|---|---|---|---|
| เขียนบริษัท A แล้วอ่านจาก B | ✅ ไม่เห็น | ✅ ไม่เห็น | ✅ ไม่เห็น |
| ลืมตั้ง context | ✅ error | — (client ผูก schema) | ✅ เห็น 0 แถว · insert ถูกปฏิเสธ |
| context ค้างข้าม transaction ใน connection เดียวกัน | ✅ ไม่ค้าง | — | ✅ ไม่ค้าง |
| raw SQL อ้างข้อมูลบริษัทอื่นตรงๆ | ❌ **อ่านได้** | ❌ **อ่านได้** | ✅ 0 แถว (RLS) |
| ปลอม `company_id` ของบริษัทอื่นตอน insert | n/a | n/a | ✅ ถูกปฏิเสธ |

ก/ข ปลอดภัยเมื่อเขียนโค้ดตามทางปกติ แต่ **DB ไม่ได้กันให้** — ถ้ามี raw SQL (ตัวสร้างรายงาน R2, query ของ Console, MCP ในอนาคต) จะรั่วได้ ต้องพึ่ง lint/รีวิว หรือเพิ่ม role ต่อบริษัท (ยังไม่ได้ทดลอง) · ค ให้ DB กันทุกทางรวม raw SQL

## 4. ความเร็ว (`results/bench.json`, `results/bench-c-covering.json`)
W1 สร้างเอกสาร+journal 4 บรรทัด · W2 รายการ 25 แถว · W3 งบทดลองทั้งบริษัท · W4 ผสม 70/20/10 · สุ่มบริษัทแบบ Zipf (บริษัทใหญ่โดนบ่อย) · ไม่มี error ยกเว้นที่ระบุ

| สถานการณ์ | ก ops/s · p95 | ข ops/s · p95 | ค ops/s · p95 | ค + covering index |
|---|---|---|---|---|
| W1 @50 | 643 · 165 ms | 358 · 334 ms | **1,036 · 109 ms** | — |
| W2 @50 | 1,815 · 56 ms | **2,103 · 47 ms** | 2,036 · 46 ms | — |
| W3 @50 | **104 · 903 ms** | 97 · 1,053 ms | 80 · 1,249 ms | 75 · 1,313 ms |
| W4 @50 | **467 · 260 ms** | 429 · 345 ms | 237 · 598 ms | 386 · 300 ms |
| W4 @200 | **447 · 858 ms** | 376 · 1,036 ms (timeout 1 ครั้ง) | 298 · 1,238 ms | 398 · 881 ms |
| connection ที่ Postgres (สูงสุด) | 27 | 27 | 27 | 27 |
| หน่วยความจำแอป | 83–168 MB | **156–356 MB** (300 client) | 58–141 MB | — |

- **connection ไม่โตตามจำนวนบริษัทในทุกทาง** — PgBouncer transaction mode + set_config แบบ LOCAL ใช้ได้ ไม่มี error เรื่อง prepared statement/session state
- ข: เขียนช้าสุด (overhead ของ Prisma ต่อ transaction) · RAM สูงสุด · มี "Unable to start a transaction in the given time" 1 ครั้งที่ concurrency 200
- ค ก่อนเพิ่ม index ช้ากว่า ก 2.3 เท่าที่ W4 — สาเหตุหลักคือ W3 (รวมยอดจากตาราง 4.3 ล้านแถว) · เพิ่ม `INDEX (company_id, account_code) INCLUDE (debit, credit)` แล้ว W4 เหลือช้ากว่า ~1.2 เท่า (ผล W4 แกว่งระหว่างรอบได้ ±15%)
- W3 ช้าในทุกทาง (~1 วินาที p95) เพราะรวม journal ทั้งบริษัททุกครั้ง — ของจริงต้องมีตารางยอดคงเหลือรายงวด (ทำใน M2 ไม่ว่าเลือกทางไหน)

## 5. งาน ops (`results/ops.json`)

| งาน | ก/ข (schema ต่อบริษัท) | ค (ตารางรวม) |
|---|---|---|
| migrate: เพิ่ม 1 คอลัมน์ + 1 index | 15.4 s · โตตามจำนวนบริษัท (~51 ms/บริษัท → 3,000 บริษัท ≈ 2.6 นาที) · ต้องจัดการกรณี migrate ค้างครึ่งทาง | 8.4 s ครั้งเดียว · โตตามขนาดข้อมูล · ต้องใช้ `CREATE INDEX CONCURRENTLY` + expand/contract เพื่อไม่ล็อกทุกบริษัท |
| สร้างบริษัทใหม่ | 1.45 s (สร้าง 38 ตาราง) | ~1 ms (insert 1 แถว) |
| backup บริษัทใหญ่ 1 แห่ง | `pg_dump -n` 22 s (ช้าเพราะต้องอ่าน catalog 11,507 ตาราง) · ได้ไฟล์มาตรฐาน | COPY ต่อตาราง 12.9 s · **ต้องเขียนเครื่องมือเอง** |
| restore บริษัท 1 แห่ง | `pg_restore` 4 s · ตรวจแล้วข้อมูลครบ | ต้องเขียนเครื่องมือเอง (กันชน id/sequence) |
| query ข้ามบริษัท (Console นับเอกสารต่อบริษัท) | 3.2 s (UNION 300 schema) | 1.0 s (`GROUP BY company_id`) |
| ขนาด catalog | 11,507 ตาราง · **ANALYZE/pg_dump ทั้ง DB ใน transaction เดียวชน `max_locks_per_transaction` (out of shared memory)** ต้องปรับค่า | ~40 ตาราง |
| บริษัท Enterprise ใช้ DB แยก (`company.db_dsn`) | ย้าย schema ไปได้ตรงๆ | ใช้โครงตารางเดิมใน DB แยกที่มีบริษัทเดียว ได้เหมือนกัน |

## 6. คะแนน (เกณฑ์ใน technical-plan-M0 §5.5)

| เกณฑ์ (น้ำหนัก) | ก | ข | ค | เหตุผลย่อ |
|---|---|---|---|---|
| ความปลอดภัยการแยกบริษัท (35) | 7 | 7 | **10** | ค กันที่ DB ทุกทาง รวม raw SQL / ปลอม company_id · ก/ข พึ่งวินัยโค้ด |
| ความเรียบง่ายของโค้ดประจำวัน (25) | 6 | 7 | **8** | ก ต้องใช้ 2 ORM · ข ต้องจัดการ cache client · ค เครื่องมือเดียว โค้ดตรงไปตรงมา (แต่ต้องใส่ company_id ตอน insert) |
| ประสิทธิภาพ / connection (20) | **9** | 6 | 7 | ก เร็วสุดในงานผสม · ข ช้าตอนเขียน + RAM สูง · ค ใกล้ ก หลังเพิ่ม index |
| ops (20) | 7 | 7 | 5 | ก/ข backup/restore รายบริษัทด้วยเครื่องมือมาตรฐาน แต่ migrate/catalog โตตามบริษัท · ค ต้องสร้างเครื่องมือ backup/restore รายบริษัทเอง |
| **รวม (เต็ม 100)** | **71.5** | **70** | **79** | |

## 7. คำแนะนำ
**เลือก ค (ตารางรวม + company_id + RLS)** เพราะความเสี่ยงที่แพงที่สุดของระบบบัญชีหลายบริษัทคือ**ข้อมูลรั่วข้ามบริษัท** และ ค เป็นทางเดียวที่ DB กันให้เองโดยไม่ขึ้นกับวินัยการเขียนโค้ด — สำคัญเพราะแผนมีตัวสร้างรายงาน (R2), Console และ MCP ซึ่งเป็นจุดที่ query แบบยืดหยุ่นจะเกิดขึ้น

เงื่อนไขที่ต้องทำถ้าเลือก ค (ใส่ใน Technical Plan M1):
1. แอปต่อด้วย role ที่ไม่ใช่เจ้าของตาราง · ทุกตาราง tenant `ENABLE` + `FORCE ROW LEVEL SECURITY` · test ใน CI ตรวจว่าตาราง tenant ใหม่ทุกตารางมี policy
2. เข้าถึงข้อมูลบริษัทได้ทางเดียวผ่าน `withCompany(companyId, tx => …)` (set_config แบบ LOCAL) · ชุด leak test ของ spike ย้ายไปเป็น test ถาวร
3. index ทุกตัวขึ้นต้นด้วย `company_id` · ตารางยอดคงเหลือรายงวดสำหรับงบทดลอง (M2) · พิจารณา partition `journal_line` ตาม hash(company_id) เมื่อข้อมูลโต
4. migration แบบ expand/contract + `CREATE INDEX CONCURRENTLY`
5. เครื่องมือ export/import รายบริษัท (ตาม company_id) — ใช้ทั้ง backup รายบริษัท, ย้ายไป DB แยก (Enterprise) และสิทธิ์ขอข้อมูลตาม PDPA · ต้องมีก่อน M3.5 · backup หลักของระบบยังเป็นทั้ง DB (PITR)
6. Console/งานภายในที่ต้องอ่านข้ามบริษัท ใช้ role แยกที่มี `BYPASSRLS` เฉพาะ service นั้น + audit

**ถ้า Wei ต้องการคง schema-per-company** ให้เลือก **ก** (ไม่ใช่ ข) และเพิ่ม role ต่อบริษัท (`SET LOCAL ROLE co_x` ที่มีสิทธิ์เฉพาะ schema ตัวเอง) เพื่อปิดช่องรั่วจาก raw SQL — วิธีนี้ยังไม่ได้ทดลอง ต้องทำ spike เพิ่ม ~1 วัน · และตั้ง `max_locks_per_transaction` ให้รองรับจำนวนตาราง

ผลกระทบต่อเอกสาร (ถ้าอนุมัติ ค): แก้ `PLAN.md` §2 และ `CLAUDE.md` (ส่วนสถาปัตยกรรม) จาก schema-per-company เป็นตารางรวม + RLS · `company.db_dsn` ยังคงไว้สำหรับ Enterprise

## 8. ข้อจำกัดของการทดลอง
- วัดที่ชั้น data access โดยตรง (ไม่ผ่าน HTTP) — ส่วน HTTP เท่ากันทุกทาง จึงไม่กระทบการเปรียบเทียบ
- รอบละ 30–60 วินาที (แผนเขียน 5 นาที) · เครื่อง dev เครื่องเดียว (แอป + DB อยู่เครื่องเดียวกัน) · ตัวเลขใช้เทียบกันเอง ไม่ใช่ capacity ของ production
- ไม่ได้ทดลอง Drizzle และทาง ก + role ต่อบริษัท
