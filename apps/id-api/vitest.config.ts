import { defineConfig } from 'vitest/config';

// Argon2id/bcrypt ตั้งใจให้ช้า (OWASP) — เมื่อ turbo รัน test หลาย package พร้อมกัน 5 วินาทีไม่พอ
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 120_000 } });
