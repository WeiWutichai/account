# Technical Plan — M4 ขาย + รับเงิน

> สถานะ: **เสร็จ 2026-11-10** (Gate e2e `apps/accounting-web/e2e/sales-flow.spec.ts` ผ่าน) · **อนุมัติล่วงหน้า** (Wei 2026-11-09 "ทำงานยาวทั้งคืน" + 2026-11-10 "ทำต่อจนจบทุก milestone") · อ้างอิง `PLAN.md` §3, §6 (M4) · ADR-002 · แบบร่าง 20 ไฟล์ใน `docs/page-map.md` (S1–S7, F1–F2, G5, D1–D3, D5, D6, D8, D10, D11, DocVoid, DocEdit)

## 1. ส่งมอบ / Gate
QO/SO/IV/CN/DN/DP · BN (ใบวางบิล) · RV หลายใบ + WHT ตาม 50 ทวิ + ค่าธรรมเนียม/ส่วนต่าง · เช็ครับ · แบบพิมพ์ D1, D2, D3, D5, D6, D8, D10, D11 (PDF) · S6 หน้าเอกสารสำหรับลูกค้า · ตั้งค่าเอกสาร/ชุดเลขที่ (G5) · ยกเลิก (void + reversal) และแก้ไขข้อมูลอ้างอิงหลังผ่านรายการ
Gate: e2e QO → IV → BN → RV → PDF · ยอดตรงกับแบบร่าง/fixtures (IV2611-0052 = 10,700.00 · RV2611-0021 เงินเข้า 1,517,277.20, journal รวม 1,662,269.16)

## 2. ข้อมูล (migration 0007 — ตารางบัญชีใหม่ทุกตารางมี company_id + RLS ENABLE/FORCE + policy + index ขึ้นต้น company_id)
- `acct.document` เพิ่ม: `rule_code` · `tax_mode` (on_payment = ใบแจ้งหนี้ ออกใบกำกับเมื่อรับเงิน ม.78/1 / immediate = ใบแจ้งหนี้/ใบกำกับภาษี) · `ref_document_id` (CN/DN → IV, IV → SO, SO → QO) · `address` (บันทึกลงเอกสาร) · `notes` · `journal_id` · `created_by/approved_by/approved_at` · `voided_at/void_reason/void_journal_id` · `receive_account` · `fee/fee_account` · `wht_cert_no/wht_rate` · `bill_discount` · `credit_days` · `sent_at` · `public_token_hash` (S6)
- `acct.settlement`: RV ↔ IV/DN (ยอดตัด · ภาษีถูกหัก · ฐาน · ภาษีขายที่โอน) — ยอดค้าง = grand_total − Σตัด − Σลดหนี้ + Σเพิ่มหนี้ − มัดจำที่หัก
- `acct.billing_item`: BN ↔ IV · `acct.cheque`: เช็ครับ (เลขที่ ธนาคาร วันที่ ยอด สถานะ on_hand/deposited/cleared/bounced)
- `acct.document_event`: ประวัติ (สร้าง/แก้/ส่งอนุมัติ/อนุมัติ/ปฏิเสธ/ยกเลิก/แก้ข้อมูลอ้างอิง) พร้อมค่าก่อน/หลัง (jsonb) — แท็บ "ประวัติ" ใน ScreenInvoice
- `acct.doc_setting`: ต่อประเภทเอกสาร prefix · รูปแบบเลขที่ · รอบรีเซ็ต · ค่าอื่นของ ScreenDocSettings (jsonb)

## 3. Logic (`packages/db/src/sales.ts` · ตัวเลขผ่าน `Money` · ห้าม float)
- คำนวณยอด: บรรทัด qty × ราคา − ส่วนลด (ปัดที่บรรทัด) · ส่วนลดท้ายบิล · ราคารวม/ไม่รวม VAT (`splitInclusive`) · VAT 7% · ปัดบรรทัดสุดท้าย · จำนวนเงินเป็นตัวอักษรภาษาไทย (`bahtText`)
- สถานะ: draft → pending_approval → posted (เลขที่ออกตอนอนุมัติ) → voided · QO/SO/BN ไม่ลงบัญชี (approved แทน posted)
- ลงบัญชีผ่าน Posting Engine ด้วยสูตรของเอกสาร (`rule_code`) · RV: ตัดหลายใบ · WHT ตาม 50 ทวิ (`whtOnReceipt` เตือนเมื่อต่าง > 1.00) · โอน 2150400 → 2150100 ตามสัดส่วนที่รับ (`vatDueOnReceipt`) เฉพาะใบ tax_mode = on_payment · ค่าธรรมเนียม/ส่วนต่าง
- ยกเลิก = journal กลับรายการ เลขที่คงเดิม (ADR-002) · ยกเลิก IV ที่มีการรับชำระแล้วไม่ได้ (ต้องยกเลิก RV ก่อน) · แก้หลังผ่านรายการได้เฉพาะข้อมูลอ้างอิง (ที่อยู่ หมายเหตุ ครบกำหนด อ้างอิง) — ยอด/ภาษี/บัญชีแก้ไม่ได้ (CLAUDE.md)
- สิทธิ์: sales.write สร้าง/แก้ร่าง · sales.post อนุมัติ/ลงบัญชี · finance.* รับชำระ · void.post ยกเลิก (เมทริกซ์ ScreenUsers)

## 4. PDF (แบบพิมพ์ D*)
- HTML ตามไฟล์ `Print*.dc.html` (A4 · Sarabun) → PDF ด้วย Playwright Chromium ฝั่ง server (`page.pdf`) · ตัวเลขจากเอกสารจริง
- S6: ลิงก์สาธารณะ token สุ่ม (เก็บ hash) อ่านอย่างเดียว

## 5. UI
accounting-web: Main (S1) · ScreenDocList · ScreenInvoice · ScreenQuote · ScreenCreditNote · ScreenDeposit · ScreenBilling · ScreenReceipt · ScreenDocVoid · ScreenDocEdit · ScreenDocSettings · ScreenDocSeriesEdit · ScreenSendDoc · Print* 8 แบบ — ทำตามไฟล์ตัวอักษรต่อตัวอักษร · ภาพเทียบ 1440px `docs/screens/M4/`

## 6. Tests
golden: IV2611-0052 → journal ตาม fixtures · RV2611-0021 ทั้งชุด (ยอดตัด/WHT/ค่าธรรมเนียม/โอนภาษีขาย) · CN อ้าง IV · void กลับรายการครบ · แก้หลังผ่านรายการเปลี่ยนยอดไม่ได้ · bahtText ตาม amount_text ใน fixtures · e2e QO→IV→BN→RV→PDF

## 7. TODO / รอ Wei
- แบบร่างใช้ชื่อสูตร "RV[Bank]" แต่สูตรตั้งต้นของระบบชื่อ "Receive[RV]" — ใช้ชื่อในระบบ แสดงตามสูตรที่ใช้จริง
- IV2611-0001 ขายสินค้า: จุดภาษี (ข้อสังเกต 6 ใน PROGRESS) — ใช้ tax_mode = immediate สำหรับสินค้า รอ Wei ยืนยัน
