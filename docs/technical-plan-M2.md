# Technical Plan — M2 Ledger core

> สถานะ: **อนุมัติล่วงหน้า** (Wei สั่งทำต่อเนื่องข้ามคืน 2026-11-09) · อ้างอิง `PLAN.md` §3, §6 (M2) · ADR-002

## ส่งมอบ
1. `packages/ledger`: Posting Engine (สูตรเป็นข้อมูล · ลำดับหาบัญชี บรรทัด → สินค้า → คู่ค้า → ค่าในสูตร → error) · สูตรตั้งต้น 8 ตัว (Service[IV], Credit[IV], CN[ref IV], Receive[RV], Credit[AP], Cash[EXP], Pay[PV], CNR) · Money (decimal.js) + last-line rounding (`allocate`) · reversal · ค่าเสื่อมเส้นตรงรายเดือน · ปิดปี + สำรองตามกฎหมาย · สิทธิ์ลงรายการตามสถานะงวด
2. `packages/tax-th`: แยก VAT ราคารวม · VAT ที่ถึงกำหนดเมื่อรับเงิน (ม.78/1) · WHT ฝั่งจ่าย (config + ธง "รอยืนยัน" · อัตราก้าวหน้า = PendingAuditorError) · WHT ฝั่งรับตาม 50 ทวิ + คำเตือนเมื่อต่าง > 1.00
3. `packages/db`: `postJournal`/`postJournalTx` (เลขที่ {PREFIX}{YY}{MM}-{####} · YY = ค.ศ.) · `voidJournal` (เลขเดิม+R · audit) · `trialBalance` · `createDraftDocument` (idempotent ตาม external_source+external_ref) · นำเข้า Excel (ผังบัญชี/คู่ค้า/สินค้า/ยอดยกมา/ลูกหนี้-เจ้าหนี้คงค้าง) ตรวจทั้งไฟล์ก่อน · บันทึกใน transaction เดียว
4. `packages/golden`: golden 1–9 จาก fixtures · golden 10 + ยอดยกมาอยู่ใน `packages/db/test/m2.test.ts` (ต้องใช้ DB)
5. UI B1–B4 + A4 (ผังบัญชี · บันทึกรายวัน · สูตรลงบัญชี · แยกประเภท · ยอดยกมา) ตาม `design/project/*.dc.html` — ทำต่อใน M2b (ต้องวางฐาน `packages/ui` ก่อน)

## Gate
golden tests ผ่านครบ ✅ · Dr=Cr constraint test ✅ (M1) · property test ปัดเศษ 10k เคส ✅ · นำเข้ายอดยกมาแล้วงบทดลองตรงไฟล์ต้นทาง ✅ (6,317,920.55)

## TODO (Wei)
- T3: golden 1 ให้ Service[IV] เครดิต 4100200 แต่บรรทัดเอกสารในแบบร่าง/fixtures ระบุ 4100100 → Service[IV] ใช้บัญชีรายได้ของสูตร ไม่อ่านจากบรรทัด
- ~~ยอดยกมาบริษัท C ใน fixtures แสดงแค่ 4 บรรทัด~~ → แก้แล้ว: fixtures `lines_full` 11 บัญชีจากแบบร่าง (test ใช้ชุดนี้)
- T5: fixtures `gl_balances_2569_11_30` มีเฉพาะยอดของแถวตัวอย่าง (ยอดกลุ่ม = ผลรวมแถวที่แสดง) ไม่มีงบทดลองครบที่ดุล → บริษัท dev แสดงยอดจริงจากรายการตัวอย่างที่ลงบัญชี ไม่ตรงตัวเลขในแบบร่าง ScreenCOA/ScreenLedger · ถ้าต้องการให้ตรง ต้องมีงบทดลอง 30/11/2569 ครบชุดใน fixtures

## M2b — UI (เสร็จ 2026-11-10)
- `packages/ui`: tokens.css จาก design-system · `css()` อ่าน style string ที่คัดลอกจาก .dc.html ตรงตัว · Button 5 แบบ (ตามแบบร่าง ไม่ใช่ token) · Tag · Sidebar ตาม `Sidebar.dc.html` (9 กลุ่ม พับได้) · AppShell/TopBar · `routes.ts` (id ↔ path ↔ ไฟล์แบบร่าง ↔ milestone)
- accounting-api (Nest, ESM): `/v1/context, accounts(+export), import(+template), opening (GET/POST), ledger(+export), rules (+preview), contacts, journals (+templates, by-no, post)` · ส่งบริษัท/บทบาทผ่าน header ชั่วคราว (TODO M3: session Innovera ID)
- accounting-web (port 3010): B1 `/gl/accounts` ScreenCOA · B2 `/gl/journal` ScreenJournal · B3 `/gl/rules` ScreenFormula · B4 `/gl/ledger` ScreenLedger · A4 `/setup/opening-balance` ScreenOpeningBalance · หน้าอื่น = "ยังไม่เปิดใช้" + milestone
- ยอดยกมา = JV0000-0001 ในงวด 0 (31 ธ.ค. ปีก่อน) ปิดแข็งทันทีตามแบบร่าง · กรอกบนจอและนำเข้า Excel ใช้ชุดตรวจเดียวกัน · ลงซ้ำไม่ได้
- ภาพเทียบ 1440px: `docs/screens/M2/*.design.png` ↔ `*.app.png` (`node scripts/screens.mjs`)
- TODO ในโค้ด (อ้างไฟล์แบบร่าง): ฟอร์มเพิ่มบัญชี (ScreenCOA ไม่มีแบบ) · ตัวเลือกบัญชีของ "+ เพิ่มบัญชี" (ScreenOpeningBalance) · แท็บรายใบ/เช็ค/สินทรัพย์ และข้อความรายละเอียดจากทะเบียนสินทรัพย์/statement (M6) · ป้ายตัวเลขใน Sidebar (มาจากโมดูล M4–M6)
