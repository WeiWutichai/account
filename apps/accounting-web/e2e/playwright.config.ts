import { defineConfig } from '@playwright/test';

// e2e ของ accounting-web (ไม่อยู่ใน pnpm test) · ต้องมี dev servers + pnpm dev:session
export default defineConfig({
  testDir: '.', timeout: 120_000,
  use: { baseURL: process.env.APP_URL ?? 'http://localhost:3010', storageState: '../../.playwright/dev-session.json', viewport: { width: 1440, height: 1000 } },
});
