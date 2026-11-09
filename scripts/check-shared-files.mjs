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

if (failed) { console.error(`\n${failed} ปัญหา`); process.exit(1); }
