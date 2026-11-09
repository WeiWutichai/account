// ตรวจว่ากฎเฉพาะของโปรเจกต์จับได้จริง (ไม่ใช่แค่ตั้งไว้)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import config from '../eslint.config.js';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
const lint = async (code, file = 'x.ts') => (await eslint.lintText(code, { filePath: file }))[0].messages.map((m) => m.ruleId);

test('ยอดเงินเป็น number ใน interface → error', async () => {
  assert.ok((await lint('export interface L { amount: number }')).includes('no-restricted-syntax'));
  assert.ok((await lint('export interface L { grandTotal: number }')).includes('no-restricted-syntax'));
});
test('ยอดเงินเป็น number ใน class field และตัวแปร → error', async () => {
  assert.ok((await lint('export class A { vat: number = 0 }')).includes('no-restricted-syntax'));
  assert.ok((await lint('export const lineTotal: number = 1;')).includes('no-restricted-syntax'));
});
test('qty เป็น number ได้ · ยอดเงินเป็น string ได้', async () => {
  assert.deepEqual(await lint('export interface L { qty: number; amount: string }'), []);
});
test('any และ @ts-ignore → error', async () => {
  assert.ok((await lint('export const x: any = 1;')).includes('@typescript-eslint/no-explicit-any'));
  assert.ok((await lint('// @ts-ignore\nexport const y = 1;')).includes('@typescript-eslint/ban-ts-comment'));
});
test('href="#" ใน JSX → error', async () => {
  assert.ok((await lint('export const A = () => <a href="#">x</a>;', 'a.tsx')).includes('no-restricted-syntax'));
});

test('import kysely นอก packages/db → error', async () => {
  assert.ok((await lint("import { Kysely } from 'kysely';\nexport const k = Kysely;")).includes('no-restricted-imports'));
});
