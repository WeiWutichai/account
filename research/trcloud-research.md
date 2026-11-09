# TRCloud (demo.trcloud.co) — Research: Accounting / API / MCP

สำรวจเมื่อ 2026-11-04 ผ่าน Chrome (ล็อกอินบัญชี demo, บริษัท company_id=195)
ขอบเขต: เฉพาะ 3 โมดูล — โปรแกรมบัญชี, RESTful API (api-connector2), MCP Server
ไม่ได้สร้าง/แก้/ลบข้อมูลใดๆ (อ่านอย่างเดียว)

> หมายเหตุ: **สังเกตได้จริง** = เห็นจากหน้าเว็บ/network ที่จับได้ · **อนุมาน** = สรุปจากรูปแบบ ยังไม่ได้ยืนยัน

---

## 0. สถาปัตยกรรมภาพรวม (สังเกตได้จริง)

| ชั้น | เทคโนโลยี |
|---|---|
| Server | PHP, หน้าเว็บแบบ server-rendered (`*.php` ต่อหน้า) |
| Frontend | jQuery + Bootstrap, Select2, bootbox, gritter, AngularJS (โหลดแต่หน้าที่ดูไม่ได้ใช้ ng-controller), alasql, bignumber.js, autoNumeric |
| Internal API (ใช้โดยหน้าเว็บ) | `/<module>/api/engine-<doc>/<action>-<doc>.php` — POST form-urlencoded |
| Public API | `/application/api-connector2/end-point/<resource>/<action>.php` |
| MCP | `/application/api-connector2/end-point/mcp/server.php?company=<id>&user=<id>` (HTTP transport + OAuth) |
| Multi-tenant | ทุก request มี `company_id`; ผู้ใช้หนึ่งคนสลับได้หลายบริษัท (`/application/company-list`) |

### รูปแบบ Internal API (สังเกตได้จริง)
- Request: form field เดียวชื่อ `json` = JSON object
  ```json
  { "company_id": "...", "passkey": "...", "table": "...",
    "keyword": "", "page": "1", "limit": 50,
    "advance": { "advance_search": 0,
                 "search": [{"column":"","condition":"","value":""}],
                 "sort":   [{"column":"","condition":""}] } }
  ```
- Response: `{ "success": 1|0, "message": "...", "result": [...] }`
  เอกสารเดี่ยว (retrieve) ตอบเป็น `{ head: {...}, body: [...], dropbox: [], create_by, update_by }`
- ทุกเอกสารมีชุด action เดียวกัน: `init`, `search`, `count`, `retrieve`, `recal`, `delete`, `ask-approve`, `add-to-watchlist`, `get-link`, `pdf_formation`

---

## 1. โปรแกรมบัญชี (Accounting)

### 1.1 เมนู/โมดูล (สังเกตได้จริง)
| กลุ่ม | หน้า |
|---|---|
| ภาพรวม | Dashboard, อนุมัติ/ตรวจสอบ (approve), จัดการผู้ใช้, จัดการหมวดหมู่ |
| **การบัญชี** | สมุดบัญชีรายวัน `gl/gl.php`, ผังบัญชี `gl/coa.php`, การจัดการบัญชี `gl/adjust.php`, **ตั้งค่าสูตรบัญชี** `gl/setting-new.php`, วงเงินสดย่อย (petty cash), รายการประจำ (recurring) |
| ขาย & รายได้ | QO ใบเสนอราคา → SO ใบสั่งขาย → BL ใบแจ้งหนี้ → IV ใบกำกับภาษี, CN ใบลดหนี้, ECOM, รายงานภาษีขาย |
| ซื้อ & รายจ่าย | PR ใบขอซื้อ → BID เปรียบเทียบราคา → PO ใบสั่งซื้อ → AP เอกสารซื้อ, EXP รายจ่ายอื่น, CNR ใบลดหนี้ซื้อ, EPO, รายงานภาษีซื้อ |
| การเงิน | ปฏิทิน, กระแสเงินสดอนาคต, BN ใบวางบิล, RV ใบเสร็จ, BNR รับใบวางบิล, PV ใบสำคัญจ่าย, เช็ค/เงินโอน, กระทบยอดธนาคาร, WHT ภาษีหัก ณ ที่จ่าย |
| ลูกค้าสัมพันธ์ | Lead, ลงทะเบียนผู้ขาย/ลูกค้า, Upsell, RFP เรียกชำระเงิน, QR e-Tax |
| ทะเบียนคู่ค้า | รายชื่อคู่ค้า, กลุ่มคู่ค้า |
| คลังสินค้า | สรุปสินค้า, กลุ่มสินค้า, MR เบิก, GR รับ, TR ย้าย, ETL Inventory |
| ทรัพย์สิน | ทะเบียนทรัพย์สิน, หมวด, ค่าเสื่อมราคา, ขาย/หมดอายุ, ประวัติลงบัญชี |
| รายงาน | รายงานทั่วไป, Data Warehouse, AI Performance, บัญชีต้นทุน |

