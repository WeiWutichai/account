// สร้าง src/tokens.css จาก design-system/project/tokens.json (ระบบออกแบบตัวจริง UdMQo46…) · ปุ่มยึดตามแบบร่าง (design-system/README.md)
import { readFileSync, writeFileSync } from 'node:fs';

const t = JSON.parse(readFileSync(new URL('../../../design-system/project/tokens.json', import.meta.url), 'utf8'));
const out = [':root {'];
const colors = Object.fromEntries(t.color.tokens.map((x) => [x.name, x.value]));
const resolve = (v) => (typeof v === 'string' && v.startsWith('{') ? resolve(colors[v.slice(1, -1)]) : v);
for (const x of t.color.tokens) out.push(`  --${x.name}: ${resolve(x.value).light ?? resolve(x.value)};`);
out.push(`  --font-sans: ${t.type.families.sans};`, `  --font-print: ${t.type.families.print};`);
for (const g of ['spacing', 'radius', 'size']) for (const x of t[g].tokens) out.push(`  --${x.name}: ${x.value};`);
for (const x of t.shadow.tokens) out.push(`  --${x.name}: ${x.value.light};`);
out.push('}', '', '/* ปุ่ม: แบบร่างใช้มุม 4px · ปุ่มรองขาวขอบเทา · ปุ่มอันตรายขาวขอบแดง (override token — design-system/README.md) */',
  ':root { --button-radius: 4px; --btn-secondary-bg: #ffffff; --btn-secondary-border: var(--border-strong); --btn-danger-bg: #ffffff; }', '');
writeFileSync(new URL('../src/tokens.css', import.meta.url), out.join('\n'));
console.log(`tokens.css: ${out.length} บรรทัด`);
