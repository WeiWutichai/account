# PROGRESS — AccountSystem (Innovera)

> **อ่านไฟล์นี้ก่อนเมื่อเริ่ม chat ใหม่** ถัดไปอ่าน `CLAUDE.md` (กติกา) → `PLAN.md` (แผน Phase 1)
> อัปเดตไฟล์นี้ทุกครั้งที่จบงานชิ้นหนึ่ง: แก้ "สถานะล่าสุด" + เพิ่มบรรทัดใน "บันทึกงาน" (ใหม่อยู่บน) + อัปเดต md5
> อัปเดตล่าสุด: **2026-11-09 23:20** โดย Claude Code

---

## 1. สถานะล่าสุด (สรุป 30 วินาที)

- **ขั้น:** ร่าง **Technical Plan M0** แล้ว (`docs/technical-plan-M0.md`) → **รอ Wei อนุมัติ + ตอบ 4 คำถามใน §11 ของไฟล์นั้น** · ยังไม่มีโค้ด ยังไม่เป็น git repo
- **แบบร่าง UI:** เวอร์ชัน **26** (`1794239284-7b59`) · 76 หน้า + เมนู 2 ตัว · สำเนาในเครื่อง `design/` ตรง MANIFEST ทุกไฟล์
- **ตัวเลขตัวอย่าง:** `fixtures/sample-company.json` ตรงกับแบบร่างทุกยอด · ผ่าน schema · journal 24 ชุด Dr=Cr · ไม่มีรายการขัดกันค้าง
- **ไม่มีงานค้าง** ทั้งฝั่ง Claude Code และ Cowork

## 2. ไฟล์และแหล่งข้อมูล

| อะไร | ที่อยู่ | หมายเหตุ |
|---|---|---|
| กติกา repo | `CLAUDE.md` | source of truth ลำดับ 1 ร่วมกับ PLAN |
| แผน Phase 1 | `PLAN.md` | milestone M0–M8, golden tests §3, เรื่องรอผู้สอบบัญชี §10 |
| ความคืบหน้า | `PROGRESS.md` (ไฟล์นี้) | |
| Technical Plan M0 | `docs/technical-plan-M0.md` | ร่าง รออนุมัติ |
| แบบร่าง (สำเนา) | `design/project/*.dc.html` + `design/MANIFEST.json` + `design/README.md` | อ่านอย่างเดียว · เปิดดู `cd design/project && python3 -m http.server 8080` |
| แบบร่าง (ต้นฉบับ) | https://claude.ai/artifact/LQTTxmYPCna8EntkntYCCQ | แก้ที่นี่แล้วส่งออกทับ `design/` |
| รหัสหน้าจอ ↔ ไฟล์ ↔ milestone | `docs/page-map.md` | Wei อนุมัติครบ |
| ระบบออกแบบ (ตัวจริง) | `design-system/` · https://claude.ai/artifact/UdMQo46L3WYvyRHCLGYuaa | ห้ามใช้ v2 `LwCHLbTj…` · ปุ่มยึดตามแบบร่าง (ดู `design-system/README.md`) |
| ตัวเลขตัวอย่าง | `fixtures/sample-company.json` + `.schema.json` | `decisions_wei_2026_11_09` = บันทึกการตัดสิน |
| Functional Spec v2 | `docs/functional-spec-v2.md` · https://claude.ai/artifact/HkxJ7Cj65uYB7LXBZmDhgM | รหัสหน้าจอใน Spec **คนละชุด** กับ PLAN — อ้างชื่อไฟล์เสมอ |
| มาตรฐาน UI (เหตุผล) | https://claude.ai/artifact/ADwMogMscKkykEjttgTxLF | |
| งานวิจัย TRCloud | `research/trcloud-research.md` | |
| ใบสั่งงาน Cowork เก่า | `research/cowork-handoff-*.md` | ปิดแล้ว · รอบ 1 ใช้ G5/G6 สลับกัน (ยกเลิก) |

**md5 ล่าสุด** (ตรวจได้ด้วย `md5 fixtures/*.json design/MANIFEST.json design-system/MANIFEST.json`)

