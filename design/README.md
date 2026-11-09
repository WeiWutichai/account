# design/ — แบบร่าง UI AccountSystem (Claude Design เวอร์ชัน 26)

สำเนาออฟไลน์ของไฟล์ที่เผยแพร่จริงจาก https://claude.ai/artifact/LQTTxmYPCna8EntkntYCCQ (version id `1794239284-7b59`, ส่งออก 2569-11-09)
**อ่านอย่างเดียว** — แก้แบบร่างที่ Claude Design แล้วส่งออกใหม่ทับทั้งโฟลเดอร์ · ตรวจความครบถ้วนด้วย `MANIFEST.json` (sha256 ทุกไฟล์)

## โครงสร้าง
- `project/<Name>.dc.html` — 1 ไฟล์ = 1 หน้า (HTML + inline style · `<dc-import name="Sidebar">` / `ConsoleNav` คือเมนูร่วม)
- `project/compat.json` — รายการหน้าทั้งหมด `{path,title,kind,name}` ใช้เป็น index
- `project/support.js` — runtime ของ Claude Design สำหรับเปิดไฟล์ดูในเบราว์เซอร์ (ไม่ใช่โค้ดของระบบ)
- `project/Blank.dc.html` — หน้าว่างของเครื่องมือ ไม่ใช่หน้าในระบบ

## วิธีเปิดดู
```
cd design/project && python3 -m http.server 8080   # เปิด http://localhost:8080/Main.dc.html
```

## หน้าใน compat.json (79 รายการ)