### 1.2 Flow เอกสาร (สังเกตได้จริงจากฟิลด์อ้างอิง)
```
ขาย:  QO → SO → BL → IV ──→ BN (วางบิล) → RV (รับเงิน)      CN อ้างอิง IV
ซื้อ:  PR → BID → PO → AP/EXP → BNR (รับวางบิล) → PV (จ่ายเงิน)  CNR อ้างอิง AP
สต็อก: MR / GR / TR / ADJ
ทุกเอกสาร → (สูตรบัญชี) → GL transaction (หัว + บรรทัด Dr/Cr)
```
ฟิลด์ใน IV ยืนยันการเชื่อมโยง: `quotation`, `bill`, `billing_note`, `receipt`, `credit_note`, `pos`, `ecommerce_shop`; บรรทัดสินค้ามี `so_item_id`, `bl_item_id`, `mr_item_id`

### 1.3 หัวใจ: เครื่องยนต์ "สูตรบัญชี" (Accounting Formula)
ทุกเอกสารมีฟิลด์ `type` = ชื่อสูตร (เช่น `Cash[IV]`) ซึ่งกำหนดว่าจะลง GL อย่างไร
โครงสร้างสูตร (จาก API `formula/create`):
- `name` (unique, ≤50), `module` (invoice, …), `priority`, `active`, `prefix` (เลือกสูตรอัตโนมัติตามอักษรนำเอกสาร), `remark` (เช่น `bl2iv`), `book_id`, `payment_status` (เช่น `Debtor`)
- `product2gl`: `auto` = ลงตามบัญชีของสินค้าแต่ละตัว / `manual` = ตามบรรทัดสูตร
- `contact2gl`: `auto` = ลงลูกหนี้/เจ้าหนี้ตามผังของคู่ค้า / `manual`
- `lines[]`: `{ acc_code, side: dr|cr, variable }` — `variable` คือยอดของเอกสาร เช่น `grand_total`, `tax`, `total`, หรือตัวแปรพิเศษ `c1..c40`, `u1..u40`

ตัวอย่างจริง (สังเกตได้): IV260001 ยอด 10,555 → GL
| บัญชี | Dr | Cr |
|---|---|---|
| 1201000 ลูกหนี้การค้าในประเทศ | 10,555 | |
| 4001000 รายได้จากการขาย | | 10,555 |
(Anchor = IV260001 ใช้สำหรับ reconcile)

### 1.4 Data Model (สังเกตได้จริงจาก response)

**chart_of_account** (`search-coa`)
`chart_id, company_id, acc_code, acc_en, acc_th, type, branch, status, direct_entry, parent, cashflow, category`
- โครงแบบ tree: รหัสกลุ่ม 3 หลัก (เช่น 100, 101) เป็นบัญชีคุม, บัญชีย่อย 7 หลัก (1001000)
- `direct_entry` = บันทึกตรงได้หรือไม่ (บัญชีคุมห้ามลง), `cashflow` = กลุ่มงบกระแสเงินสด (เช่น cash)
- demo มี 338 บัญชี; หมวดบนสุด: 1xx สินทรัพย์, 2xx หนี้สิน, 3xx ทุน, 4xx รายได้, 5xx ค่าใช้จ่าย, 900 สถิติ (ผังตามมาตรฐาน TFRS/กรมพัฒน์)

