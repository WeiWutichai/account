# PROGRESS — AccountSystem (Innovera)

> **อ่านไฟล์นี้ก่อนเมื่อเริ่ม chat ใหม่** ถัดไปอ่าน `CLAUDE.md` (กติกา) → `PLAN.md` (แผน Phase 1)
> อัปเดตไฟล์นี้ทุกครั้งที่จบงานชิ้นหนึ่ง: แก้ "สถานะล่าสุด" + เพิ่มบรรทัดใน "บันทึกงาน" (ใหม่อยู่บน) + อัปเดต md5
> อัปเดตล่าสุด: **2026-11-10 (สาย)** โดย Claude Code

---

## 1. สถานะล่าสุด (สรุป 30 วินาที)

- **โหมด:** Wei สั่งทำต่อเนื่องข้ามคืน (2026-11-09) = **อนุมัติ Technical Plan ล่วงหน้า** · เรื่องที่ต้องให้ Wei/ผู้สอบบัญชีตัดสิน → TODO ใน §4 ไม่ตัดสินเอง
- **M0 ✅ · M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅** (merge เข้า main) · **M3.5** เตรียมในเครื่องครบ รอ VPS/secrets ของ Wei · **M5** backend ✅ (UI ค้าง) · **M6** backend กำลังทำ · Wei สั่ง 2026-11-10 "ทำต่อจนจบทุก milestone"
- รีเซ็ตข้อมูล dev: `pnpm db:reset && pnpm dev:session` (เอกสารขาย/ซื้อจาก fixtures สร้างผ่าน service จริง เลขที่ตรง fixtures)
- M3.5 (deploy VPS จริง) ต้องใช้เซิร์ฟเวอร์/secrets ของ Wei — เตรียมได้แค่ไฟล์ deploy + ทดสอบ backup/restore ในเครื่อง
- รันเว็บ: `pnpm db:seed` → `pnpm dev` (id-api :4100 · id-web :3100 · accounting-api :4000 · accounting-web :3010 · วันนี้ = 30/11/2569)
- ผู้ใช้ dev: wei@innovera.co.th (รหัสผ่าน/คีย์ 2FA ใน `apps/id-api/src/dev-seed.ts`) · `pnpm dev:session` → `.playwright/dev-session.json` · ภาพเทียบ `STATE=.playwright/dev-session.json node scripts/screens.mjs M? Screen=/path`
- ⚠️ อย่าแก้ไฟล์ที่ mount เข้า docker ด้วย `sed -i` (เปลี่ยน inode → container เริ่มใหม่ไม่ได้) — ถ้าเผลอ: `docker compose -f docker/compose.yaml up -d --force-recreate pgbouncer`
- repo = โฟลเดอร์นี้ (git local) · build โดย Claude Code · `pnpm verify` เขียว
- รัน dev: `nvm use` (Node 26.13) → `pnpm install` → `pnpm db:up` → `pnpm db:migrate` → `pnpm verify` (test ใช้ DB `innovera_test` ผ่าน PgBouncer)

## 2. ไฟล์และแหล่งข้อมูล