### page (79)
- `Main.dc.html` — หน้าแรก — คิวงาน
- `ScreenDocList.dc.html` — รายการใบกำกับภาษี
- `ScreenInvoice.dc.html` — ฟอร์มใบกำกับภาษี
- `ScreenDocVoid.dc.html` — ยกเลิก / กลับรายการเอกสาร
- `ScreenQuote.dc.html` — ใบเสนอราคา / ใบสั่งขาย
- `ScreenCreditNote.dc.html` — ใบลดหนี้ / เพิ่มหนี้
- `ScreenDeposit.dc.html` — เงินมัดจำ
- `ScreenPurchaseOrder.dc.html` — ใบขอซื้อ / ใบสั่งซื้อ
- `ScreenPurchaseList.dc.html` — รายการบิลซื้อ
- `ScreenPurchaseBill.dc.html` — บิลซื้อ
- `ScreenDocEdit.dc.html` — แก้ไขเอกสารที่ผ่านรายการแล้ว
- `ScreenPurchaseCreditNote.dc.html` — ใบลดหนี้ / เพิ่มหนี้ (ซื้อ)
- `ScreenExpense.dc.html` — ค่าใช้จ่าย
- `ScreenBilling.dc.html` — ใบวางบิล / รับวางบิล
- `ScreenReceipt.dc.html` — รับชำระ
- `ScreenPayment.dc.html` — จ่ายชำระ
- `ScreenCheque.dc.html` — ทะเบียนเช็ค
- `ScreenPettyCash.dc.html` — เงินสดย่อย
- `ScreenBankRecon.dc.html` — กระทบยอดธนาคาร
- `ScreenAging.dc.html` — อายุหนี้
- `ScreenTax.dc.html` — ภาษี
- `ScreenReconReport.dc.html` — รายงานตรวจความถูกต้อง
- `ScreenReports.dc.html` — รายงาน
- `ScreenReportBuilder.dc.html` — ตัวสร้างรูปแบบงบ
- `ScreenPeriodClose.dc.html` — ปิดงวดบัญชี
- `ScreenSettings.dc.html` — ตั้งค่าบริษัท
- `ScreenDocSettings.dc.html` — ตั้งค่าเอกสาร
- `ScreenDocSeriesEdit.dc.html` — แก้ไขชุดเลขที่เอกสาร
- `ScreenUsers.dc.html` — ผู้ใช้และสิทธิ์
- `ScreenUserEdit.dc.html` — แก้ไขผู้ใช้และสิทธิ์
- `ScreenApps.dc.html` — แอปที่เชื่อมต่อ
- `ScreenMcp.dc.html` — MCP / OAuth client
- `ScreenRevoke.dc.html` — เพิกถอนสิทธิ์การเข้าถึง
- `ScreenAudit.dc.html` — ประวัติการใช้งาน
- `ScreenLogin.dc.html` — เข้าสู่ระบบ
- `ScreenSignup.dc.html` — สมัครใช้งาน — Innovera ID
- `ScreenPasswordReset.dc.html` — ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่
- `ScreenTwoFactor.dc.html` — ยืนยันตัวตน 2 ชั้น (2FA)
- `ScreenInviteAccept.dc.html` — รับคำเชิญเข้าบริษัท
- `ScreenProfile.dc.html` — บัญชีของฉัน — Innovera ID
- `ScreenOrgMembers.dc.html` — องค์กรและสมาชิก — Innovera ID
- `ScreenCompanyPicker.dc.html` — เลือกบริษัท
- `ScreenCompanyCreate.dc.html` — สร้างบริษัทใหม่
- `ScreenOpeningBalance.dc.html` — ยอดยกมา
- `ScreenPlan.dc.html` — แผนและการเรียกเก็บเงิน
- `ScreenSendDoc.dc.html` — หน้าเอกสารสำหรับลูกค้า
- `ScreenCOA.dc.html` — ผังบัญชี
- `ScreenJournal.dc.html` — บันทึกรายวัน
- `ScreenFormula.dc.html` — สูตรลงบัญชี
- `ScreenLedger.dc.html` — แยกประเภท
- `ScreenAssets.dc.html` — ทะเบียนทรัพย์สิน
- `ScreenContacts.dc.html` — คู่ค้า
- `ScreenProducts.dc.html` — สินค้าและบริการ
- `PrintInvoice.dc.html` — แบบพิมพ์ ใบแจ้งหนี้
- `PrintReceiptTax.dc.html` — แบบพิมพ์ ใบเสร็จรับเงิน/ใบกำกับภาษี
- `PrintCreditNote.dc.html` — แบบพิมพ์ ใบลดหนี้
- `PrintWht50.dc.html` — แบบพิมพ์ หนังสือรับรอง 50 ทวิ
- `PrintDebitNote.dc.html` — แบบพิมพ์ ใบเพิ่มหนี้
- `PrintBilling.dc.html` — แบบพิมพ์ ใบวางบิล
- `PrintPaymentVoucher.dc.html` — แบบพิมพ์ ใบสำคัญจ่าย
- `PrintQuote.dc.html` — แบบพิมพ์ ใบเสนอราคา
- `PrintPurchaseOrder.dc.html` — แบบพิมพ์ ใบสั่งซื้อ
- `PrintReceiptNoVat.dc.html` — แบบพิมพ์ ใบเสร็จรับเงิน (ไม่มีภาษีมูลค่าเพิ่ม)
- `PrintReceiptVoucher.dc.html` — แบบพิมพ์ ใบสำคัญรับ
- `PrintVatSales.dc.html` — แบบพิมพ์ รายงานภาษีขาย
- `PrintVatPurchase.dc.html` — แบบพิมพ์ รายงานภาษีซื้อ
- `PrintPnd3Attach.dc.html` — แบบพิมพ์ ใบแนบ ภ.ง.ด.3
- `PrintPnd53Attach.dc.html` — แบบพิมพ์ ใบแนบ ภ.ง.ด.53
- `ConsoleOverview.dc.html` — Innovera Console — ภาพรวม
- `ConsoleTenants.dc.html` — Innovera Console — องค์กร
- `ConsoleBilling.dc.html` — Innovera Console — Subscription & billing
- `ConsoleSupport.dc.html` — Innovera Console — Support
- `ConsoleFlags.dc.html` — Innovera Console — แอปและ feature flags
- `ConsoleReference.dc.html` — Innovera Console — ข้อมูลอ้างอิงกลาง
- `ConsoleOps.dc.html` — Innovera Console — Ops
- `ConsoleTeam.dc.html` — Innovera Console — ทีมและ Audit
- `ConsoleNav.dc.html` — Console nav
- `Sidebar.dc.html` — Side nav
- `Blank.dc.html` — Blank

## ตัวเลขตัวอย่าง
ทุกยอดบนหน้าจอผูกกับ `../fixtures/sample-company.json` (`_meta.source` = เวอร์ชัน 26) · วันนี้ในแบบร่าง = จันทร์ 30 พ.ย. 2569