**gl_transaction (หัว)** (`search-gl`, `view_gl_new → head`)
`transaction_id, company_id, user_id, updater_id, contact_id, date, ref_no, book_id, version, create_dt, update_dt, note1, note2, create_by, engine_reference, mapper, department, salesman, project, formula, url, frequency, approve_status, approve_id, approve_date, approve_freq, import_flag, fx, rate, claim_rate, origin_id`
- `engine_reference` = ประเภทเอกสารต้นทาง (invoice, expense, payment, bill, glx …)

**gl_tran (บรรทัด)** (`view_gl_new → body`)
`gl_tran_id, transaction_id, company_id, user_id, contact_id, acc_code, dr, cr, mapper, structure, reconcile, anchor, costcenter, acc_note, version, import_flag, update_dt`

**invoice (หัว)** (`search-iv`, `retrieve-iv → head`) ~80 ฟิลด์ สำคัญ:
`invoice_id, company_id, fiscal_year, company_format(อักษรนำ), invoice_number, contact_id` + snapshot ลูกค้า `title,name,organization,branch,address,telephone,email,tax_id`
วันที่ `issue_date, due_date, tax_date` · ยอด `discount, tax, total, grand_total, wht, deposit_amount, bn_amount` · `tax_option (in/ex), tax_report`
สถานะ `status, payment, approve_status, approve_id, approve_date, editing, status_deliver, status_pack`
มิติ `salesman, department, project, warehouse` · สกุลเงิน `fx, rate` · อ้างอิง `quotation, bill, billing_note, receipt, credit_note, reference, ref_no` · `type`(สูตร), `gl_entry`, `special_note`, `calculation`

**invoice_item (บรรทัด)** (`retrieve-iv → body`)
`item_id, invoice_id, product_id, product_name, description, price, quantity, unit, coefficient, discount, vat, before_vat, total, cost, serial, location, bom, acc_code, acc_sell, acc_buy, acc_cost, acc_whgr, acc_whmr, anchor, amortize, amortize_start, amortize_end, cn_amount, status_cn, delivered, packed, shipped, so_item_id, bl_item_id, mr_item_id`
- สังเกต: แต่ละบรรทัดเก็บบัญชีขาย/ซื้อ/ต้นทุน/คลังของสินค้าไว้ → ใช้กับ `product2gl=auto`

**รูปแบบที่ใช้ซ้ำทุกเอกสาร (อนุมาน):** หัว + บรรทัด + `dropbox[]` (ไฟล์แนบ) + workflow อนุมัติ (wait/yes/no) + เลขเอกสาร = อักษรนำ + YYMM + running (เช่น IV260001)

---

## 2. RESTful API (api-connector2)

### 2.1 Authentication (สังเกตได้จริง)
- ตั้งค่าที่ `api-connector2/setting.php`: แต่ละคีย์มี **Origin (allow URL)**, **Passkey**, **Encrypt Head**, **User ID**
- ทุก request ส่ง:
  - `company_id`, `passkey`
  - `timestamp` = Unix time
  - `securekey` = `md5(encrypt_head + "t" + timestamp)`
  - Header `Origin:` ต้องตรงกับ Origin ที่อนุญาต (หรือ ANY)
- Body: `Content-Type: application/x-www-form-urlencoded`, field `json=<JSON ทั้งก้อน>`

```bash
curl 'https://<host>/application/api-connector2/end-point/iv/create.php' \
  -H 'Origin: http://localhost' \
  --data-urlencode 'json={"company_id":195,"passkey":"<PASSKEY>","timestamp":<T>,"securekey":"<md5(head+"t"+T)>", "issue_date":"2023-12-01", ...}'
```

### 2.2 Endpoint catalogue (สังเกตได้จริง — 40+ resource)
รูปแบบ: `end-point/<resource>/<action>.php` · action มาตรฐาน `create, read, update, delete, search` (+ `approve`, `attach` สำหรับเอกสารที่มี workflow)