| ไฟล์ | md5 |
|---|---|
| `fixtures/sample-company.json` | `ce89d09b6c7f3e863211c8fb8779b5bb` |
| `fixtures/sample-company.schema.json` | `318efe4f2743d91ef31ea756619be27a` |
| `design/MANIFEST.json` | `eca5f38c6afe73fff7b10c3c117e28a2` |
| `design-system/MANIFEST.json` | `8c3eac041599751df67da597c2b983e1` |

## 3. ข้อตัดสินของ Wei (ล็อกแล้ว)

| วันที่ | เรื่อง | ตัดสิน |
|---|---|---|
| 2026-11-09 | ระบบออกแบบ | ตัวแรก `UdMQo46…` · ปุ่มยึดตามแบบร่าง (มุม 4px, รองขาวขอบเทา, อันตรายขาวขอบแดง, ชื่อกึ่งกลาง) |
| 2026-11-09 | รหัสหน้าจอ | G5 = ตั้งค่าเอกสาร · G6 = MCP · milestone ทุกหน้าตาม `docs/page-map.md` |
| 2026-11-09 | วันนี้ในแบบร่าง | มุมมองสิ้นเดือน จันทร์ 30 พ.ย. 2569 |
| 2026-11-09 | ยอดขัดกัน 11 ข้อ | ตาม `fixtures.decisions_wei_2026_11_09` (IV2611-0056 = 281,200 · ลูกหนี้ 1,780,016 · กำไร ม.ค.–พ.ย. 2,872,880 · S-0001 1,500/ชม. · IV2611-0052 รออนุมัติ ฯลฯ) |
| 2026-11-09 | ค่าเช่าอาคาร | ไม่มี VAT (ม.81(1)(ฑ)) · รอบจ่าย 28 พ.ย. = 909,100 / 13,600 / 895,500 |
| 2026-11-09 | ORM / แยกฐานข้อมูลต่อบริษัท | **ยังไม่ตัดสิน** — ทำ spike ใน M0 (ทางเลือก ก/ข/ค ใน PLAN §2) แล้ว Wei อนุมัติก่อน M1 |

## 4. เรื่องเปิดอยู่

**รอผู้สอบบัญชี** (ทำเป็น config + ป้าย "รอยืนยัน" — ห้ามตัดสินเอง)
1. ค่าจ้างฟรีแลนซ์พัฒนาซอฟต์แวร์ ม.40(2) หรือ 40(8) — ต่างทั้งประเภทและวิธีคำนวณ (คงที่ 3% vs อัตราก้าวหน้า ม.50(1)) · ค่าตั้งต้นชั่วคราว: หักคงที่ 3%
2. ขยายกำหนดยื่นออนไลน์ (ภ.ง.ด. 15 / ภ.พ.30 23) ยังใช้หรือไม่ · ค่าตั้งต้นชั่วคราว: ใช้

**รอ Wei**
3. อนุมัติ Technical Plan M0 (`docs/technical-plan-M0.md`) + ตอบ: ที่เก็บ repo/CI
4. ผล spike ORM/tenancy → เลือก ก/ข/ค

**ข้อสังเกตที่ยังไม่แก้ (ไม่บล็อก M0–M3)**
5. `ScreenReconReport` ยอด IV 61 ใบ (1,736,580) และ RV 42 ใบ (2,104,318.60) เป็นค่ากำหนดใหม่ ไม่ได้รวมจากรายใบ เพราะ fixtures มีเอกสารไม่ครบ — ถ้าจะทำ e2e ที่ต้องรวมจากรายใบ ต้องเพิ่มเอกสารใน fixtures
6. IV2611-0001 เป็นการขาย**สินค้า** (P-1001/P-1002) จุดภาษีของสินค้าเกิดตอนส่งมอบ/ออกใบกำกับ ไม่ใช่ตอนรับเงิน แต่รายงานภาษีขาย พ.ย. ไม่มีแถวของใบนี้ — ต้องตรวจก่อน M6 (ภาษี)
7. `ScreenLedger` แสดงรายการ 9 รายการเป็นตัวอย่าง ไม่ใช่ทั้งเดือน (ยอดยกมา/ยกไปคำนวณให้ตรงแล้ว)
8. แบบร่างไม่ได้กำหนดจอเล็กกว่า 1024px · พฤติกรรมหลังคลิก/validation/ข้อความ error ส่วนใหญ่ — ดู PLAN/Spec ก่อน ไม่มีให้ถาม Wei

## 5. ขั้นถัดไป

