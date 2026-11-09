# Technical Plan — M8 Console + Ops

> สถานะ: **อนุมัติล่วงหน้า** (Wei 2026-11-09/10) · อ้างอิง `PLAN.md` §6 (M8) · CLAUDE.md "การเข้าดูข้อมูลลูกค้าโดยทีม Innovera ต้องมี consent (Console X4)" · แบบร่าง ConsoleOverview (X1) · ConsoleTenants (X2) · ConsoleSupport (X4) · ConsoleFlags (X5) · ConsoleReference (X6) · ConsoleOps (X7) · ConsoleTeam (X8) · ConsoleBilling (Phase 2) · ConsoleNav

## Gate
impersonate ต้อง consent (e2e)

## Backend (ทำแล้ว · migration 0013 · `packages/db/src/console.ts` · `apps/accounting-api/src/console.controller.ts`)
- ทีม Innovera = `public.innovera_staff` (support/engineer/billing/ops/admin) · Console ต้องเข้าสู่ระบบด้วย Innovera ID + 2FA ทุกครั้ง (`amr` ต้องมี otp/backup_code — อุปกรณ์ที่เชื่อถือไม่พอ)
- อ่านข้ามบริษัท (ภาพรวม/องค์กร/ops) ผ่าน role `console_reader` (BYPASSRLS) เท่านั้น
- **ข้อมูลบัญชีของลูกค้า**: ผ่าน `withSupportAccess` ทางเดียว — ticket → คำขอ (เหตุผล + ขอบเขต + 30/60 นาที · support ขอสิทธิ์เขียนไม่ได้) → อีเมล + คิวหน้าแรกของ Owner → Owner อนุมัติ/ปฏิเสธ (`/v1/support-access/:id/decide`) → ผู้ขอเริ่มเซสชัน → อ่านอย่างเดียวจนหมดเวลา → ทุกการเปิดบันทึกทั้ง `audit_console` และ `acct.audit_log` ของลูกค้า (hash chain) → ปิดแล้วส่งสรุปให้ Owner
- feature flags (company > org > global) · บันทึก audit · ops: เวอร์ชัน schema · webhook pending/sent/dead · คิวอีเมล
- Tests `packages/db/test/m8.test.ts` (consent ทุกกรณี: ไม่มี/รอ/ปฏิเสธ/คนอื่น/หมดเวลา · Owner เท่านั้น · audit สองฝั่ง)

## ค้าง / TODO
- UI console-web 8 หน้า (กำลังทำ) · การ์ดคำขอเข้าดูในคิวหน้าแรกของลูกค้า (accounting-web Main) · ปิดบังข้อมูลส่วนบุคคลระหว่างเข้าดู (PDPA) — ตอนนี้เปิดให้อ่านเฉพาะงบทดลอง/ผลตรวจความถูกต้อง ซึ่งไม่มีข้อมูลบุคคล
- เครื่องมือ backup/restore ผ่าน UI (PLAN M8): ใช้ `company:export/import` CLI (M3.5) — UI ยังไม่ทำ
- สิทธิ์แก้ไขข้อมูลลูกค้า (engineer + Owner ยืนยัน 2FA ทั้งคู่) — โครงข้อมูลรองรับ (`write_access`) แต่ยังไม่มี route เขียน
- billing/MRR (Phase 2) · ข้อมูลอ้างอิงกลาง (X6) · จัดการทีม (X8 เขียน)
