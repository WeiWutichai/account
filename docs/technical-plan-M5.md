# Technical Plan — M5 ซื้อ + จ่ายเงิน

> สถานะ: **เสร็จ 2026-11-10** (รายการค้างอยู่ท้ายไฟล์) · **อนุมัติล่วงหน้า** (Wei 2026-11-09/10 "ทำต่อจนจบทุก milestone") · อ้างอิง `PLAN.md` §6 (M5) · CLAUDE.md (WHT รับรู้ตอนจ่าย · ฟรีแลนซ์รอผู้สอบบัญชี) · แบบร่าง: ScreenPurchaseOrder · ScreenPurchaseList · ScreenPurchaseBill · ScreenExpense · ScreenPurchaseCreditNote · ScreenPayment · ScreenPettyCash · PrintWht50 (D4) · PrintPaymentVoucher (D7) · PrintPurchaseOrder (D9)

## Gate
e2e PO → AP → PV → 50 ทวิ · WHT เฉพาะตอนจ่าย

## ทำแล้ว (backend · `packages/db/src/purchase.ts` · migration 0009)
- เอกสาร PR/PO (ไม่ลงบัญชี) · AP (Credit[AP]) · CNR (ลดยอดค้าง · ห้ามเกินยอดค้าง) · DNR · EXP จ่ายทันที (Cash[EXP] + 50 ทวิ ทันที) หรือตั้งหนี้ (Credit[EXP])
- ประเภทเงินได้ต่อบรรทัด (`document_line.wht_type`) · อัตราตามกฎหมายใน `@innovera/tax-th` (`WHT_TYPES` ตรวจกับ fixtures) · ภ.ง.ด.3 / 53 ตามเลขผู้เสียภาษี
- ฟรีแลนซ์พัฒนาซอฟต์แวร์ = ค่าตั้งของบริษัท `tax.wht.freelance_software_dev` (ตาราง `acct.company_setting`) ค่าตั้งต้น 40(2) หักคงที่ 3% · 50 ทวิ ติดธง `pending_auditor` · ตั้งเป็น progressive → ระบบหยุด (`PendingAuditorError`) ไม่คำนวณแทนผู้สอบบัญชี
- ใบสำคัญจ่าย (PV): สร้าง = รออนุมัติ (ยังไม่ตัดเจ้าหนี้) · อนุมัติ = ต้องมีสิทธิ์อนุมัติจ่าย + วงเงิน (`approval_limit`) ≥ ยอดจ่าย + ผู้สร้างอนุมัติเองไม่ได้ (SoD · ScreenUserEdit) → ลงบัญชี Pay[PV] + ออก 50 ทวิ ต่อประเภทเงินได้
- ฐานภาษีหัก = บรรทัดที่มีประเภทเงินได้ − ใบลดหนี้ซื้อบัญชีเดียวกัน (AP2611-0079 + CNR2611-0003 → ฐาน 130,000 หัก 3,900) · จ่ายบางส่วน = ตามสัดส่วน
- รอบจ่าย (PAYRUN): บิลที่เลือก → PV 1 ใบต่อผู้ขาย (fixtures: 909,100 / หัก 13,600 / จ่าย 895,500)
- API `/v1/purchases*`, `/v1/payables`, `/v1/payments*`, `/v1/payment-runs`, `/v1/wht-certificates`, `/v1/wht-types`, `/v1/company-settings/:key`
- Tests `packages/db/test/m5.test.ts` (6 ข้อ · ตัวเลขจาก fixtures)

## ค้าง
- UI ทั้ง 10 ไฟล์แบบร่าง (ทำหลัง M4 UI) · เงินสดย่อย (imprest: รายการย่อยไม่ลง GL จนเบิกชดเชย → 1 journal ตาม fixtures petty_cash.reimburse_journal) · เช็คจ่าย (บันทึกแล้วใน `acct.cheque` direction issued)
- ระดับอนุมัติ L3 (เกิน 1,000,000 ต้องกรรมการ): ตอนนี้ใช้วงเงินของผู้อนุมัติแทนระดับ — แบบร่าง ScreenPayment กำหนดชื่อระดับ รอ UI
- TODO(Wei): บิลใน fixtures หลายใบไม่มีวันที่/รหัสผู้ขาย (ระบุใน `dev-seed-purchase.ts`)