1. Wei อนุมัติ `docs/technical-plan-M0.md` (ประมาณ 7.5–8.5 วันทำงาน)
2. `git init` + ย้ายเอกสารเข้า `innovera-platform/docs/` ตาม PLAN (ตอนเริ่ม M0)
3. ทำ M0 → ส่ง spike result → Wei เลือก tenancy → M1

## 6. วิธีทำงานร่วมกับ Cowork

- Cowork = Claude Project ฝั่ง claude.ai · คุยกับ Claude Code ตรงไม่ได้ ต้องผ่าน Wei (คัดลอกข้อความ หรือใช้ `/send-to-project`)
- **ไฟล์ร่วม** (`fixtures/`, `design/`, `CLAUDE.md`, `PLAN.md`, `PROGRESS.md`): **แก้ได้ทีละฝั่ง** — แจ้งผ่าน Wei ก่อนแก้ → อีกฝั่งหยุดเขียน → แก้ → อ่านกลับจากดิสก์แนบ md5 (เคยชนกัน 22:29 วันที่ 9 พ.ย.)
- ทุกครั้งที่ฝั่งใดรายงานว่า "เสร็จ" อีกฝั่งตรวจซ้ำจากดิสก์/แบบร่างจริง: ลิงก์และปุ่ม · schema · Dr=Cr · ยอดในแบบร่างอยู่ใน fixtures ครบ · ไม่มีเลขเก่า
- แก้แบบร่าง → เผยแพร่เวอร์ชันใหม่ → ดาวน์โหลดกลับมาเทียบ → ส่งออกทับ `design/` + อัปเดต `MANIFEST.json` + เลขเวอร์ชันใน `CLAUDE.md`, `design/README.md`, `docs/page-map.md`, ไฟล์นี้

## 7. บันทึกงาน (ใหม่อยู่บน)

- **2026-11-09 23:35** · Wei · ผู้ build M0 = Claude Code ในเครื่องนี้
- **2026-11-09 23:30** · Claude Code · อัป Node เครื่อง dev 20.20.2 → 26.13.0 (LTS) ผ่าน nvm ตั้งเป็น default (Wei อนุญาต)
- **2026-11-09 23:20** · Claude Code · ร่าง `docs/technical-plan-M0.md`
- **2026-11-09 23:00** · Claude Code · สร้าง `PROGRESS.md`
- **2026-11-09 22:48** · Claude Code · ปิดยอดขัดกัน 11 ข้อ → แบบร่าง v26 (12 หน้า) + fixtures/schema · Cowork ยืนยัน md5 ตรง
- **2026-11-09 22:30** · Cowork · เติม fixtures ครบทุกยอดในแบบร่าง (554 ค่า) · ส่งรายการขัดกัน 11 ข้อ
- **2026-11-09 22:18** · Claude Code · `docs/page-map.md` · ส่งออก `design-system/` · บันทึกข้อตัดสิน DS + G5/G6 + milestone
- **2026-11-09 22:04** · Cowork · ส่งออก `design/` (v25) + MANIFEST · เพิ่มกติกาอ่านแบบร่างแบบเคร่งครัดใน `CLAUDE.md`
- **2026-11-09 21:50** · Claude Code + Cowork · v24–v25: รอบจ่าย 28 พ.ย. หลังใบลดหนี้ · ค่าเช่าไม่มี VAT · ตัด ภ.ง.ด.53 แถวอู่ซ่อมที่ยังไม่จ่าย
- **2026-11-09 ช่วงเย็น** · Claude Code · v20–v22: สำรองตามกฎหมายแยกจากปิดปี · 2150110→2150400 · วันนี้ = 30 พ.ย. · สร้าง fixtures schema · แก้ PLAN (ORM เป็นคำถามเปิด, precision, golden tests, M3.5 deploy)
- **2026-11-09 ก่อนหน้า** · Cowork · เพิ่มหน้า FA1/P4/S7/R3/G5/G6 + แก้ข้อมูลไม่ตรง 4 ข้อ (v19) · สร้าง `CLAUDE.md` + fixtures รุ่นแรก
- **2026-11-04 → 09** · Claude Code · วิจัย TRCloud · Spec · มาตรฐาน UI · แบบร่างถึง v18 (ปุ่มมาตรฐาน, แบบพิมพ์ D1–D15, Sidebar, VAT ขนส่ง/ค่าเช่า)
