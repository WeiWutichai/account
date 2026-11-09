# CLAUDE.md — AccountSystem (Innovera)

บริบทถาวรของ repo นี้ อ่านก่อนทำงานทุกครั้ง · **สถานะล่าสุด/ขั้นถัดไป/เรื่องเปิดอยู่ อยู่ใน `PROGRESS.md` (อ่านก่อนเมื่อเริ่ม chat ใหม่ และอัปเดตทุกครั้งที่จบงาน)** · งานปัจจุบันอยู่ใน `PLAN.md` (Phase 1) · ตัวเลขตัวอย่างชุดเดียวอยู่ใน `fixtures/sample-company.json`

## โปรเจกต์นี้คืออะไร
ระบบบัญชี SaaS หลายบริษัท (multi-tenant) สำหรับ SME ไทย ภายใต้แบรนด์ Innovera · เป็น **hub** ที่แอป Innovera อื่น (TMS ก่อน) เชื่อมเข้ามา · เป้าหมาย: เทียบเท่าหรือดีกว่า Express · Login/ผู้ใช้เป็นชั้น **Innovera ID** ใช้ร่วมทุกแอป · Subscription/billing เป็น Phase 2 (v1 มีแค่ hook)

## Source of truth (ลำดับความสำคัญเมื่อขัดกัน: 1 > 2 > 3)
1. `PLAN.md` + ไฟล์นี้ — กติกาและขอบเขต
2. แบบร่าง UI 76 หน้า + component เมนู 2 ตัว — สำเนาออฟไลน์ใน **`design/project/<Name>.dc.html`** (รายการใน `design/project/compat.json`, sha256 ใน `design/MANIFEST.json`) ส่งออกจาก Claude Design `https://claude.ai/artifact/LQTTxmYPCna8EntkntYCCQ` เวอร์ชัน 26 — ฟิลด์ สถานะ ปุ่ม flow ตัวเลขตัวอย่าง · กติกาการอ่านอยู่ในหัวข้อ "แบบร่าง UI" ด้านล่าง
3. Functional Spec v2 — สำเนาออฟไลน์ **`docs/functional-spec-v2.md`** (rev 14, ส่งออก 2569-11-09 · หัวไฟล์มีรายการจุดที่ Spec ล้าหลังกว่าไฟล์นี้ อ่านก่อน) ต้นทาง `https://claude.ai/artifact/HkxJ7Cj65uYB7LXBZmDhgM`
- Design System "AccountSystem · Carbon TH" — `https://claude.ai/artifact/UdMQo46L3WYvyRHCLGYuaa` **(ตัวจริง — Wei ยืนยัน 2026-11-09 · ห้ามใช้ "v2" `LwCHLbTj…`)** · สำเนาในเครื่อง `design-system/` (tokens.json ใช้สร้าง CSS vars ใน `packages/ui`)
- ถ้าแบบร่างกับ Spec ขัดกัน ให้ถาม Wei ห้ามเลือกเอง

