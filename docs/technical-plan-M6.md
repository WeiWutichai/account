# Technical Plan — M6 ธนาคาร + ภาษี + ปิดงวด

> สถานะ: **อนุมัติล่วงหน้า** (Wei 2026-11-09/10) · อ้างอิง `PLAN.md` §6 (M6) · แบบร่าง: ScreenBankRecon · ScreenAging · ScreenTax · ScreenReconReport · ScreenPeriodClose · ScreenAssets · ScreenReports · ScreenReportBuilder · PrintVatSales (D12) · PrintVatPurchase (D13) · PrintPnd3Attach (D14) · PrintPnd53Attach (D15)

## Gate
ภ.พ.30 = รายงานภาษีขาย/ซื้อ = GL (test) · RD Prep TXT ผ่าน validator spec

## Backend (ทำแล้ว · `packages/db/src/reports.ts`, `close-ops.ts` · migration 0010)
- รายงานภาษีขาย: จุดภาษีบริการ = RV ที่โอนภาษีขาย (ฐาน = รับ − ภาษีที่โอน · RV2611-0021 = 1,458,130.84 / 102,069.16 ตรง fixtures) · ใบกำกับทันที/DP/CN/DN = วันที่ออก · ภาษีซื้อ: AP/EXP/DNR/CNR เดือนของใบกำกับ
- ภ.พ.30: ขาย/ยกเว้น/ภาษีขาย/ซื้อ/ภาษีซื้อ/สุทธิ + รายการล้างบัญชีเมื่อยื่น (fixtures pp30.post_on_filed)
- ภ.ง.ด.3/53 จาก 50 ทวิ ของเดือนที่จ่าย · ไฟล์ RD Prep (**TODO(Wei) T11: ไม่มี spec ในเครื่อง — รูปแบบชั่วคราว ห้ามใช้ยื่นจนตรวจกับ validator**)
- ตรวจความถูกต้อง (R3): ภาษีขาย/ซื้อ/หัก ณ ที่จ่าย ↔ GL · ลูกหนี้/เจ้าหนี้รายใบ ↔ บัญชีคุม
- อายุหนี้ AR/AP ณ วันที่ (ตัดยอดที่เกิดถึงวันนั้น) · ช่วง ยังไม่ถึงกำหนด / 1–30 / 31–60 / 61–90 / 91–120 / >120 (fixtures buckets_days)
- งบกำไรขาดทุน/งบดุลจาก GL · ปิดงวด soft/hard ตามลำดับ · เปิดคืนเฉพาะเจ้าของ + เหตุผล + audit · ปิดปีในงวด 13 (ไม่ลงสำรองตามกฎหมาย)
- ทรัพย์สิน + ค่าเสื่อมรายเดือน (golden 6 · FA-0017 เดือนแรก 1,353.41) · รันได้ครั้งเดียวต่องวด · ค่าเสื่อมสะสมยกมาจากทะเบียนเดิม
- ธนาคาร: นำเข้า CSV (กันซ้ำด้วย fingerprint) · จับคู่อัตโนมัติ ยอดเท่ากัน ±3 วัน · จับคู่เอง/ไม่สนใจ · สรุปผลต่าง statement ↔ GL
- API `/v1/tax/*`, `/v1/reports/*`, `/v1/periods*`, `/v1/assets*`, `/v1/bank/*` · tests `packages/db/test/m6.test.ts`

## ค้าง
- UI 8 หน้า + แบบพิมพ์ 4 แบบ (หลัง M5 UI) · ตัวสร้างรูปแบบงบ (R2: ตาราง `acct.report_format` พร้อม · logic ยังไม่ทำ) · OFX · ภาษีซื้อขอใช้สิทธิ์เดือนถัดไป · job อัตโนมัติ (ตอนนี้กดรันเอง)
- ตัวเลขรวมหลายรายการใน fixtures เป็นค่ากำหนด (ข้อสังเกต 5) — หน้าจอแสดงยอดที่คำนวณจริงจากข้อมูล dev