| หมวด | Resource | Actions พิเศษ |
|---|---|---|
| บัญชี | `gl` | `direct-create`, `direct-update`, `anchor-read`, `anchor-update`, `tran-read`, `account-update` |
| | `coa`, `formula` | CRUD+search |
| ขาย | `qo`, `so`, `bl`, `iv`, `cn` | approve, attach |
| ซื้อ | `pr`, `po`, `ap`, `exp`, `cnr` | approve, attach |
| การเงิน | `bn`, `rv`, `bnr`, `pv`, `wht` | CRUD+search |
| | `dashboard` | `iv`, `iv-convert`, `ap`, `ap-convert`, `bnr`, `bnr-convert` (เอกสารถึงกำหนด → แปลงเป็น BN/RV/PV) |
| ธนาคาร | `bank` (create/update/search), `statement` | `reconcile` |
| คู่ค้า | `contact`, `contact-etax`, `contact-person`, `crm`, `rfp`(search) | `report-credit-limit`, `report-deposit` |
| สินค้า | `inv`, `inv-cat`, `inv-bar`, `mr`, `gr`, `tr`, `adj`, `mf` | approve (mr/gr/tr) |
| อื่นๆ | `category`, `project`, `ticket`, `ticket-setting` | `import-read`, `upload-base64`, `etax-send` |
| Sync | `sync-lz`, `sync-tk`, `sync-sh` (+items/fulltax/update) | Lazada / TikTok / Shopee |
| รายงาน | `report-ledger, inventory, book1, statement, a8, qo3, so3, b3, iv3, cn3, pr3, po3, p5, x3, cnr3, attendance-daily, payroll` | |
| Data Warehouse | `dw-a1..a5, a3c, w1, w2, w3, w7, bl3, pl3, cf3` (งบดุล/กำไรขาดทุน/กระแสเงินสด) | |

### 2.3 ตัวอย่าง payload (สังเกตได้จริง)

**IV create** — หัว: `issue_date*, due_date*, company_format, document_number, payment_term, credit_term, reference, discount, wht ("3%" หรือจำนวน), tax_option (in/ex), staff, department, project, warehouse, url, invoice_note, approve_id, approve_status, editing, type (สูตร), c1..c40/u1..u40, anchor_dr, anchor_cr, fx, rate, head_count, time_spent, tax_report, pos, so, bl, mr`
`customer{}`: `group_code, code_number, name, organization, branch, address, email, telephone, tax_id, contact_type, contact_id, add_contact`
`product[]`: `product_id, product, price, quantity, serial, discount, vat, anchor, so_item_id, bl_item_id, mr_item_id`
`dropbox[]`: `url`

**GL create (ผ่านสูตร)** — `date, accounting_formula, company_format, document_number, note1, note2, staff, department, project, url, approve_*`, `customer{}`, `entry[]: {variable: c1..c40/u1..u40, value, acc_note, costcenter, anchor, anchor_dr, anchor_cr}`

**GL direct-create (ระบุบัญชีเอง)** — `date, book_id, company_format, document_number, note1, note2, staff, department, project, claim_rate (0–100, อัตราเฉลี่ยภาษีซื้อ), url, approve_*`, `customer{}`, `entry[]: {acc_code, dr, cr, acc_note, costcenter, anchor}` — ระบบตรวจ Dr = Cr ก่อนบันทึกเสมอ

**Formula create** — ดูข้อ 1.3

### 2.4 Usage (demo dashboard)
ทั้งหมด 227,681 calls: Read 167,183 · Create 38,178 · Other 22,062 · Edit 258 · โควตา 99,999,999

---

## 3. MCP Server

### 3.1 การเชื่อมต่อ (สังเกตได้จริง)
- URL: `https://<host>/application/api-connector2/end-point/mcp/server.php?company=<company_id>&user=<user_id>`
- Transport: **Streamable HTTP**; Auth: **OAuth** — request ที่ไม่มี token ได้ `401` + `{"error":"unauthorized","error_description":"A valid access token is required. See resource_metadata ..."}` (เป็น MCP authorization spec: Protected Resource Metadata → login TRCloud → หน้า Allow → token)
- สิทธิ์ผูกกับ **API Key ของบริษัท** ที่ต้องตั้ง Allow URL = ANY (ไม่ใช่สิทธิ์ส่วนตัวของผู้ใช้)
- มีคู่มือการเพิ่มสำหรับ Claude Code (`claude mcp add --transport http ...`), Claude.ai, Codex, ChatGPT
- **MCP เป็นชั้นบาง ๆ ครอบ API v2** — พารามิเตอร์ของ `create_iv` ตรงกับ `end-point/iv/create.php` ทุกตัว (อนุมาน: server.php เรียก endpoint เดิมภายใน)