## กติกาทางบัญชี/ภาษีที่ล็อกแล้ว (ห้ามเปลี่ยนโดยไม่ถาม)
- บริษัทตัวอย่าง = ธุรกิจบริการ จดทะเบียน VAT 7%
- **จุดภาษีบริการเกิดเมื่อรับเงิน (ม.78/1)**: IV → `Cr 2150400 ภาษีขายยังไม่ถึงกำหนด` · RV/ใบกำกับ → โอน 2150400 → `2150100 ภาษีขาย` ตามสัดส่วนที่รับ
- **หัก ณ ที่จ่ายรับรู้ตอนจ่ายเงินจริง** (PV/EXP จ่ายทันที/RV) ไม่ใช่ตอนตั้งหนี้ · ออก 50 ทวิ และเข้า ภ.ง.ด.3/53 เดือนที่จ่าย
- ค่าขนส่งในประเทศ **ไม่มี VAT** (ม.81(1)(ต)) · ค่าเช่าอสังหาฯ ไม่มี VAT (ม.81(1)(ฑ))
- v1 **ไม่มีสต็อก** · ไม่มีเงินเดือนในระบบ (มี flag ปิดไว้)
- เอกสารที่ผ่านรายการแล้ว **ไม่ลบ** — ยกเลิก = void + reversal เลขที่คงเดิม · แก้ได้เฉพาะข้อมูลอ้างอิง (ไม่ใช่ยอด/ภาษี)
- งวด: open → soft_closed (manager+ แก้ได้) → hard_closed (ห้ามแก้) · งวดที่ 13 สำหรับปิดปี · เปิดงวดคืนต้องมีเหตุผล + audit
- ตัวเลขทุกที่ใช้ `Decimal` (decimal.js) · ห้าม float · จำนวนเงิน `NUMERIC(18,2)` · qty/ราคาต่อหน่วย `NUMERIC(18,4)` · อัตราแลกเปลี่ยน `NUMERIC(18,6)` · อัตรา % `NUMERIC(7,4)` · ปัดเศษ 2 ตำแหน่งที่บรรทัดสุดท้าย (last-line rounding)
- ยอดในหน้าจอ แบบพิมพ์ รายงานภาษี ภ.พ.30/ภ.ง.ด. ต้องตรงกันข้ามหน้า — ใช้ `fixtures/sample-company.json` เป็นชุดเดียว

## รอผู้สอบบัญชี — ห้ามตัดสินใจแทน ทำเป็น config + ป้าย "รอยืนยัน"
- ค่าจ้างฟรีแลนซ์พัฒนาซอฟต์แวร์: ม.40(2) หรือ ม.40(8) — ประเภทเงินได้**และวิธีคำนวณ**ต่างกัน: 40(8) หักคงที่ 3% · 40(2) จ่ายบุคคลธรรมดาอาจต้องหักอัตราก้าวหน้าแบบ ม.50(1) → ยอดหักอาจเปลี่ยน ไม่ใช่แค่ป้ายประเภท · ค่าตั้งต้นชั่วคราว: หักคงที่ 3% (ตัวอย่าง EXP2611-0019 = 600) · config `tax.wht.freelance_software_dev = { income_type: "40(2)"|"40(8)", method: "flat"|"progressive", rate? }` ต้องรองรับทั้งสองวิธี
- ขยายกำหนดยื่นออนไลน์ (ภ.ง.ด. วันที่ 15 · ภ.พ.30 วันที่ 23) ยังใช้หรือไม่ — ค่าตั้งต้นชั่วคราวตามนี้ (`tax.filing.online_extension = true`)

## สถาปัตยกรรม (ย่อ — รายละเอียดใน PLAN.md §2 และ docs/ADR-*)
- Monorepo pnpm + turborepo · TypeScript strict · NestJS · PostgreSQL · Next.js (App Router) · Redis + BullMQ · Vitest · Playwright — ใช้รุ่นเสถียรล่าสุด ณ วันเริ่ม M0 ตรวจเลขรุ่นจริง ห้ามเดาจากความจำ
- **Tenancy (ADR-001, Wei อนุมัติ 2026-11-09): ตารางรวม + `company_id` + Row-Level Security** · data access ด้วย Kysely (ไม่ใช้ Prisma กับตารางบัญชี — พิสูจน์แล้วว่าสลับบริษัทไม่ได้)
- `apps/`: accounting-api, accounting-web, id-api, id-web (Innovera ID), console-web (admin.*) · `packages/`: db, ledger, tax-th, ui, contracts, config
- Multi-tenant: `public` (user/org/company/membership/invite/plan/subscription/entitlement) + **ตารางบัญชีรวม** ทุกตารางมี `company_id NOT NULL` + `ENABLE`/`FORCE ROW LEVEL SECURITY` · เข้าถึงได้ทางเดียวผ่าน `withCompany(companyId, tx => …)` (`set_config('app.company_id', …, true)` ใน transaction) · ห้าม query ตารางบัญชีนอก `withCompany` · แอปใช้ role ที่ไม่ใช่เจ้าของตาราง · ตารางบัญชีใหม่ทุกตารางต้องมี policy (มี test ตรวจ) · index ขึ้นต้นด้วย `company_id` · PgBouncer transaction mode → ห้าม session state · `company.db_dsn` nullable เผื่อ DB แยก
- Posting Engine (`packages/ledger`) เป็น pure TS ไม่พึ่ง Nest · posting rules เป็นข้อมูล · Dr=Cr ตรวจทั้งใน engine และ DB
- API/MCP ภายนอกสร้างได้แค่ `draft` · `external_source + external_ref` unique ต่อบริษัท · scopes ไม่มี post/pay/periods/users/settings
- Audit log append-only + hash chain · การเข้าดูข้อมูลลูกค้าโดยทีม Innovera ต้องมี consent (Console X4)

