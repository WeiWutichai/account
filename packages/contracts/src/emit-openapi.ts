// สร้าง OpenAPI components (JSON Schema) จาก zod · paths เต็มทำใน M7
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { schemas } from './index.ts';

const components = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' })]));
const doc = { openapi: '3.1.0', info: { title: 'Innovera AccountSystem API', version: '0.1.0' }, paths: {}, components: { schemas: components } };
writeFileSync(new URL('../openapi/components.json', import.meta.url), JSON.stringify(doc, null, 2) + '\n');
console.log(`components: ${Object.keys(components).length}`);
