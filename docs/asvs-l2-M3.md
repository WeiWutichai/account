# OWASP ASVS 4.0.3 Level 2 — checklist M3 (Innovera ID)

> Gate ของ M3 (PLAN §6) · ครอบคลุม V2 Authentication · V3 Session · V4 Access control · V6 Stored crypto (ส่วนที่เกี่ยว) · V7 Logging (ส่วนที่เกี่ยว)
> สถานะ: ✅ ผ่าน (มีหลักฐาน) · ⚠️ บางส่วน / มีเงื่อนไข · ⏳ ทำใน milestone ถัดไป · ➖ ไม่เกี่ยว
> หลักฐาน = ไฟล์/test ที่ตรวจข้อนั้น · `auth` = packages/auth · `id` = apps/id-api · `acct` = apps/accounting-api

## V2 Authentication
| ข้อ | ข้อกำหนด (ย่อ) | สถานะ | หลักฐาน / หมายเหตุ |
|---|---|---|---|
| 2.1.1 | รหัสผ่าน ≥ 12 ตัว | ✅ | `auth/password.ts` MIN_LENGTH=12 · test "นโยบาย" |
| 2.1.2 | ยอมรับ ≥ 64 ตัว | ✅ | ไม่มีขีดบน (Argon2 รับได้) |
| 2.1.3 | ไม่ตัดรหัสผ่าน | ✅ | normalize NFKC อย่างเดียว |
| 2.1.4 | รับ Unicode ทุกตัว | ✅ | test ใช้รหัสผ่านภาษาไทย |
| 2.1.5/2.1.6 | เปลี่ยนรหัสผ่านได้ ต้องใส่รหัสเดิม | ⚠️ | reset ผ่านอีเมลทำแล้ว · เปลี่ยนจากหน้าโปรไฟล์ (ScreenProfile) — ดูรายงานของงาน UI |
| 2.1.7 | ตรวจกับรายการรหัสที่รั่วไหล | ⚠️ | รายการ offline ขนาดเล็กใน `password.ts` · TODO(M3.5) ฐานข้อมูลรั่วไหลเต็มแบบ offline (ไม่ส่งรหัสออก) |
| 2.1.8 | มีตัววัดความแข็งแรง | ⏳ | แบบร่างไม่มีตัววัด — ถาม Wei |
| 2.1.9 | ไม่บังคับชนิดตัวอักษร | ✅ | ไม่มีกฎ composition |
| 2.1.10 | ไม่บังคับเปลี่ยนเป็นรอบ | ✅ | |
| 2.1.11 | วางรหัส/ตัวจัดการรหัสผ่านได้ | ✅ | input มาตรฐาน |
| 2.1.12 | ดูรหัสที่พิมพ์ได้ | ⏳ | แบบร่างไม่มีปุ่มแสดงรหัส — ถาม Wei |
| 2.2.1 | กัน brute force | ✅ | `id/identity.ts` login: 10 ครั้ง/บัญชี + 50 ครั้ง/IP ต่อ 15 นาที · 2FA 5 ครั้ง (Redis) · test "ล็อก" |
| 2.2.2 | ไม่ใช้ SMS/อีเมลเป็นปัจจัยหลัก | ✅ | TOTP · SMS ในแบบร่างยังไม่เปิด (Phase 2) |
| 2.2.3 | แจ้งเตือนเมื่อเปลี่ยนข้อมูลยืนยันตัวตน | ✅ | outbox `password_changed` (ScreenPasswordReset "ระบบแจ้งเจ้าของบัญชีทุกครั้ง") |
| 2.4.1 | เก็บรหัสด้วย KDF ที่ทนการเดา | ✅ | Argon2id m=19 MiB t=2 p=1 (OWASP) · rehash เมื่อพารามิเตอร์เปลี่ยน |
| 2.4.2 | salt ≥ 32 bit ต่อรหัส | ✅ | salt สุ่มของ argon2 (128 bit) |
| 2.5.1 | ลิงก์ reset สุ่ม ไม่ส่งรหัสผ่าน | ✅ | token 256 bit เก็บ SHA-256 · หมดอายุ 30 นาที ใช้ครั้งเดียว |
| 2.5.2 | ไม่มีคำถามลับ | ✅ | |
| 2.5.4 | ไม่มีบัญชีร่วม/ค่าเริ่มต้น | ✅ | ผู้ใช้ dev มีเฉพาะ dev-seed (ห้ามรันใน production) |
| 2.5.6 | กู้คืนบัญชีปลอดภัย | ✅ | reset ไม่เปิดเผยว่ามีบัญชี (ตอบเหมือนกัน) · หลัง reset ยังต้อง 2FA |
| 2.5.7 | ปัจจัยที่สองหายแล้วกู้ได้อย่างปลอดภัย | ✅ | รหัสสำรอง 10 ชุด ใช้ครั้งเดียว (bcrypt) · รีเซ็ต 2FA โดยผู้ดูแล = ⏳ M7 |
| 2.7.x | OTP นอกช่องทาง (อีเมล) | ✅ | รหัสยืนยันอีเมล 6 หลัก หมดอายุ 15 นาที ผิด 5 ครั้งต้องขอใหม่ |
| 2.8.1 | TOTP มีอายุ | ✅ | 30 วินาที ±1 ช่วง |
| 2.8.3 | อัลกอริทึม OTP ที่ยอมรับ | ✅ | HMAC-SHA1 ตาม RFC 6238 (แบบร่างกำหนด SHA-1) · test vector RFC |
| 2.8.4 | OTP ใช้ได้ครั้งเดียว | ✅ | `totp_last_step` · test "ใช้รหัสเดิมซ้ำไม่ได้" |
| 2.8.6 | เพิกถอนอุปกรณ์ได้ | ⚠️ | ตาราง `trusted_device.revoked_at` · UI ในหน้าโปรไฟล์ |
| 2.8.7 | secret ของ OTP ป้องกันไว้ | ✅ | AES-256-GCM ด้วย `ID_DATA_KEY` · test ตรวจว่า DB ไม่มี plaintext |