## UI
- token จาก `design-system/project/tokens.json` · **ปุ่มใช้ตามแบบร่าง ไม่ใช่ตาม token** (มุม 4px, ปุ่มรองขาวขอบเทา, ปุ่มอันตรายขาวขอบแดง, ชื่อกึ่งกลาง) — ตารางเทียบใน `design-system/README.md` · จุดต่างอื่นระหว่างระบบออกแบบกับแบบร่าง → ยึดแบบร่างแล้วแจ้ง Wei
- ใช้ component จาก `packages/ui` เท่านั้น · IBM Plex Sans Thai (หน้าจอ) · Sarabun (แบบพิมพ์ A4)
- ปุ่มมาตรฐาน 5 แบบ: หลัก (#0f62fe) · รอง (ขาว ขอบ #8d8d8d) · ข้อความ (ghost น้ำเงิน) · อันตราย (ขอบ #da1e28) · ใช้ไม่ได้ (#e0e0e0) · สูง 40/36/32 · radius 4px · ชื่อปุ่มกึ่งกลาง
- ตัวเลขชิดขวา `font-variant-numeric: tabular-nums` · ค่าลบในงบใช้วงเล็บ · ช่องศูนย์ใน Dr/Cr เว้นว่าง
- ไม่มี `href="#"` · a11y: axe 0 critical · WCAG 2.2 AA
- Sidebar ร่วม 1 ตัว (9 กลุ่ม พับได้) · ป้ายน้ำเงิน = ต้องทำ · เหลือง = ใกล้กำหนด

## แบบร่าง UI (`design/`) — อ่านอย่างเคร่งครัด
- **อ่านจากดิสก์เท่านั้น** `design/project/<Name>.dc.html` · ห้ามอ้างแบบร่างจากความจำหรือจากบทสนทนาเก่า · ห้ามเดาฟิลด์/สถานะ/ปุ่ม/ข้อความที่ไม่มีในไฟล์
- ก่อนเริ่มงาน UI ทุกครั้ง: ตรวจ `design/MANIFEST.json` ว่าทุกไฟล์มีครบและ sha256 ตรง · ถ้าไม่ตรง หยุดแล้วแจ้ง Wei (แปลว่าสำเนาไม่ใช่เวอร์ชันที่เผยแพร่)
- **รหัสหน้าจอ (S1, D10, X4 …) ↔ ไฟล์ ↔ milestone อยู่ใน `docs/page-map.md`** — อ้างชื่อไฟล์ .dc.html เสมอ ห้ามอ้างรหัสจาก Functional Spec v2 (ใช้ตัวอักษรชุดเดียวกันแต่ความหมายต่าง)
- **1 หน้าจอในระบบ = 1 ไฟล์ในแบบร่าง** ตาม `design/project/compat.json` — ทำให้ครบทุกฟิลด์ ทุกสถานะ ทุกปุ่ม ทุกข้อความ (ภาษาไทยตามไฟล์ตัวอักษรต่อตัวอักษร) ลำดับและการจัดกลุ่มตามไฟล์ · ไม่เพิ่ม ไม่ตัด ไม่เรียงใหม่ ไม่ "ปรับให้ดีขึ้น" เอง
- Sidebar และ ConsoleNav ใช้ตาม `Sidebar.dc.html` / `ConsoleNav.dc.html` เท่านั้น (กลุ่ม ลำดับ ป้าย ลิงก์) · `<dc-import name="…" active="…">` ในหน้าอื่น = จุดวาง component นั้น
- ตัวเลขทุกตัวบนหน้าจอต้องมาจาก `fixtures/sample-company.json` — ถ้าเลขในแบบร่างกับ fixtures ไม่ตรง **ห้ามเลือกเอง** หยุดแล้วถาม Wei
- สิ่งที่แบบร่าง**ไม่ได้**กำหนด (behaviour หลังคลิก, validation, ข้อความ error ที่ไม่มีในไฟล์, responsive ต่ำกว่า 1024px): ดู PLAN.md/Spec ก่อน · ถ้าไม่มี → ถาม Wei · ถ้าต้องเดินต่อให้เขียน TODO พร้อมอ้างชื่อไฟล์ .dc.html และเหตุผลใน PR
- แบบร่างขัดกับ PLAN.md/ไฟล์นี้ → PLAN.md ชนะ แต่ต้อง**แจ้ง Wei ทุกครั้ง** · แบบร่างขัดกับ Spec v2 → ถาม Wei ห้ามเลือกเอง
- ห้ามแก้ไฟล์ใน `design/` จาก repo — แก้ที่ Claude Design แล้วส่งออกใหม่ทับทั้งโฟลเดอร์ พร้อมอัปเดต `MANIFEST.json` และเลขเวอร์ชันในบรรทัด Source of truth ข้อ 2
- `design/project/support.js` และ `Blank.dc.html` เป็นของเครื่องมือ Claude Design ไม่ใช่โค้ดระบบ ห้าม import เข้าแอป · เปิดดูแบบร่างด้วย `cd design/project && python3 -m http.server 8080`
- ก่อน implement หน้าใด: เปิดทั้ง `.dc.html` ของหน้านั้นและหัวข้อ FR ที่ตรงกันใน `docs/functional-spec-v2.md` (§5–§6) แล้ว**รายงานจุดที่ไม่ตรงกันให้ Wei ก่อนเขียนโค้ด** · จุดที่หมายเหตุหัวไฟล์ Spec บอกว่าถูกตัดสินใหม่แล้ว ไม่ต้องถามซ้ำ
- ใน PR ของงาน UI ทุกครั้ง: ระบุไฟล์ .dc.html ที่ implement และแนบภาพเทียบ (แบบร่าง ↔ ของจริง) ที่ความกว้าง 1440px

## วิธีทำงาน (loop ของ Wei)
Plan → Handoff (PLAN.md) → **Technical Plan (ต้องให้ Wei อนุมัติก่อน build)** → Build → QC Gate → Close
- 1 PR ต่อ milestone · commit เล็ก single-concern · `feat(ledger): …` / `fix(tax): …` อ้าง milestone
- ก่อนทุก commit: `pnpm lint && pnpm typecheck && pnpm test` ต้องเขียว และ **แนบ output จริง** ในรายงาน — ห้ามบอกว่าผ่านโดยไม่มีหลักฐาน
- ห้าม: เพิ่ม `any`/`@ts-ignore` · query ตารางบัญชีนอก tenant context · เขียน migration ที่ย้อนไม่ได้ · ตัดสินใจเรื่องภาษีใน "รอผู้สอบบัญชี"
- เมื่อไม่แน่ใจ: ถามก่อน ไม่เดา · ถ้าต้องเดาให้เขียนเป็น TODO พร้อมเหตุผลใน PR

## คำสั่ง (จะมีจริงหลัง M0)
```
pnpm i            # ติดตั้ง
pnpm dev          # ขึ้นทุกแอป + docker compose (pg16, redis, pgbouncer)
pnpm lint && pnpm typecheck && pnpm test
pnpm test:golden  # golden tests ใน packages/ledger (PLAN.md §3)
pnpm db:migrate   # public + tenant template
pnpm db:seed      # ผังบัญชีบริการ 186 บัญชี + 24 สูตร + fixtures/sample-company.json
```
