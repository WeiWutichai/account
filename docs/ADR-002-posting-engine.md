# ADR-002 — Posting Engine (โครง)

- สถานะ: **เสนอ** (M0) · ใช้จริงตั้งแต่ M2 · รายละเอียด rule schema ตัดสินใน Technical Plan M2
- อ้างอิง: `PLAN.md` §3 · `CLAUDE.md` (กติกาบัญชี/ภาษีที่ล็อกแล้ว) · `fixtures/sample-company.json`

## บริบท
ทุกเอกสาร (IV/RV/AP/PV/EXP/CN/DN/JV …) ต้องกลายเป็น journal ที่ Dr = Cr ด้วยกติกาภาษีไทยที่ล็อกแล้ว (จุดภาษีบริการเมื่อรับเงิน ม.78/1, WHT ตอนจ่าย, ขนส่ง/ค่าเช่าอสังหาฯ ไม่มี VAT) โดยยอดต้องตรงกันทุกหน้าและตรงกับ golden tests

## ตัดสิน
1. **`packages/ledger` เป็น pure TypeScript** ไม่ import Nest, ORM หรือ DB — รับเอกสาร + rule (ข้อมูล) → คืน journal lines หรือ error ที่ระบุสาเหตุ · ทดสอบได้โดยไม่ต้องมี DB หรือผู้ใช้
2. **ตัวเลข**
   - `Money` = wrapper ของ `decimal.js` · รับ/ส่งเป็น string ทศนิยม 2 ตำแหน่ง (`"1070.00"`) · ใน DB `NUMERIC(18,2)` · **ห้าม `number`** (ESLint บังคับใน `@innovera/config`)
   - qty/ราคาต่อหน่วย 4 ตำแหน่ง · FX 6 · อัตรา % `NUMERIC(7,4)` (helper `Qty`/`Rate` เพิ่มใน M1)
   - ปัดเศษ: คำนวณเต็มความละเอียด ปัด 2 ตำแหน่งที่บรรทัดสุดท้าย (last-line rounding) — ฟังก์ชันกลางที่เดียว
3. **Dr = Cr บังคับ 2 ชั้น**
   - ชั้น 1: engine เรียก `assertBalanced()` ก่อนคืนผล (throw `UnbalancedJournalError`)
   - ชั้น 2: DB constraint trigger `DEFERRABLE INITIALLY DEFERRED` บน `journal_line` ตรวจผลรวมต่อ journal ตอน commit (สร้างใน M1 ตามทางเลือก tenancy ที่อนุมัติ)
4. **journal immutable** — แก้ = void + reversal (เลขที่เดิม + `R`) · re-post = journal ใหม่อ้างของเดิม
5. **posting rule เป็นข้อมูล** — `doc_type`, `event` (post/pay/void), lines `{side, account_resolver, amount_key, condition}` · แก้ rule = version ใหม่ (immutable) · journal เก็บ `rule_version_id` · ลำดับหาบัญชี: บรรทัด → สินค้า → คู่ค้า → ค่าตั้งต้นของ rule → error (ห้ามเดา)
6. **golden tests อ่านจาก `fixtures/sample-company.json` เท่านั้น** — ห้าม hard-code ตัวเลขใน test

## สถานะใน M0
- มีแล้ว: `Money`, `fromTuples` (ตรวจรหัสบัญชี 7 หลัก), `totals`, `assertBalanced`, `UnbalancedJournalError`
- test: golden 1 (IV2611-0052 → Dr 1130100 10,700 / Cr 4100200 10,000 / Cr 2150400 700) + ทุก `expected_journal` ใน fixtures ต้องดุล + กรณีไม่ดุล/float/รหัสกลุ่ม
- ยังไม่มี: rule engine, rounding helper, Qty/Rate (M1–M2)

## ผลที่ตามมา
- ข้อดี: ตรรกะบัญชีทดสอบได้เร็วและแยกจากการตัดสินใจ tenancy/ORM · ตัวเลขไม่มีปัญหา float
- ข้อเสีย: ต้องแปลง `Decimal` ↔ string ที่ขอบ API/DB ทุกจุด (ทำ helper กลางใน `@innovera/db`)