| อะไร | ที่อยู่ | หมายเหตุ |
|---|---|---|
| กติกา repo | `CLAUDE.md` | source of truth ลำดับ 1 ร่วมกับ PLAN |
| แผน Phase 1 | `PLAN.md` | milestone M0–M8, golden tests §3, เรื่องรอผู้สอบบัญชี §10 |
| ความคืบหน้า | `PROGRESS.md` (ไฟล์นี้) | |
| Technical Plan M0 | `docs/technical-plan-M0.md` | Wei อนุมัติ 2026-11-09 |
| ผล spike tenancy | `docs/spike-tenancy-report.md` · `spike/tenancy/results/` | แนะนำทาง ค |
| ADR | `docs/ADR-001-tenancy.md` (อนุมัติ ทาง ค) · `docs/ADR-002-posting-engine.md` | |
| Technical Plan M1 | `docs/technical-plan-M1.md` | อนุมัติล่วงหน้า · เสร็จ |
| Technical Plan M2 | `docs/technical-plan-M2.md` | อนุมัติล่วงหน้า · backend เสร็จ |
| แบบร่าง (สำเนา) | `design/project/*.dc.html` + `design/MANIFEST.json` + `design/README.md` | อ่านอย่างเดียว · เปิดดู `cd design/project && python3 -m http.server 8080` |
| แบบร่าง (ต้นฉบับ) | https://claude.ai/artifact/LQTTxmYPCna8EntkntYCCQ | แก้ที่นี่แล้วส่งออกทับ `design/` |
| รหัสหน้าจอ ↔ ไฟล์ ↔ milestone | `docs/page-map.md` | Wei อนุมัติครบ |
| ระบบออกแบบ (ตัวจริง) | `design-system/` · https://claude.ai/artifact/UdMQo46L3WYvyRHCLGYuaa | ห้ามใช้ v2 `LwCHLbTj…` · ปุ่มยึดตามแบบร่าง (ดู `design-system/README.md`) |
| ตัวเลขตัวอย่าง | `fixtures/sample-company.json` + `.schema.json` | `decisions_wei_2026_11_09` = บันทึกการตัดสิน |
| Functional Spec v2 | `docs/functional-spec-v2.md` · https://claude.ai/artifact/HkxJ7Cj65uYB7LXBZmDhgM | รหัสหน้าจอใน Spec **คนละชุด** กับ PLAN — อ้างชื่อไฟล์เสมอ |
| มาตรฐาน UI (เหตุผล) | https://claude.ai/artifact/ADwMogMscKkykEjttgTxLF | |
| งานวิจัย TRCloud | `research/trcloud-research.md` | |
| ใบสั่งงาน Cowork เก่า | `research/cowork-handoff-*.md` | ปิดแล้ว · รอบ 1 ใช้ G5/G6 สลับกัน (ยกเลิก) |

**md5 ล่าสุด** (ตรวจได้ด้วย `md5 fixtures/*.json design/MANIFEST.json design-system/MANIFEST.json`)

| ไฟล์ | md5 |
|---|---|
| `fixtures/sample-company.json` | `ce89d09b6c7f3e863211c8fb8779b5bb` |
| `fixtures/sample-company.schema.json` | `318efe4f2743d91ef31ea756619be27a` |
| `design/MANIFEST.json` | `eca5f38c6afe73fff7b10c3c117e28a2` |
| `design-system/MANIFEST.json` | `8c3eac041599751df67da597c2b983e1` |

## 3. ข้อตัดสินของ Wei (ล็อกแล้ว)

| วันที่ | เรื่อง | ตัดสิน |
|---|---|---|
| 2026-11-09 | ระบบออกแบบ | ตัวแรก `UdMQo46…` · ปุ่มยึดตามแบบร่าง (มุม 4px, รองขาวขอบเทา, อันตรายขาวขอบแดง, ชื่อกึ่งกลาง) |
| 2026-11-09 | รหัสหน้าจอ | G5 = ตั้งค่าเอกสาร · G6 = MCP · milestone ทุกหน้าตาม `docs/page-map.md` |
| 2026-11-09 | วันนี้ในแบบร่าง | มุมมองสิ้นเดือน จันทร์ 30 พ.ย. 2569 |
| 2026-11-09 | ยอดขัดกัน 11 ข้อ | ตาม `fixtures.decisions_wei_2026_11_09` (IV2611-0056 = 281,200 · ลูกหนี้ 1,780,016 · กำไร ม.ค.–พ.ย. 2,872,880 · S-0001 1,500/ชม. · IV2611-0052 รออนุมัติ ฯลฯ) |
| 2026-11-09 | ค่าเช่าอาคาร | ไม่มี VAT (ม.81(1)(ฑ)) · รอบจ่าย 28 พ.ย. = 909,100 / 13,600 / 895,500 |
| 2026-11-09 | Tenancy / ORM | **ทาง ค: ตารางรวม + company_id + RLS · Kysely** (ADR-001 · ผล spike 79 คะแนน) |
| 2026-11-09 | repo / build | git local ในโฟลเดอร์นี้ · Claude Code เป็นผู้ build · Node 26.13 LTS |

## 4. เรื่องเปิดอยู่

