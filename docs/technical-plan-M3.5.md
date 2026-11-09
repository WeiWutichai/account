# Technical Plan — M3.5 Deploy นำร่อง

> สถานะ: **เตรียมพร้อมในเครื่องแล้ว · รอ Wei สำหรับขั้นที่ต้องใช้เซิร์ฟเวอร์จริง** (อนุมัติล่วงหน้า 2026-11-09/10) · อ้างอิง `PLAN.md` §6 (M3.5) · ADR-001 เงื่อนไขข้อ 6 (เครื่องมือ export/import รายบริษัทก่อน M3.5)

## Gate (PLAN)
restore สำเร็จจาก backup จริง · ต้องผ่านก่อนใส่ข้อมูลจริงของบริษัทนำร่อง

## ทำแล้ว (ตรวจในเครื่อง)
| ส่วน | ไฟล์ | หลักฐาน |
|---|---|---|
| export/import รายบริษัท (backup รายบริษัท · ย้าย DB · PDPA) | `packages/db/src/company-transfer.ts` · CLI `pnpm --filter @innovera/db company:export <id> <file>` / `company:import <file>` | `packages/db/test/transfer.test.ts`: export บริษัท ก (ไม่มีข้อมูลบริษัท ข ปน) → import ลงฐานใหม่ → งบทดลองตรงทุกบรรทัด · สถานะเอกสาร/ void ครบ · trigger ป้องกันยังทำงาน · นำเข้าซ้ำ/คนละเวอร์ชันถูกปฏิเสธ · ใช้กับบริษัท dev ได้ (279 แถว) |
| image production | `deploy/Dockerfile` (image เดียว เลือกแอปด้วย `APP`) · `.dockerignore` | build `innovera/accounting-api` ผ่าน · รัน container จริง: /health ต่อ Postgres ผ่าน PgBouncer + Redis ได้ · `/v1/documents` ไม่มี session → 401 |
| compose production | `deploy/compose.prod.yaml` · `deploy/Caddyfile` (TLS อัตโนมัติ + HSTS) · `deploy/init-prod.sh` (role ตาม ADR-001 รหัสผ่านจาก env) · `deploy/.env.example` | DB/Redis/API ไม่เปิดพอร์ตออกนอกเครื่อง · เปิดเฉพาะ 80/443 ผ่าน Caddy |
| backup รายวัน | `deploy/backup/backup-loop.sh` (02:00 เวลาไทย · pg_dump -Fc · เก็บ 14 วัน) | log มีแค่ชื่อไฟล์/ขนาด ไม่มีข้อมูลส่วนบุคคล |
| restore test | `deploy/backup/restore-test.sh` (restore backup ล่าสุดลงฐานชั่วคราว → ตรวจ Dr = Cr ทุกบริษัท → ลบฐานชั่วคราว) | ใช้ในขั้นตอนข้างล่าง (ยังไม่ได้รันบนเซิร์ฟเวอร์จริง) |

## ต้องให้ Wei ทำ / ตัดสิน (Claude Code ทำแทนไม่ได้ — เป็นการกระทำภายนอก/ใช้ความลับ)
1. เลือกและเปิด VPS (แนะนำในประเทศไทยตามข้อความหน้า Login "ข้อมูลเก็บในประเทศไทย") · ตั้ง DNS `app.<โดเมน>` และ `id.<โดเมน>`
2. สร้าง `deploy/.env` บนเซิร์ฟเวอร์ตาม `.env.example` (สร้างรหัสผ่านแบบสุ่มที่ไม่มีอักขระ `'`) — ห้าม commit
3. เลือกที่เก็บสำรองนอกเครื่อง (`BACKUP_OFFSITE_TARGET`) — ยังไม่ได้เขียนตัวคัดลอก (TODO)
4. ผู้ให้บริการส่งอีเมล (outbox_email → SMTP/SES) — ตัวส่งยังไม่ได้ทำ (TODO M3.5) · จนกว่าจะมี ผู้ใช้จริงสมัคร/รีเซ็ตรหัสผ่านไม่ได้
5. ระบบแจ้งเตือน/monitoring (แนะนำ uptime check ภายนอก + แจ้งเมื่อ restore test ไม่ผ่าน)

## ขั้นตอนบนเซิร์ฟเวอร์ (หลัง Wei ทำข้อ 1–2)
```
docker build -f deploy/Dockerfile --build-arg APP=<แอป> -t innovera/<แอป> .   # ×4: id-api accounting-api id-web accounting-web
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d
docker compose -f deploy/compose.prod.yaml exec backup sh -c 'pg_dump -h postgres -U postgres -Fc -f /backups/innovera-manual.dump innovera'
docker compose -f deploy/compose.prod.yaml exec backup sh /backup/restore-test.sh   # Gate: ต้องขึ้น "restore test ผ่าน"
```

## TODO
- Nest รันด้วย tsx ใน production (ตามโครง M0 ที่ import `.ts`) — ควร compile เป็น JS ก่อนรับโหลดจริง
- ตัวคัดลอก backup ออกนอกเครื่อง · ตัวส่งอีเมล · monitoring/alert
