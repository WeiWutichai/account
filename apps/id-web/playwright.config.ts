// e2e ของ id-web (ไม่อยู่ใน pnpm test) · ต้องรัน id-api :4100 · id-web :3100 · accounting-web :3010 อยู่แล้ว
// ใช้: cd apps/id-web && npx playwright test   (ก่อนนั้น pnpm dev:session สำหรับขั้นเชิญ)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  use: { baseURL: process.env.ID_WEB_URL ?? 'http://localhost:3100', viewport: { width: 1440, height: 1000 }, locale: 'th-TH' },
});