**รอผู้สอบบัญชี** (ทำเป็น config + ป้าย "รอยืนยัน" — ห้ามตัดสินเอง)
1. ค่าจ้างฟรีแลนซ์พัฒนาซอฟต์แวร์ ม.40(2) หรือ 40(8) — ต่างทั้งประเภทและวิธีคำนวณ (คงที่ 3% vs อัตราก้าวหน้า ม.50(1)) · ค่าตั้งต้นชั่วคราว: หักคงที่ 3%
2. ขยายกำหนดยื่นออนไลน์ (ภ.ง.ด. 15 / ภ.พ.30 23) ยังใช้หรือไม่ · ค่าตั้งต้นชั่วคราว: ใช้

**รอ Wei**
3. ~~อนุมัติ TP M0~~ (อนุมัติแล้ว · repo local · build ในเครื่องนี้)
4. ~~เลือก tenancy~~ — ทาง ค (อนุมัติแล้ว)

**TODO รอ Wei (เจอระหว่าง build)**
- T1. ผังบัญชี "บริการ 186 บัญชี" ใน CLAUDE.md ไม่มีรายการในไฟล์ใด · ScreenCOA บอก 84 · fixtures มี 53 → seed ตาม fixtures ไปก่อน (ต้องการรายการจริง)
- T2. ScreenFormula ใช้ 1154200 เป็นภาษีถูกหัก ณ ที่จ่าย แต่ fixtures/ScreenCOA ใช้ 1160100 → ใช้ 1160100 ตาม fixtures
- T4. ลูกค้า A (C0012): `credit_limit_remaining` 452,920 = 500,000 − 47,080 (ยอดค้างเดิม) แต่ยอดค้างปัจจุบัน 42,800 → ควรเป็น 457,200 หรือ 446,500 (ถ้านับใบรออนุมัติ) · แสดงใน ScreenInvoice
- T5. fixtures `gl_balances_2569_11_30` มีเฉพาะยอดแถวตัวอย่าง ไม่มีงบทดลอง 30/11 ครบชุดที่ดุล → บริษัท dev แสดงยอดจากรายการตัวอย่างที่ลงจริง ไม่ตรงเลขในแบบร่าง ScreenCOA (ห้ามสร้างยอดเอง) · ต้องการงบทดลองครบชุดใน fixtures
- T6. ชุดบทบาทบริษัท: Spec v2 §3.1 (admin/staff) ≠ แบบร่าง ScreenUsers (Acct. Manager/AR Clerk/Petty Cash…) → ทำตามแบบร่าง รอยืนยัน · ScreenUserEdit ติ๊กสิทธิ์ AR Clerk ขัดกับเมทริกซ์ใน ScreenUsers (ใช้เมทริกซ์)
- T7. ไม่มีแบบร่างหน้า "ยืนยันอีเมล" (Signup ขั้น 2) และหน้ากรอกชื่อองค์กร (ขั้น 3) → ใช้การ์ดของ ScreenTwoFactor · องค์กรแรกใช้ชื่อบริษัทแรก
- T8. ScreenCompanyCreate ไม่มีแบบร่างขั้น 1 ข้อมูลบริษัท (ใช้ป้ายจาก ScreenSettings) · ข้อความ "ฐานข้อมูลแยก schema ต่อบริษัท" ขัดกับ ADR-001 (ตารางรวม + RLS) — ควรแก้ข้อความในแบบร่าง
- T9. ScreenUsers ไม่มีแบบฟอร์มเชิญ · แท็บหลายแท็บใน ScreenUsers/ScreenOrgMembers ไม่มีเนื้อหา · ScreenProfile มีช่องชื่อ-นามสกุลแยก แต่ระบบมี display_name ช่องเดียว — รายการเต็มใน `docs/technical-plan-M3.md` + TODO(Wei) ในโค้ด
- T10. แบบร่าง (DocList/Invoice/CreditNote/Deposit) แสดงเลขที่บนเอกสารร่าง แต่ TP M4 ให้ออกเลขตอนอนุมัติ (กันเลขใบกำกับขาดช่วง ม.86/4) → แสดง "(ร่าง)" รอยืนยัน · ScreenDeposit บอกว่าใบมัดจำไม่ลงบัญชี แต่ fixtures DP2610-0006 มี receive_journal → ลงบัญชีตาม fixtures
- T11. ไม่มี spec ไฟล์นำเข้า RD Prep (ภ.ง.ด.3/53) ในเครื่อง → ทำรูปแบบไว้ชั่วคราว (`rdPrepTxt` ใน packages/db/src/reports.ts) ต้องตรวจกับ spec + validator ก่อนยื่นจริง (Gate M6)
- T12. M3.5 ต้องให้ Wei: VPS ในไทย · DNS · `deploy/.env` · ที่เก็บ backup นอกเครื่อง · ผู้ให้บริการอีเมล — ขั้นตอนใน `docs/technical-plan-M3.5.md`
- T13. ข้อขัดแย้งย่อยในแบบร่าง M4 (วันในสัปดาห์ 27/11/2569 = ศุกร์ ไม่ใช่พฤหัส · ยอดตัวอย่างไม่สอดคล้องกันบางจุด · {YY} พ.ศ./ค.ศ. · ไม่มีแบบร่างรายการ RV/BN, SO, DN) — รายการเต็มเป็น TODO(Wei) ในโค้ดของแต่ละหน้า
- T3. golden 1 ให้ Service[IV] เครดิต 4100200 แต่บรรทัด IV2611-0052 ในแบบร่าง/fixtures ระบุ 4100100 → สูตร Service[IV] ใช้บัญชีรายได้ของสูตรไปก่อน