## V3 Session
| ข้อ | ข้อกำหนด | สถานะ | หลักฐาน |
|---|---|---|---|
| 3.1.1 | ไม่ใส่ token ใน URL | ✅ | cookie เท่านั้น (accounting-api รับ Bearer จาก server-side เท่านั้น) |
| 3.2.1 | token ใหม่เมื่อยืนยันตัวตน | ✅ | family ใหม่ทุกครั้งที่ login |
| 3.2.2 | token สุ่ม ≥ 64 bit | ✅ | refresh 256 bit · JWT EdDSA |
| 3.2.3 | เก็บใน cookie ที่ปลอดภัย | ✅ | HttpOnly · Secure (production) · SameSite Lax/Strict |
| 3.3.1 | logout เพิกถอนจริง | ✅ | revoke ทั้ง family · `/v1/me` ตรวจ session active · access JWT อายุ 15 นาที (ยอมรับได้ตาม L2 เพราะ refresh ถูกเพิกถอน) |
| 3.3.2 | อายุ session สูงสุด | ✅ | นโยบายองค์กร 12 ชม. (แบบร่าง) · test "หมดอายุตามนโยบาย" |
| 3.3.3 | ออกจากทุกอุปกรณ์เมื่อเปลี่ยนรหัส | ✅ | ตัวเลือกใน reset (ค่าตั้งต้นติ๊ก) · test |
| 3.3.4 | ดู/ยกเลิก session ที่ใช้อยู่ | ⚠️ | ข้อมูลพร้อม (`auth_session`) · UI หน้าโปรไฟล์ |
| 3.4.1–3.4.3 | cookie Secure/HttpOnly/SameSite | ✅ | `id/http.ts` |
| 3.5.2 | ใช้ token ที่ลงนาม ไม่ใช่ API key แบบ static | ✅ | |
| 3.5.3 | ตรวจลายเซ็น/อายุ JWT | ✅ | `verifyAccess` (issuer, audience, alg EdDSA เท่านั้น, exp) |
| 3.7.1 | ยืนยันตัวตนซ้ำก่อนทำสิ่งอ่อนไหว | ⏳ | M7 (เปลี่ยนเจ้าของ/ปิดบริษัท) |
| — | refresh token หมุน + ตรวจการใช้ซ้ำ | ✅ | ใช้ token ที่หมุนแล้ว → เพิกถอนทั้ง family + login_event `refresh_reuse` · test |
| — | pending (หลังรหัสผ่าน ก่อน 2FA) ผูก IP/UA | ✅ | HMAC · 5 นาที · test |

