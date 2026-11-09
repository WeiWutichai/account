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
- ยอดยกมาบริษัท C ใน fixtures แสดงแค่ 4 บรรทัด → test เติมเงินฝาก 905,520.55 และกำไรสะสม 4,009,270.55 ให้ดุลเท่ายอดรวม (ค่าสมมติ ไม่ได้มาจากแบบร่าง)