**ข้อสังเกตที่ยังไม่แก้ (ไม่บล็อก M0–M3)**
5. `ScreenReconReport` ยอด IV 61 ใบ (1,736,580) และ RV 42 ใบ (2,104,318.60) เป็นค่ากำหนดใหม่ ไม่ได้รวมจากรายใบ เพราะ fixtures มีเอกสารไม่ครบ — ถ้าจะทำ e2e ที่ต้องรวมจากรายใบ ต้องเพิ่มเอกสารใน fixtures
6. IV2611-0001 เป็นการขาย**สินค้า** (P-1001/P-1002) จุดภาษีของสินค้าเกิดตอนส่งมอบ/ออกใบกำกับ ไม่ใช่ตอนรับเงิน แต่รายงานภาษีขาย พ.ย. ไม่มีแถวของใบนี้ — ต้องตรวจก่อน M6 (ภาษี)
7. `ScreenLedger` แสดงรายการ 9 รายการเป็นตัวอย่าง ไม่ใช่ทั้งเดือน (ยอดยกมา/ยกไปคำนวณให้ตรงแล้ว)
8. แบบร่างไม่ได้กำหนดจอเล็กกว่า 1024px · พฤติกรรมหลังคลิก/validation/ข้อความ error ส่วนใหญ่ — ดู PLAN/Spec ก่อน ไม่มีให้ถาม Wei

## 5. ขั้นถัดไป

1. M3 Innovera ID: TP (อนุมัติล่วงหน้า) → id-api/id-web (login, ผู้ใช้, องค์กร, สิทธิ์, เชิญ) · accounting-api ใช้ session แทน header dev
2. เตรียมเครื่องมือ export/import รายบริษัท ให้ทันก่อน M3.5 (เงื่อนไขของ ADR-001)
3. M3.5 → M8 ตาม `docs/page-map.md`

## 6. วิธีทำงานร่วมกับ Cowork

- Cowork = Claude Project ฝั่ง claude.ai · คุยกับ Claude Code ตรงไม่ได้ ต้องผ่าน Wei (คัดลอกข้อความ หรือใช้ `/send-to-project`)
- **ไฟล์ร่วม** (`fixtures/`, `design/`, `CLAUDE.md`, `PLAN.md`, `PROGRESS.md`): **แก้ได้ทีละฝั่ง** — แจ้งผ่าน Wei ก่อนแก้ → อีกฝั่งหยุดเขียน → แก้ → อ่านกลับจากดิสก์แนบ md5 (เคยชนกัน 22:29 วันที่ 9 พ.ย.)
- ทุกครั้งที่ฝั่งใดรายงานว่า "เสร็จ" อีกฝั่งตรวจซ้ำจากดิสก์/แบบร่างจริง: ลิงก์และปุ่ม · schema · Dr=Cr · ยอดในแบบร่างอยู่ใน fixtures ครบ · ไม่มีเลขเก่า
- แก้แบบร่าง → เผยแพร่เวอร์ชันใหม่ → ดาวน์โหลดกลับมาเทียบ → ส่งออกทับ `design/` + อัปเดต `MANIFEST.json` + เลขเวอร์ชันใน `CLAUDE.md`, `design/README.md`, `docs/page-map.md`, ไฟล์นี้