## V4 Access control
| ข้อ | ข้อกำหนด | สถานะ | หลักฐาน |
|---|---|---|---|
| 4.1.1 | ตรวจสิทธิ์ฝั่ง server | ✅ | `acct/context.ts` AuthGuard ทุก route · `@Need(area, action)` |
| 4.1.2 | ผู้ใช้แก้ข้อมูลสิทธิ์เองไม่ได้ | ✅ | สิทธิ์อ่านจาก DB ทุก request ไม่อยู่ใน token |
| 4.1.3 | least privilege | ✅ | เมทริกซ์ตามแบบร่าง ScreenUsers · บทบาทที่ไม่รู้จัก = ไม่มีสิทธิ์ (`custom` ว่าง) |
| 4.1.5 | ล้มเหลวแบบปลอดภัย | ✅ | ไม่มี membership/หมดอายุ → 403 · ไม่มี token → 401 |
| 4.2.1 | กัน IDOR | ✅ | ข้อมูลบัญชีผ่าน RLS (`withCompany`) + membership ของบริษัทที่เลือก · test leak ของ M1 |
| 4.2.2 | กัน CSRF | ✅ | SameSite=Lax/Strict · API รับ JSON · ไม่เปิด CORS |
| 4.3.1 | หน้าผู้ดูแลต้องมี MFA | ✅ | บริษัทบังคับ 2FA → session ต้องมี amr otp/backup_code/trusted_device |
| — | dev header (`x-role`) ปิดใน production | ✅ | `AUTH_DEV_HEADERS` + NODE_ENV=production → ไม่ยอมเริ่มระบบ |

## V6 / V7 (ส่วนที่เกี่ยว)
| ข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| 6.2.1 ใช้ crypto มาตรฐาน | ✅ | node:crypto (AES-GCM, HMAC-SHA256), jose (EdDSA) |
| 6.4.1 คีย์อยู่นอกโค้ด | ✅ | production ต้องตั้ง env (ไม่มีค่าตั้งต้น) · dev ใช้คีย์คงที่ที่ระบุชัดว่า DEV ONLY |
| 7.1.1 ไม่ log รหัสผ่าน/token | ✅ | login_event เก็บ hash ของ IP · ไม่มี token/รหัสใน log |
| 7.2.1 log การยืนยันตัวตนทั้งสำเร็จ/ล้มเหลว | ✅ | `public.login_event` (append-only: app ได้แค่ SELECT/INSERT) |
| 7.x audit log hash chain ของบริษัท | ⏳ | M7 (การเปลี่ยนสิทธิ์ผู้ใช้ TODO ใน `org.ts`) |

## ค้าง (ไม่บล็อก M3 · ติดตามใน PROGRESS)
- ฐานข้อมูลรหัสผ่านรั่วไหลเต็ม (M3.5) · ส่งอีเมลจริงจาก outbox (M3.5) · re-auth ก่อนทำสิ่งอ่อนไหว + audit hash chain (M7) · ตัววัดความแข็งแรง/ปุ่มแสดงรหัส (แบบร่างไม่มี — ถาม Wei)
