# Page map — รหัสหน้าจอ ↔ ไฟล์แบบร่าง ↔ milestone

แบบร่างเวอร์ชัน 26 (`design/project/`) · 76 หน้า + component 2 ตัว · ไฟล์นี้ใช้แทนรหัสหน้าจอใน PLAN.md §6 — **อ้างชื่อไฟล์เสมอ** เพราะรหัสใน Functional Spec v2 (A1–H4, 26 หน้า) ใช้ชุดตัวอักษรเดียวกันแต่ความหมายต่างกัน (เช่น Spec D1 = รายการเอกสารขาย แต่ PLAN D1 = แบบพิมพ์ใบแจ้งหนี้)

สถานะ: "PLAN ระบุ" = PLAN.md §6 กำหนด milestone ไว้แล้ว · "Wei อนุมัติ" = PLAN ไม่ได้ระบุไว้ Wei อนุมัติตามข้อเสนอเมื่อ 2026-11-09

| ไฟล์ | ชื่อหน้า | รหัส | Milestone | สถานะ |
|---|---|---|---|---|
| `ScreenCOA.dc.html` | ผังบัญชี | B1 | M2 | PLAN ระบุ |
| `ScreenJournal.dc.html` | บันทึกรายวัน | B2 | M2 | PLAN ระบุ |
| `ScreenFormula.dc.html` | สูตรลงบัญชี | B3 | M2 | PLAN ระบุ |
| `ScreenLedger.dc.html` | แยกประเภท | B4 | M2 | PLAN ระบุ |
| `ScreenOpeningBalance.dc.html` | ยอดยกมา | A4 | M2 | PLAN ระบุ |
| `ScreenContacts.dc.html` | คู่ค้า | C1 | M2 | Wei อนุมัติ 2026-11-09 |
| `ScreenProducts.dc.html` | สินค้าและบริการ | C2 | M2 | Wei อนุมัติ 2026-11-09 |
| `ScreenLogin.dc.html` | เข้าสู่ระบบ | A1 | M3 | PLAN ระบุ |
| `ScreenSignup.dc.html` | สมัครใช้งาน — Innovera ID | A1 | M3 | PLAN ระบุ |
| `ScreenTwoFactor.dc.html` | ยืนยันตัวตน 2 ชั้น (2FA) | A1 | M3 | PLAN ระบุ |
| `ScreenPasswordReset.dc.html` | ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่ | A1 | M3 | PLAN ระบุ |
| `ScreenCompanyPicker.dc.html` | เลือกบริษัท | A2 | M3 | PLAN ระบุ |
| `ScreenCompanyCreate.dc.html` | สร้างบริษัทใหม่ | A3 | M3 | PLAN ระบุ |
| `ScreenPlan.dc.html` | แผนและการเรียกเก็บเงิน | A5 | M3 | PLAN ระบุ |
| `ScreenProfile.dc.html` | บัญชีของฉัน — Innovera ID | A6 | M3 | PLAN ระบุ |
| `ScreenOrgMembers.dc.html` | องค์กรและสมาชิก — Innovera ID | A7 | M3 | PLAN ระบุ |
| `ScreenInviteAccept.dc.html` | รับคำเชิญเข้าบริษัท | A7 | M3 | PLAN ระบุ |
| `Main.dc.html` | หน้าแรก — คิวงาน | S1 | M4 | Wei อนุมัติ 2026-11-09 |
| `ScreenDocList.dc.html` | รายการใบกำกับภาษี | S2 | M4 | PLAN ระบุ |
| `ScreenInvoice.dc.html` | ฟอร์มใบกำกับภาษี | S3 | M4 | PLAN ระบุ |
| `ScreenQuote.dc.html` | ใบเสนอราคา / ใบสั่งขาย | S4 | M4 | PLAN ระบุ |
| `ScreenCreditNote.dc.html` | ใบลดหนี้ / เพิ่มหนี้ | S5 | M4 | PLAN ระบุ |
| `ScreenSendDoc.dc.html` | หน้าเอกสารสำหรับลูกค้า | S6 | M4 | PLAN ระบุ |
| `ScreenDeposit.dc.html` | เงินมัดจำ | S7 | M4 | PLAN ระบุ |
| `ScreenBilling.dc.html` | ใบวางบิล / รับวางบิล | F1 | M4 | PLAN ระบุ |
| `ScreenReceipt.dc.html` | รับชำระ | F2 | M4 | PLAN ระบุ |
| `ScreenCheque.dc.html` | ทะเบียนเช็ค | F4 | M4 (รับ) + M5 (จ่าย) | PLAN ระบุ |
| `ScreenDocVoid.dc.html` | ยกเลิก / กลับรายการเอกสาร | — | M4 | Wei อนุมัติ 2026-11-09 |
| `ScreenDocEdit.dc.html` | แก้ไขเอกสารที่ผ่านรายการแล้ว | — | M4 | Wei อนุมัติ 2026-11-09 |
| `PrintInvoice.dc.html` | แบบพิมพ์ ใบแจ้งหนี้ | D1 | M4 | PLAN ระบุ |
| `PrintReceiptTax.dc.html` | แบบพิมพ์ ใบเสร็จรับเงิน/ใบกำกับภาษี | D2 | M4 | PLAN ระบุ |
| `PrintCreditNote.dc.html` | แบบพิมพ์ ใบลดหนี้ | D3 | M4 | PLAN ระบุ |
| `PrintDebitNote.dc.html` | แบบพิมพ์ ใบเพิ่มหนี้ | D5 | M4 | PLAN ระบุ |
| `PrintBilling.dc.html` | แบบพิมพ์ ใบวางบิล | D6 | M4 | PLAN ระบุ |
| `PrintQuote.dc.html` | แบบพิมพ์ ใบเสนอราคา | D8 | M4 | PLAN ระบุ |
| `PrintReceiptNoVat.dc.html` | แบบพิมพ์ ใบเสร็จรับเงิน (ไม่มีภาษีมูลค่าเพิ่ม) | D10 | M4 | PLAN ระบุ |
| `PrintReceiptVoucher.dc.html` | แบบพิมพ์ ใบสำคัญรับ | D11 | M4 | PLAN ระบุ |
| `ScreenPurchaseOrder.dc.html` | ใบขอซื้อ / ใบสั่งซื้อ | P0 | M5 | PLAN ระบุ |
| `ScreenPurchaseList.dc.html` | รายการบิลซื้อ | P1 | M5 | PLAN ระบุ |
| `ScreenPurchaseBill.dc.html` | บิลซื้อ | P2 | M5 | PLAN ระบุ |
| `ScreenExpense.dc.html` | ค่าใช้จ่าย | P3 | M5 | PLAN ระบุ |
| `ScreenPurchaseCreditNote.dc.html` | ใบลดหนี้ / เพิ่มหนี้ (ซื้อ) | P4 | M5 | PLAN ระบุ |
| `ScreenPayment.dc.html` | จ่ายชำระ | F3 | M5 | PLAN ระบุ |
| `ScreenPettyCash.dc.html` | เงินสดย่อย | F5 | M5 | PLAN ระบุ |
| `PrintWht50.dc.html` | แบบพิมพ์ หนังสือรับรอง 50 ทวิ | D4 | M5 | PLAN ระบุ |
| `PrintPaymentVoucher.dc.html` | แบบพิมพ์ ใบสำคัญจ่าย | D7 | M5 | PLAN ระบุ |
| `PrintPurchaseOrder.dc.html` | แบบพิมพ์ ใบสั่งซื้อ | D9 | M5 | PLAN ระบุ |
| `ScreenBankRecon.dc.html` | กระทบยอดธนาคาร | F6 | M6 | PLAN ระบุ |
| `ScreenAging.dc.html` | อายุหนี้ | F7 | M6 | PLAN ระบุ |
| `ScreenTax.dc.html` | ภาษี | T1 | M6 | PLAN ระบุ |
| `ScreenReconReport.dc.html` | รายงานตรวจความถูกต้อง | R3 | M6 | PLAN ระบุ |
| `ScreenPeriodClose.dc.html` | ปิดงวดบัญชี | B5 | M6 | PLAN ระบุ |
| `ScreenAssets.dc.html` | ทะเบียนทรัพย์สิน | B6 | M6 | PLAN ระบุ |
| `ScreenReports.dc.html` | รายงาน | R1 | M6 | Wei อนุมัติ 2026-11-09 |
| `ScreenReportBuilder.dc.html` | ตัวสร้างรูปแบบงบ | R2 | M6 | Wei อนุมัติ 2026-11-09 |
| `PrintVatSales.dc.html` | แบบพิมพ์ รายงานภาษีขาย | D12 | M6 | PLAN ระบุ |
| `PrintVatPurchase.dc.html` | แบบพิมพ์ รายงานภาษีซื้อ | D13 | M6 | PLAN ระบุ |
| `PrintPnd3Attach.dc.html` | แบบพิมพ์ ใบแนบ ภ.ง.ด.3 | D14 | M6 | PLAN ระบุ |
| `PrintPnd53Attach.dc.html` | แบบพิมพ์ ใบแนบ ภ.ง.ด.53 | D15 | M6 | PLAN ระบุ |
| `ScreenSettings.dc.html` | ตั้งค่าบริษัท | G1 | M1–M2 | Wei อนุมัติ 2026-11-09 |
| `ScreenUsers.dc.html` | ผู้ใช้และสิทธิ์ | G2 | M3 | Wei อนุมัติ 2026-11-09 |
| `ScreenUserEdit.dc.html` | แก้ไขผู้ใช้และสิทธิ์ | G2 | M3 | Wei อนุมัติ 2026-11-09 |
| `ScreenDocSettings.dc.html` | ตั้งค่าเอกสาร | G5 | M4 | Wei อนุมัติ 2026-11-09 |
| `ScreenDocSeriesEdit.dc.html` | แก้ไขชุดเลขที่เอกสาร | G5 | M4 | Wei อนุมัติ 2026-11-09 |
| `ScreenApps.dc.html` | แอปที่เชื่อมต่อ | G3 | M7 | PLAN ระบุ |
| `ScreenMcp.dc.html` | MCP / OAuth client | G6 | M7 | Wei อนุมัติ 2026-11-09 |
| `ScreenRevoke.dc.html` | เพิกถอนสิทธิ์การเข้าถึง | — | M7 | Wei อนุมัติ 2026-11-09 |
| `ScreenAudit.dc.html` | ประวัติการใช้งาน | G4 | M7 | Wei อนุมัติ 2026-11-09 |
| `ConsoleOverview.dc.html` | Innovera Console — ภาพรวม | X1 | M8 | PLAN ระบุ |
| `ConsoleTenants.dc.html` | Innovera Console — องค์กร | X2 | M8 | PLAN ระบุ |
| `ConsoleSupport.dc.html` | Innovera Console — Support | X4 | M8 | PLAN ระบุ |
| `ConsoleOps.dc.html` | Innovera Console — Ops | X7 | M8 | PLAN ระบุ |
| `ConsoleFlags.dc.html` | Innovera Console — แอปและ feature flags | X5 | M8 | Wei อนุมัติ 2026-11-09 |
| `ConsoleBilling.dc.html` | Innovera Console — Subscription & billing | X3 | Phase 2 | Wei อนุมัติ 2026-11-09 |
| `ConsoleReference.dc.html` | Innovera Console — ข้อมูลอ้างอิงกลาง | X6 | M8 | Wei อนุมัติ 2026-11-09 |
| `ConsoleTeam.dc.html` | Innovera Console — ทีมและ Audit | X8 | M8 | Wei อนุมัติ 2026-11-09 |
| `Sidebar.dc.html` | Side nav | component | M2 (ใช้ทุกหน้า) | PLAN ระบุ |
| `ConsoleNav.dc.html` | Console nav | component | M8 | PLAN ระบุ |

## ข้อตัดสินของ Wei (2026-11-09)
1. **G5 = ตั้งค่าเอกสาร (`ScreenDocSettings`, `ScreenDocSeriesEdit`) · G6 = MCP (`ScreenMcp`)** — ใบสั่งงาน Cowork รอบแรกที่ให้ G5 = MCP ถือว่ายกเลิก
2. milestone ของหน้าที่ PLAN ไม่ได้ระบุ ใช้ตามตารางนี้
3. Console: X3 (Subscription & billing) เป็น Phase 2 · X5/X6/X8 อยู่ใน M8

ตรวจแล้วว่าทุกไฟล์ใน `design/project/compat.json` (ยกเว้น `Blank.dc.html`) อยู่ในตารางนี้ครั้งเดียว

## วันที่ "วันนี้" ใน dev
`pnpm dev` ตั้ง `APP_TODAY=2026-11-30` (30 พ.ย. 2569 ตามข้อตัดสินของ Wei) ให้ accounting-api และ accounting-web · production ใช้วันที่จริง