## 7. บันทึกงาน (ใหม่อยู่บน)

- **2026-11-10 สาย** · Claude Code · **M4 เสร็จ (merge เข้า main)**: migration 0007/0008/0011 · sales service (ร่าง/อนุมัติ/ลงบัญชีผ่าน engine · RV หลายใบ + 50 ทวิ + ค่าธรรมเนียม + โอนภาษีขาย ม.78/1 · CN/DN/DP · BN · void · แก้ข้อมูลอ้างอิง · แปลงเอกสาร · ลิงก์ลูกค้า) · เลขที่ระบุเองเลื่อนตัวนับ (ม.86/4) · 20 หน้าจอ + แบบพิมพ์ 8 แบบ (PDF A4) โดย subagent 3 ตัว ตรวจซ้ำแล้ว · e2e QO→IV→BN→RV→PDF ผ่าน · golden RV2611-0021 ตรง fixtures · **M3.5**: export/import รายบริษัท + restore test ผ่าน · image/compose/backup พร้อม (deploy จริงรอ Wei) · **M5 backend**: PO/AP/CNR/EXP/PV + WHT ตอนจ่าย + สายอนุมัติ + 50 ทวิ (PAYRUN ตรง fixtures) · **M6 backend** (เริ่ม): รายงานภาษี/อายุหนี้/งบ/ตรวจความถูกต้อง/ปิดงวด/ค่าเสื่อม/ธนาคาร

- **2026-11-10 เช้า** · Claude Code · **M3 เสร็จ (merge เข้า main)**: `packages/auth` (Argon2id, TOTP RFC 6238, backup codes, AES-GCM, EdDSA JWT, เมทริกซ์สิทธิ์ · coverage 100% lines) · migration 0006 · id-api (signup/verify/login/2FA/lockout/refresh rotation+reuse detection/reset/companies/invites/org/profile · 25 test บน DB+Redis จริง) · accounting-api AuthGuard (JWT + membership + สิทธิ์ต่อ route + บังคับ 2FA) · id-web 9 หน้า + accounting-web 4 หน้า (ทำโดย subagent 2 ตัว ตรวจซ้ำแล้ว) · e2e Playwright signup→2FA→invite→accept ผ่าน · ASVS L2 `docs/asvs-l2-M3.md` · `pnpm verify` เขียว (id-api 25 · db 46 · auth 18 · golden 30 · ledger 23) · DB test ของ id-api แยกเป็น `innovera_test_id`

- **2026-11-10 03:10** · Claude Code · **M2 เสร็จ (merge เข้า main)**: `packages/ui` + accounting-api GL endpoints + หน้า ScreenCOA/ScreenJournal/ScreenFormula/ScreenLedger/ScreenOpeningBalance · ยอดยกมา JV0000-0001 งวด 0 ปิดแข็ง · migrations 0003–0005 · Playwright 1.65.0 + ภาพเทียบ 1440px `docs/screens/M2/` · `pnpm verify` เขียว (db 46 · ledger 23 · golden 17 · contracts 11 · tax-th 9 · ui 7) · เพิ่ม T5

