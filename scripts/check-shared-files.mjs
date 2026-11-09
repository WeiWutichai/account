// ตรวจไฟล์ร่วม (CLAUDE.md · PROGRESS.md §6): แบบร่าง/ระบบออกแบบตรง MANIFEST · fixtures ผ่าน schema
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = new URL('..', import.meta.url).pathname;
let failed = 0;
const fail = (m) => { failed++; console.error('✗', m); };

for (const dir of ['design', 'design-system']) {
  const m = JSON.parse(readFileSync(join(root, dir, 'MANIFEST.json'), 'utf8'));
  const listed = Object.keys(m.files);
  for (const [p, v] of Object.entries(m.files)) {
    const h = createHash('sha256').update(readFileSync(join(root, dir, p))).digest('hex');
    if (h !== v.sha256) fail(`${dir}/${p} sha256 ไม่ตรง MANIFEST — ห้ามแก้ไฟล์ใน ${dir}/ จาก repo`);
  }
  const onDisk = readdirSync(join(root, dir, 'project'), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name).slice(join(root, dir).length + 1));
  for (const f of onDisk) if (!listed.includes(f)) fail(`${dir}/${f} ไม่อยู่ใน MANIFEST`);
  console.log(`✓ ${dir}: ${listed.length} ไฟล์ ตรง MANIFEST${m.design_version ? ` (แบบร่างเวอร์ชัน ${m.design_version})` : ''}`);
}

const schema = JSON.parse(readFileSync(join(root, 'fixtures/sample-company.schema.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(root, 'fixtures/sample-company.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
if (!ajv.validate(schema, data)) for (const e of ajv.errors.slice(0, 10)) fail(`fixtures ${e.instancePath} ${e.message}`);
else console.log(`✓ fixtures ผ่าน schema · ${data._meta.source}`);

// ยอดเงินทุกค่าในแบบร่าง (หน้าบัญชี · รวมค่าในช่องกรอก) ต้องมีใน fixtures (CLAUDE.md: ตัวเลขทุกตัวบนหน้าจอมาจาก fixtures)
const raw = readFileSync(join(root, 'fixtures/sample-company.json'), 'utf8');
const known = new Set([...raw.matchAll(/"(-?\d+\.\d{2})"/gu)].map((m) => Number(m[1]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('-', '')));
const AMOUNT = /\b\d{1,3}(?:,\d{3})+\.\d{2}\b|\b\d{3}\.\d{2}\b/gu;
let checked = 0;
const missing = [];
for (const f of readdirSync(join(root, 'design/project')).filter((n) => n.endsWith('.dc.html') && !n.startsWith('Console') && n !== 'Blank.dc.html')) {
  const body = readFileSync(join(root, 'design/project', f), 'utf8').split('</helmet>').pop();
  const text = body.replace(/<[^>]+>/gu, ' ') + ' ' + [...body.matchAll(/value="([^"]*)"/gu)].map((m) => m[1]).join(' ');
  for (const m of new Set(text.match(AMOUNT) ?? [])) {
    checked++;
    if (!known.has(m) && !raw.includes(m)) missing.push(`${f}: ${m}`);
  }
}
if (missing.length) for (const m of missing.slice(0, 20)) fail(`ยอดในแบบร่างไม่มีใน fixtures — ${m}`);
else console.log(`✓ ยอดเงินในแบบร่าง ${checked} ค่า มีใน fixtures ครบ`);

if (failed) { console.error(`\n${failed} ปัญหา`); process.exit(1); }
