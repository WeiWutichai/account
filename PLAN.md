# PLAN.md — AccountSystem Phase 1 (Handoff → Claude Code)

> สถานะ: **Handoff** (ขั้นที่ 2 ของ loop: Plan → Handoff → Technical Plan → Build → QC Gate → Close)
> วันที่: 2026-11-09 · เจ้าของ: Wei · ผู้ช่วย: Claude (Cowork) → Claude Code
> หลัก: human-in-the-loop ก่อน execute · commit เล็ก single-concern · verification gate ก่อนทุก commit · หลักฐานจาก test/lint เท่านั้น
> แก้ไข 2026-11-09 (Claude Code ทบทวน): ORM/tenancy เปลี่ยนเป็นคำถามเปิด + spike ใน M0 · golden test 2/3/7 ให้ตรงแบบร่าง · WHT ฝั่งรับใช้ยอดตาม 50 ทวิ · สำรองตามกฎหมายไม่ลงตอนปิดปี · เพิ่มยอดยกมา/นำเข้าข้อมูล · deploy+backup ก่อนใช้จริง · ลำดับ Ledger ก่อน ID · ความละเอียดตัวเลข · ไม่ fix เวอร์ชันจากความจำ
> ไฟล์นี้ย้ายไป `innovera-platform/docs/PLAN.md` ตอนเริ่ม M0 (โฟลเดอร์ปัจจุบันยังไม่เป็น git repo)

---

## 0. งานของ Claude Code ในรอบนี้

1. อ่านไฟล์นี้ + แหล่งอ้างอิง §1 ให้ครบ **ก่อน** เขียนโค้ด
2. เขียน **Technical Plan** (ไฟล์ `docs/TECH-PLAN-P1.md`) ตอบ §9 ทุกข้อ แล้ว **หยุดรอ Wei อนุมัติ**
3. หลังอนุมัติ ทำทีละ milestone ตาม §6 — แต่ละ milestone จบด้วย QC gate §7 แล้วรายงาน
4. ห้ามตัดสินใจแทนในเรื่อง §10 (รอผู้สอบบัญชี) — ให้ทำเป็น config/ค่าตั้งต้นที่เปลี่ยนได้

---

## 1. แหล่งอ้างอิง (source of truth)

