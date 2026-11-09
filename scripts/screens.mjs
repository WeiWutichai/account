// ภาพเทียบแบบร่าง ↔ ของจริง ที่ 1440px (CLAUDE.md: แนบใน PR งาน UI ทุกครั้ง)
// ใช้: (cd design/project && python3 -m http.server 8080) + เว็บ dev ที่ 3010 แล้ว
//   node scripts/screens.mjs M2 ScreenCOA=/gl/accounts ScreenLedger=/gl/ledger …
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [milestone, ...pairs] = process.argv.slice(2);
const DESIGN = process.env.DESIGN_URL ?? 'http://localhost:8080';
const APP = process.env.APP_URL ?? 'http://localhost:3010';
const out = `docs/screens/${milestone}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
for (const p of pairs) {
  const [name, path] = p.split('=');
  await page.goto(`${DESIGN}/${name}.dc.html`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${name}.design.png`, fullPage: true });
  await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${name}.app.png`, fullPage: true });
  console.log(`✓ ${name} ↔ ${path}`);
}
await browser.close();