### 3.2 Tool catalogue (105 หน้า tool — สังเกตได้จริง)
ชื่อ tool รูปแบบ `<verb>_<resource>` เช่น ชุด IV: `create_iv, get_iv, update_iv, delete_iv, approve_iv, attach_iv, search_iv`

| หมวด | Tools |
|---|---|
| สร้างรายการ – บัญชี | create GL, create GL direct |
| – ขาย/ซื้อ | QO, SO, BL, IV, CN · PR, PO, AP, EXP, CNR (แต่ละตัวมี get/update/delete/approve/attach/search) |
| – การเงิน | BN, RV, BNR, PV, WHT, receivable-due → BN/RV, payable-due → BNR/PV, bnr-payable-due → PV |
| – สินค้า | MR, GR, TR, cost-adjustment |
| – อื่นๆ | upload-attachment, send-etax-invoice |
| OCR | ocr-to-qo/so/bl/iv/cn/pr/po/ap/exp/cnr (อ่านไฟล์เอกสาร → สร้างเอกสาร) |
| ข้อมูลหลัก | COA, formula, inventory, product-category (search/create/update), contact, contact-group, lead, project, department, warehouse, staff, search-user |
| ธนาคาร | search/create/update bank, search/import/update(จับคู่)/delete bank-statement, bank-statement-report, bank-reconcile |
| GL | get-ledger, a8-reconcile-report, get/update gl-anchor, get-gl-tran, update-gl-account (ย้ายบรรทัดไปบัญชีอื่น) |
| รายงานทั่วไป | qo3, so3, b3, iv3, cn3, pr3, po3, p5, x3, cnr3, stock-movement, product-reservation, payroll-summary |
| Ticket/Meeting | create-ticket, ticket-setting, meeting |
| Data Warehouse | balance-sheet, trial-balance, profit-and-loss (+comparative), cashflow (+monthly), dw-ledger, stockcard, inventory-movement-summary, dead-stock, inventory-aging |
| นำเข้าข้อมูล | list-import-types, get-import-template (CSV), run-import, delete-import |

---

## 4. ข้อสังเกตสำหรับการออกแบบระบบของเราเอง
1. **แยก "เอกสารธุรกิจ" กับ "GL" ด้วย formula engine** — เอกสารเก็บยอด (`total`, `tax`, `grand_total`, `c1..`), สูตรแปลงเป็น Dr/Cr; มีทาง `direct-create` ไว้สำหรับบันทึกตรง
2. **Anchor** บนบรรทัด GL = กุญแจจับคู่/กระทบยอด (ลูกหนี้-รับเงิน, ธนาคาร)
3. **Snapshot ข้อมูลลูกค้า** ลงในหัวเอกสาร (ชื่อ/ที่อยู่/เลขภาษี) — จำเป็นตามกฎหมายใบกำกับภาษี
4. **ทุกเอกสารมี workflow อนุมัติ + version + log** และเลขเอกสารตาม prefix
5. **API → MCP** ใช้ schema เดียวกัน ทำให้ AI สั่งงานได้ทุกโมดูล รวม OCR
6. ข้อจำกัดที่เห็น: internal API ส่ง `passkey` จากหน้าเว็บ, auth แบบ md5(head+"t"+time) ค่อนข้างอ่อน — ระบบใหม่ควรใช้ OAuth/HMAC-SHA256 + nonce

## 5. ยังไม่ได้ตรวจ (Unknown)
- Response schema ของ public API (ไม่ได้เรียกจริงเพื่อเลี่ยงการใช้ API key)
- รายการพารามิเตอร์ของ MCP tool ตัวอื่นนอกจาก `create_iv`
- ตาราง DB จริง (ชื่อ table อนุมานจากชื่อฟิลด์/พารามิเตอร์ `table`)
- โมดูลอื่นนอกขอบเขต (POS, HR, E-commerce, Ticket)