| สิ่งที่ต้องรู้ | อยู่ที่ |
|---|---|
| **แบบร่างหน้าจอ 76 หน้า** + component เมนู 2 ตัว (S/P/F/B/T/R/C/G/A/D/X) — ใช้เป็น spec ของ UI, ฟิลด์, สถานะ, ปุ่ม, flow | Claude Design (migrated): `https://claude.ai/artifact/LQTTxmYPCna8EntkntYCCQ` · อ่านผ่าน `/design-sync` หรือ Artifact read · หน้า = `project/<Name>.dc.html` รายการหน้าอยู่ใน `project/compat.json` |
| **Design System "AccountSystem · Carbon TH"** — tokens, type, spacing, components | `https://claude.ai/artifact/UdMQo46L3WYvyRHCLGYuaa` (tokens.json, README, components/*) · **ตัวจริง (Wei ยืนยัน 2026-11-09)** — ห้ามใช้ตัว "v2" `LwCHLbTjkSWvJvgd94fW29` · สำเนาในเครื่อง `design-system/` |
| **Functional Spec v2** — FR ทั้งหมด (TN/ST/MD/GL/SL/PU/CA/TX/RP/IN/FA/PF + IG + Express additions), multi-tenant, hub model, tenant lifecycle | Claude Doc `https://claude.ai/artifact/HkxJ7Cj65uYB7LXBZmDhgM` |
| มาตรฐาน UI (เหตุผลเบื้องหลัง design) | `https://claude.ai/artifact/ADwMogMscKkykEjttgTxLF` |
| TMS (แอปที่ต้องเชื่อม) | Claude Design project "TMS v4" — ดูสัญญา API ใน §5 แทนการอ่านทั้งโปรเจกต์ |
| โน้ต handoff ก่อนหน้า | `/Users/nest/Documents/AccountSystem/research/*.md` |

**กติกาที่ตกลงแล้ว (ห้ามเปลี่ยนโดยไม่ถาม)**
- บริษัทตัวอย่าง = ธุรกิจบริการ จด VAT · **จุดภาษีของบริการเกิดเมื่อรับเงิน (ม.78/1)** → ใบแจ้งหนี้ลง `2150400 ภาษีขายยังไม่ถึงกำหนด` แล้วโอนเข้า `2150100 ภาษีขาย` ตอนออกใบเสร็จ/ใบกำกับ
- **หัก ณ ที่จ่ายรับรู้เมื่อจ่ายเงินจริง** ไม่ใช่ตอนตั้งหนี้
- ค่าขนส่งในประเทศ **ไม่มี VAT** (ม.81(1)(ต))
- v1 **ไม่มีสต็อก** (โมดูลปิด มี flag ไว้)
- ยอดในหน้าจอ แบบพิมพ์ รายงานภาษี ภ.พ.30/ภ.ง.ด. ต้องตรงกันข้ามหน้า
- UI: ปุ่มมาตรฐาน 5 แบบ (หลัก/รอง/ข้อความ/อันตราย/ใช้ไม่ได้ · 40/36/32px · radius 4px) · ไม่มี `href="#"`

---

## 2. สถาปัตยกรรมที่ตัดสินใจแล้ว

```
innovera-platform/                 (monorepo แบบเดียวกับ PropSpace: pnpm + turborepo)
├─ apps/
│  ├─ accounting-api/             NestJS — ระบบบัญชี (hub)
│  ├─ accounting-web/             Next.js (App Router) — UI ตาม Design 76 หน้า
│  ├─ id-api/                     NestJS — Innovera ID (auth, org, membership, invite)  ← ใช้ร่วมทุกแอป
│  ├─ id-web/                     Next.js — หน้า A1–A7 (login/signup/2FA/invite/profile/org)
│  └─ console-web/                Next.js — Innovera Console X1–X8 (แยกโดเมน admin.*)
├─ packages/
│  ├─ db/                         Kysely + migrations (public + ตารางบัญชีรวม + RLS policies)
│  ├─ ledger/                     Posting Engine (pure TS, ไม่พึ่ง Nest) ← หัวใจ
│  ├─ tax-th/                     VAT / WHT / ปฏิทินยื่น / RD Prep / e-Tax payload (pure TS)
│  ├─ ui/                         Carbon TH components จาก Design System (tokens.json → CSS vars)
│  ├─ contracts/                  OpenAPI + zod schemas + webhook event types (แชร์กับ TMS)
│  └─ config/                     eslint, tsconfig, prettier
└─ docs/                          PLAN.md, TECH-PLAN-P1.md, ADR/*.md
```

**Stack**: TypeScript strict · NestJS · PostgreSQL 16+ · Next.js (App Router) · Redis (rate-limit/queue) · BullMQ (jobs) · Vitest/Jest · Playwright (e2e) · Docker compose สำหรับ dev — **ใช้เวอร์ชันเสถียรล่าสุด ณ วันเริ่ม M0** และ pin ใน lockfile (ตรวจเวอร์ชันจริงก่อน ห้ามใช้จากความจำ)

**ORM / data access — ตัดสินแล้ว (ADR-001, Wei 2026-11-09)**: spike M0 พิสูจน์ว่า Prisma ใช้ `search_path` สลับบริษัทไม่ได้ (ยังหา `public.document`) · เลือก **ทาง ค: ตารางรวม + `company_id` + Postgres Row-Level Security** · data access ด้วย **Kysely** (ยืนยันใน TP M1) · ผลทดลอง `docs/spike-tenancy-report.md`

**Multi-tenant** (FR-TN):
- `public` schema: `user`, `tenant(org)`, `company`, `membership`, `invite`, `plan`, `subscription`(hook), `entitlement`, `audit_console`
- **ตารางบัญชีทุกตารางเป็นตารางรวม มีคอลัมน์ `company_id NOT NULL`** · `ENABLE` + `FORCE ROW LEVEL SECURITY` · policy `company_id = current_setting('app.company_id')` ทั้ง USING และ WITH CHECK · index ทุกตัวขึ้นต้นด้วย `company_id`
- ทุก request: resolve `company_id` → `withCompany(companyId, tx => …)` = `set_config('app.company_id', …, true)` ใน transaction (ทางเดียวที่เข้าถึงตารางบัญชีได้) · PgBouncer **transaction mode** → ห้าม session-level state
- แอปต่อด้วย role ที่ไม่ใช่เจ้าของตาราง (RLS ไม่ถูกข้าม) · งานข้ามบริษัท (Console) ใช้ role แยกที่มี `BYPASSRLS` เฉพาะ service นั้น + audit
- เครื่องมือ export/import รายบริษัท (ตาม company_id) สำหรับ backup รายบริษัท / ย้ายไป DB แยก / PDPA — ต้องมีก่อน M3.5 · migration แบบ expand/contract + `CREATE INDEX CONCURRENTLY`
- `company.db_dsn` nullable — ถ้ามี ให้ใช้ connection แยก (Enterprise: DB เดียวกันโครงเดิม มีบริษัทเดียว)
- Middleware ตรวจ membership + role ทุก route; ไม่มี route ไหนอ่านข้ามบริษัท

**Innovera ID** (A1–A7): Argon2id · TOTP (RFC 6238) + backup codes 10 ชุด (bcrypt) + lockout (ใช้แนวเดียวกับ PropSpace P1.8: Redis counters, atomic UPDATE, pending-session cookie ผูก IP/UA HMAC) · session JWT สั้น + refresh rotation · OAuth 2.1 + PKCE server สำหรับแอป Innovera (TMS) และ MCP client · Org roles: owner/admin/billing_admin/member/guest

---

## 3. Posting Engine (packages/ledger) — ข้อกำหนดที่ต้องผ่าน test

- **Posting rule เป็นข้อมูล** (ตาราง `posting_rule` + `posting_rule_line`): doc_type, event (post/pay/void), lines[{side, account_resolver, amount_key, condition}]
- `amount_key` ∈ {grand_total, subtotal, discount, vat, wht, fee, deposit_applied, line.amount, line.vat, line.cost}
- **ลำดับหาบัญชี**: บรรทัดเอกสาร → สินค้า/บริการ → คู่ค้า → ค่าตั้งต้นของ rule → error (ห้ามเดา)
- **ปัดเศษ**: คำนวณทุกบรรทัดด้วย decimal (ใช้ `decimal.js`, ห้าม float) ปัด 2 ตำแหน่งที่บรรทัดสุดท้ายให้ยอดรวมตรง (last-line rounding)
- **ความละเอียดตัวเลข**: จำนวนเงิน `NUMERIC(18,2)` · จำนวน (qty) และราคาต่อหน่วย `NUMERIC(18,4)` · อัตราแลกเปลี่ยน `NUMERIC(18,6)` · อัตราภาษี/ส่วนลด % `NUMERIC(7,4)`
- **Dr = Cr** บังคับ 2 ชั้น: ใน engine (throw) และ DB constraint/trigger บน `journal` (sum check)
- Journal immutable: แก้ = void + reversal (JV…R) · re-post สร้าง journal ใหม่อ้างอิงเดิม
- **งวด**: open / soft_closed / hard_closed · soft = เฉพาะ role manager+ เขียนได้ · hard = ห้ามเขียน ยกเว้นเปิดงวดคืนพร้อมเหตุผล (audit) · งวดที่ 13 สำหรับปรับปรุงปิดปี
- **จุดภาษีบริการ**: rule `Service[IV]` → Cr 2150400; rule `RV[...]` โอน 2150400 → 2150100 ตามสัดส่วนที่รับ
- **WHT ฝั่งจ่าย**: คำนวณที่ PV/EXP(จ่ายทันที) เท่านั้น · ออก 50 ทวิ + เข้า ภ.ง.ด.3/53 เดือนที่จ่าย
- **WHT ฝั่งรับ (RV)**: **ไม่คำนวณเอง** — บันทึกตามยอดในหนังสือรับรอง 50 ทวิ ที่ลูกค้าออกให้ (ลูกค้าเป็นผู้หัก) · ระบบแสดงยอดที่ควรเป็นและเตือนเมื่อต่างเกิน 1.00 บาท แต่ไม่บังคับแก้
- **สำรองตามกฎหมาย**: ไม่ลงอัตโนมัติตอนปิดปี — เป็นรายการแยก (Dr 3200100 / Cr 3300100) บันทึกเมื่อที่ประชุมผู้ถือหุ้นอนุมัติจ่ายเงินปันผล อย่างน้อย 5% ของกำไรจนครบ 10% ของทุน (ป.พ.พ. ม.1202)
- เอกสารจากแอป/MCP: สร้างได้แค่ `draft` · `external_source + external_ref` unique ต่อบริษัท (idempotent)

**Golden tests ที่ต้องมี** (ใช้ตัวเลขจากแบบร่างเป็น fixture):
1. IV2611-0052 บริการ 10,000 + VAT 700 → Dr 1130100 10,700 / Cr 4100200 10,000 / Cr 2150400 700
2. RV2611-0021 ตัด IV2610-0049 เต็ม 1,530,200 + IV2611-0053 บางส่วน 30,000 · WHT 3% ของฐาน 1,430,093.46 = 42,902.80 ตรงกับ 50 ทวิ เลขที่ 0045/2569 + ค่าธรรมเนียม 20 → Dr 1100100 1,517,277.20 / Dr 1160100 42,902.80 / Dr 5401100 20.00 / Dr 2150400 102,069.16 · Cr 1130100 1,560,200.00 / Cr 2150100 102,069.16 · Dr=Cr 1,662,269.16 · กรณีแยก: ถ้า 50 ทวิ ระบุ 42,900.00 ระบบใช้ยอดตามหนังสือ เตือนว่าต่างจากที่คำนวณ 2.80 แต่ไม่บังคับแก้
3. EXP2611-0019 จ่ายทันที ฟรีแลนซ์ ค่าจ้าง 20,000 (หัก 3% = 600) + ค่าเดินทาง 850 (ไม่หัก) → Dr 5301200 20,000 / Dr 5302100 850 · Cr 1100100 20,250 / Cr 2150300 600 (ประเภทเงินได้/อัตราเป็น config ดู §10)
4. AP2611-0088 ค่าขนส่ง 600,000 ไม่มี VAT → ตั้งหนี้ไม่มี WHT · PV จ่าย → WHT 1% 6,000
5. CNR2611-0003 ลดหนี้ซื้อ 20,000 + กลับภาษีซื้อ 1,400
6. ค่าเสื่อมรายเดือน FA-0017 (78,000−1)/3 ปี เดือนแรก 19 วัน = 1,353.41 · เดือนสุดท้ายปรับให้สะสม = ทุน−ซาก พอดี
7. ปิดปี งวด 13: ปิดรายได้/ค่าใช้จ่าย → 3900100 → 3200100 เต็มจำนวน 2,872,880.00 (ไม่มีสำรองตามกฎหมายในรายการนี้) · test แยก: บันทึกจัดสรรสำรองตามกฎหมายตามมติปันผล → ไม่เกิน 10% ของทุนสะสม
8. void IV ที่ผ่านแล้ว → reversal ครบทุกบรรทัด, เลขที่คง, สถานะ voided
9. งวด hard_closed → post ต้อง reject · soft_closed → reject สำหรับ role accountant, ผ่านสำหรับ manager
10. idempotency: POST เอกสาร external_ref ซ้ำ → 200 คืนตัวเดิม ไม่สร้างใหม่

---

## 4. ขอบเขต Phase 1 (v1 ที่ใช้งานได้จริงกับ 1 บริษัทนำร่อง)

**ใน scope**: Innovera ID (A1–A7) · multi-tenant core · ยอดยกมา + นำเข้าข้อมูลจาก Excel (A4) · deploy production + backup/restore · ผังบัญชี/สูตร/บันทึกรายวัน/แยกประเภท (B1–B4) · ขาย QO→IV→RV (+CN/DN, มัดจำ) · ซื้อ PR→PO→AP→PV (+CNR, EXP) · วางบิล/รับวางบิล · เช็ค · เงินสดย่อย · กระทบยอดธนาคาร (นำเข้า CSV/OFX + auto-match) · อายุหนี้ · ภาษี (ภ.พ.30, ภ.ง.ด.3/53, 50 ทวิ, RD Prep TXT) · งบการเงินมาตรฐาน + drill-down · ปิดงวด/งวด 13 · ทรัพย์สิน+ค่าเสื่อม · ตั้งค่าเอกสาร (เลขที่/custom fields/PDPA) · ผู้ใช้และสิทธิ์ · Audit log (hash chain) · แบบพิมพ์ D1–D15 (PDF) · API + webhook สำหรับ TMS · MCP server (read + draft)

**นอก scope P1** (มี flag/hook): สต็อก · Subscription/billing จริง (เกตเวย์) · e-Tax ส่งจริง (ทำ payload + mock provider) · ตัวสร้างรูปแบบงบ 18 คอลัมน์ (R2) · SSO SAML · DB-per-tenant migration tool · Console X3/X5 เต็มรูป · งบกระแสเงินสด/งบรวม

---

## 5. สัญญาเชื่อมต่อ (packages/contracts) — ต้อง freeze ใน M1 เพื่อให้ TMS เริ่มได้

- `POST /v1/documents` (batch ≤ 500) body: `{external_source, external_ref, doc_type, contact{tax_id|external_ref}, lines[], dimensions{project,branch,vehicle,trip}, attachments[]}` → สร้าง `draft` · idempotent
- `GET /v1/documents/{id}` · `GET /v1/documents?external_ref=`
- `GET/PUT /v1/contacts` (sync by tax_id) · `GET /v1/ledger/balances?dimension=`
- Webhooks (HMAC-SHA256, retry 3, dead-letter): `document.posted`, `payment.received`, `payment.paid`, `document.voided`, `period.closed`
- OAuth scopes: `documents:read|draft`, `contacts:read|draft`, `ledger:read`, `reports:read`, `tax:read`, `schema:read`, `webhooks:manage` — **ไม่มี** post/pay/periods/users/settings ผ่าน API/MCP

---

## 6. Milestones (ทำตามลำดับ · 1 PR ต่อ milestone · commit เล็ก)

| # | Milestone | ส่งมอบ | Gate |
|---|---|---|---|
| M0 | Bootstrap + spike | monorepo, CI (lint/typecheck/test), docker compose (pg, redis, pgbouncer), `packages/config`, ADR-001 tenancy, ADR-002 ledger · **spike ORM/tenancy** (§2 ทางเลือก ก/ข/ค) วัดผลกับ 300 schema จำลอง | CI เขียว · `pnpm dev` ขึ้นทุกแอป · Wei อนุมัติทางเลือก tenancy |
| M1 | Contracts + DB schema | `packages/contracts` (OpenAPI + zod + webhook types) · schema `public` + tenant template ตามทางเลือกที่อนุมัติ · migration สร้าง/ลบบริษัท · seed ผังบัญชีบริการ 186 บัญชี + 24 สูตร | schema test · `createCompany()` แล้ว query ตารางบัญชีของบริษัทนั้นได้ · test อ่านข้ามบริษัทต้อง fail |
| M2 | Ledger core | `packages/ledger` Posting Engine + rules as data (pure TS ไม่ต้องรอ auth) · journal/period/lock · golden tests 1–10 · UI B1–B4 · **ยอดยกมา A4 + นำเข้าผังบัญชี/คู่ค้า/สินค้า/ลูกหนี้-เจ้าหนี้คงค้างจาก Excel** | golden tests ผ่านครบ · Dr=Cr constraint test · property test ปัดเศษ 10k เคส · นำเข้ายอดยกมาแล้วงบทดลองตรงไฟล์ต้นทาง |
| M3 | Innovera ID (ขั้นต่ำ) | signup/verify/login/2FA/backup/lockout/reset/invite/org roles · UI A1–A7 · OAuth 2.1 server เลื่อนไป M7 | unit ≥ 90% ใน auth · e2e: signup→2FA→invite→accept · OWASP ASVS L2 checklist |
| M3.5 | Deploy นำร่อง | production บน VPS (TLS, secrets, PgBouncer) · backup รายวัน + **restore test 1 บริษัท** · monitoring/alert พื้นฐาน · log ไม่มีข้อมูลส่วนบุคคล | restore สำเร็จจาก backup จริง · ต้องผ่านก่อนใส่ข้อมูลจริงของบริษัทนำร่อง |
| M4 | ขาย + รับเงิน | QO/SO/IV/CN/DN/DP · BN · RV (หลายใบ, WHT, ค่าธรรมเนียม) · เช็ครับ · D1,D2,D3,D5,D6,D8,D10,D11 PDF · S6 หน้าลูกค้า | e2e: QO→IV→BN→RV→PDF · ยอดตรงกับแบบร่าง |
| M5 | ซื้อ + จ่ายเงิน | PR/PO/AP/CNR/DNR/EXP · PV batch + สายอนุมัติ · 50 ทวิ · เช็คจ่าย · เงินสดย่อย · D4,D7,D9 | e2e: PO→AP→PV→50 ทวิ · WHT เฉพาะตอนจ่าย |
| M6 | ธนาคาร + ภาษี + ปิดงวด | นำเข้า statement + auto-match · อายุหนี้ · ภ.พ.30/ภ.ง.ด. + RD Prep TXT · D12–D15 · ตรวจความถูกต้อง R3 · ปิดงวด soft/hard/งวด 13 · ทรัพย์สิน+ค่าเสื่อม job | ภ.พ.30 = รายงานภาษีขาย/ซื้อ = GL (test) · RD Prep TXT ผ่าน validator spec |
| M7 | Hub | API §5 · webhooks · OAuth connect สำหรับ TMS · MCP server (read+draft) · G3/G6 UI · Audit hash chain | contract tests กับ mock TMS · webhook retry/dead-letter test · MCP ปฏิเสธ post_document |
| M8 | Console + Ops (หลังนำร่องใช้จริงแล้ว) | X1, X2, X4 (consent flow), X7 · feature flags · เครื่องมือ backup/restore ผ่าน UI | impersonate ต้อง consent (e2e) |

> รหัสหน้าจอในตารางนี้ (B1–B4, A1–A7, D1–D15, S6, R3, G3/G6, X1–X8) แปลงเป็นชื่อไฟล์แบบร่างได้ที่ `docs/page-map.md` · หน้าที่ตารางนี้ไม่ได้ระบุ milestone ใช้ตามไฟล์นั้น (Wei อนุมัติ 2026-11-09)

> ลำดับนี้ตั้งใจให้งานหลัก (Posting Engine + ยอดยกมา) มาก่อนระบบล็อกอิน และให้มีระบบสำรองข้อมูลที่ทดสอบ restore แล้วก่อนรับข้อมูลจริง · MCP และ Console ไม่จำเป็นต่อนิยาม "เสร็จ" §11 จึงเลื่อนไปได้ถ้าเวลาไม่พอ

---

## 7. QC Gate (ก่อนทุก commit และก่อนปิด milestone)

- [ ] `pnpm lint && pnpm typecheck && pnpm test` เขียว — แนบ output จริงในรายงาน
- [ ] ไม่มี `any`/`@ts-ignore` ใหม่ · ไม่มี float ในเงิน (lint rule ห้าม `number` ใน field money → ใช้ `Decimal`)
- [ ] ทุก query ตารางบัญชีผ่าน tenant context (test ที่พยายามอ่านข้ามบริษัทต้อง fail)
- [ ] migration ย้อนกลับได้ · seed รันซ้ำได้
- [ ] UI: ใช้ `packages/ui` เท่านั้น · a11y (axe) 0 critical · ปุ่มตามมาตรฐาน · ไม่มี `href="#"`
- [ ] ตัวเลขใน e2e ตรงกับแบบร่าง (ไฟล์ fixture `fixtures/sample-company.json` เป็นแหล่งเดียว)
- [ ] commit message: `feat(ledger): …` / `fix(tax): …` · 1 เรื่องต่อ commit · อ้าง milestone

---

## 8. สิ่งที่ Claude Code ต้องสร้างเพิ่มในรอบ Technical Plan

- `fixtures/sample-company.json` — ดึงตัวเลขจากแบบร่าง (ผังบัญชี, คู่ค้า, IV/RV/AP/PV ที่อ้างใน §3) ให้เป็นชุดเดียว
- `docs/ADR-001-tenancy.md`, `ADR-002-posting-engine.md`, `ADR-003-auth.md`
- `CLAUDE.md` ที่ root: กติกา §1, โครง §2, คำสั่ง dev/test, กติกา commit, ห้ามแตะ §10

---

## 9. คำถามที่ Technical Plan ต้องตอบ (รอ Wei อนุมัติก่อน build)

1. ~~ORM/tenancy~~ — ตอบแล้วใน M0: ทาง ค (ตารางรวม + RLS) · `docs/spike-tenancy-report.md` · `docs/ADR-001-tenancy.md`
2. โครงตาราง `journal`/`journal_line` และ constraint Dr=Cr ที่ DB (trigger vs deferred constraint)
3. การเก็บตัวเลข: ความละเอียดตาม §3 (เงิน 2 · qty/ราคา 4 · FX 6) + `decimal.js` ใน TS — ยืนยันและกำหนด helper
4. โครง `posting_rule` JSON schema และวิธี versioning rule เมื่อ tenant แก้
5. Queue/jobs: ค่าเสื่อมรายเดือน, webhook retry, นำเข้า statement — BullMQ topology
6. PDF: เลือก engine (Playwright render HTML template D1–D15 ด้วย Sarabun vs pdfmake) + ไทยตัวอักษรจำนวนเงิน
7. Audit hash chain: รูปแบบ (prev_hash, payload hash, signer) และวิธีตรวจ
8. ลำดับ milestone ที่เสนอต่างจาก §6 หรือไม่ ทำไม
9. ประมาณการเวลาแต่ละ milestone และความเสี่ยง 3 อันดับแรก

---

## 10. ห้ามตัดสินใจเอง — รอผู้สอบบัญชี (ทำเป็น config ที่เปลี่ยนได้ + ติดป้าย "รอยืนยัน" ใน UI)

- ประเภทเงินได้ค่าจ้างฟรีแลนซ์พัฒนาซอฟต์แวร์: ม.40(2) หรือ ม.40(8) และวิธีคำนวณ (คงที่ 3% หรืออัตราก้าวหน้า ม.50(1)) — ค่าตั้งต้นชั่วคราว หักคงที่ 3% · config `{ income_type, method, rate? }` · golden test 3 อาจเปลี่ยนยอด 600 ตามคำตอบ
- มาตรการขยายกำหนดยื่นออนไลน์ (ภ.ง.ด. วันที่ 15 · ภ.พ.30 วันที่ 23) ยังใช้อยู่หรือไม่ — ค่าตั้งต้นชั่วคราวตามนี้ มี flag ปิด

---

## 11. นิยาม "เสร็จ" ของ Phase 1

บริษัทนำร่อง 1 แห่งใช้จริง 1 เดือนภาษีครบวงจร: ออก IV → รับเงิน+ใบกำกับ → บันทึกซื้อ/จ่าย+50 ทวิ → กระทบยอดธนาคาร → ภ.พ.30/ภ.ง.ด. ส่งออก RD Prep → ปิดงวด soft → งบการเงินออก · TMS ส่งบิลผู้รับเหมาเข้าเป็นร่างและได้รับ `payment.paid` กลับ · ทุก golden test ผ่าน · ยอดในระบบตรงกับที่ผู้สอบบัญชีที่ปรึกษาตรวจ

---

## 12. Phase 2 — รองรับทุกประเภทธุรกิจ (Wei อนุมัติ 2026-11-10)

ขอบเขต: ครบ 12 โมดูลตาม `docs/phase2-all-business-survey.md` (เทียบ Express + ธุรกิจ software) · ข้อกำหนด "v1 ไม่มีสต็อก/เงินเดือน" ใน CLAUDE.md ใช้กับ Phase 1 เท่านั้น — Phase 2 เปิดเป็นโมดูลต่อบริษัท (ปิด = พฤติกรรม Phase 1 เดิม)

| ช่วง | โมดูล | Technical Plan |
| --- | --- | --- |
| 2A | สต็อก · หลายสกุลเงิน · สาขา · สัญญา/รายได้รับล่วงหน้า · ภ.พ.36/ภ.ง.ด.54 · สินทรัพย์ไม่มีตัวตน | `docs/technical-plan-P2A.md` (เริ่ม 2026-11-10) |
| 2B | โครงการ/ต้นทุนงาน · เงินเดือน · POS · งบประมาณ | — |
| 2C | การผลิต · ฝากขาย · สัญญาเช่า · e-Tax | — |

กติกาเพิ่ม: backend ก่อน UI (UI รอแบบร่าง `.dc.html` ใหม่จาก Claude Design) · นโยบายบัญชี/ภาษีใหม่ทุกข้อ = config + "รอยืนยัน" (ตารางใน technical plan) · fixtures ชุดใหม่ต่อธุรกิจ `fixtures/p2a-*.json` (ร่าง รอ Wei ยืนยัน) ไม่แตะ `sample-company.json`