- **2026-11-10 02:00** · Claude Code · เจอช่องโหว่การตรวจ: ยอดในช่องกรอก (`<input value>`) ของแบบร่างไม่เคยถูกตรวจกับ fixtures (ทั้งของ Claude Code และ Cowork) → ขาด 6 ค่า · เติม fixtures (ไฟล์ร่วม): `opening_balance_2569_12_31_company_c.lines_full` (งบทดลองยกมาครบ 11 บัญชีจาก ScreenOpeningBalance) + `C0012.credit_limit` · เพิ่มการตรวจถาวรใน `pnpm verify` (532 ค่า ครบ)
- **2026-11-10 01:40** · Claude Code · **M2 backend เสร็จ**: engine + 8 สูตร · tax-th · postJournal/void/TB/draft idempotent · นำเข้า Excel · golden 1–10 ✅ · property 10k ✅ · แก้ fixtures (ไฟล์ร่วม): `opening_balance_2569_12_31_company_c.lines_shown` 1500100/1500190 → 1530100/1530190 ให้ตรงแบบร่าง v26 (v26 แก้ไม่ครบ)
- **2026-11-10 00:50** · Claude Code · **M1 เสร็จ**: migrations (public + acct 12 ตาราง · RLS ENABLE+FORCE ทุกตาราง · Dr=Cr deferred trigger · posted immutable · ล็อกงวดปิดแข็ง · audit append-only) · `@innovera/db` (withCompany/withPublic/createCompany/seed จาก fixtures) · `@innovera/contracts` (zod 4 + OpenAPI components) · roles migrator/app/console_reader · PgBouncer config เอง (2 DB) · test 21 ข้อ (leak, Dr=Cr, migration ย้อนได้, policy ทุกตาราง)
- **2026-11-10 00:10** · Wei + Claude Code · เลือก tenancy ทาง ค · แก้ PLAN §2 + CLAUDE.md · ปิด M0 (merge เข้า main)
- **2026-11-09 23:55** · Claude Code · M0: spike tenancy ครบ (300 บริษัท · leak 17/17 · bench · ops) · รายงาน + ADR-001/002 · แนะนำทาง ค
- **2026-11-09 23:15** · Claude Code · M0: monorepo scaffold (`e0b9d23`) · Node 26.13 · pnpm 12.18 · TS 6.0.3 · Nest 12 · Next 16 · PG 18.6/PgBouncer 1.26.1/Redis 8.10.3 · `pnpm verify` เขียว
- **2026-11-09 23:00** · Claude Code · `git init` ในโฟลเดอร์นี้ (แทนการคัดลอกไป innovera-platform เพื่อไม่ให้มี 2 ชุดกับ Cowork) · commit `29a7c07`
- **2026-11-09 23:35** · Wei · ผู้ build M0 = Claude Code ในเครื่องนี้
- **2026-11-09 23:30** · Claude Code · อัป Node เครื่อง dev 20.20.2 → 26.13.0 (LTS) ผ่าน nvm ตั้งเป็น default (Wei อนุญาต)
- **2026-11-09 23:20** · Claude Code · ร่าง `docs/technical-plan-M0.md`
- **2026-11-09 23:00** · Claude Code · สร้าง `PROGRESS.md`
- **2026-11-09 22:48** · Claude Code · ปิดยอดขัดกัน 11 ข้อ → แบบร่าง v26 (12 หน้า) + fixtures/schema · Cowork ยืนยัน md5 ตรง
- **2026-11-09 22:30** · Cowork · เติม fixtures ครบทุกยอดในแบบร่าง (554 ค่า) · ส่งรายการขัดกัน 11 ข้อ
- **2026-11-09 22:18** · Claude Code · `docs/page-map.md` · ส่งออก `design-system/` · บันทึกข้อตัดสิน DS + G5/G6 + milestone
- **2026-11-09 22:04** · Cowork · ส่งออก `design/` (v25) + MANIFEST · เพิ่มกติกาอ่านแบบร่างแบบเคร่งครัดใน `CLAUDE.md`
- **2026-11-09 21:50** · Claude Code + Cowork · v24–v25: รอบจ่าย 28 พ.ย. หลังใบลดหนี้ · ค่าเช่าไม่มี VAT · ตัด ภ.ง.ด.53 แถวอู่ซ่อมที่ยังไม่จ่าย
- **2026-11-09 ช่วงเย็น** · Claude Code · v20–v22: สำรองตามกฎหมายแยกจากปิดปี · 2150110→2150400 · วันนี้ = 30 พ.ย. · สร้าง fixtures schema · แก้ PLAN (ORM เป็นคำถามเปิด, precision, golden tests, M3.5 deploy)
- **2026-11-09 ก่อนหน้า** · Cowork · เพิ่มหน้า FA1/P4/S7/R3/G5/G6 + แก้ข้อมูลไม่ตรง 4 ข้อ (v19) · สร้าง `CLAUDE.md` + fixtures รุ่นแรก
- **2026-11-04 → 09** · Claude Code · วิจัย TRCloud · Spec · มาตรฐาน UI · แบบร่างถึง v18 (ปุ่มมาตรฐาน, แบบพิมพ์ D1–D15, Sidebar, VAT ขนส่ง/ค่าเช่า)
