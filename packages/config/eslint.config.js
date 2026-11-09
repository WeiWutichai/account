// ESLint flat config ร่วมทุก package — กติกาจาก CLAUDE.md / PLAN §7
import tseslint from 'typescript-eslint';

const MONEY = '/^(amount|total|subtotal|grandTotal|vat|wht|price|unitPrice|balance|debit|credit|fee|discount)$|(Amount|Total|Vat|Wht|Price|Balance)$/u';

export const moneyRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `TSPropertySignature[key.name=${MONEY}] > TSTypeAnnotation > TSNumberKeyword`,
      message: 'ยอดเงินห้ามเป็น number — ใช้ Money (decimal.js) จาก @innovera/ledger',
    },
    {
      selector: `PropertyDefinition[key.name=${MONEY}] > TSTypeAnnotation > TSNumberKeyword`,
      message: 'ยอดเงินห้ามเป็น number — ใช้ Money (decimal.js) จาก @innovera/ledger',
    },
    {
      selector: `VariableDeclarator[id.name=${MONEY}] > Identifier > TSTypeAnnotation > TSNumberKeyword`,
      message: 'ยอดเงินห้ามเป็น number — ใช้ Money (decimal.js) จาก @innovera/ledger',
    },
    {
      selector: "JSXAttribute[name.name='href'][value.value='#']",
      message: 'ห้าม href="#" (CLAUDE.md · UI)',
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/*.config.*js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' }],
      ...moneyRules,
      // ADR-001: ตารางบัญชีเข้าถึงผ่าน @innovera/db (withCompany) เท่านั้น
      'no-restricted-imports': ['error', { paths: [{ name: 'kysely', message: 'ใช้ @innovera/db (withCompany) แทน — ห้ามเข้าถึง DB ตรง (ADR-001)' }] }],
    },
  },
);

/** สำหรับ package ที่ได้รับอนุญาตให้ใช้ kysely ตรง (packages/db, spike) */
export const allowDbAccess = { rules: { 'no-restricted-imports': 'off' } };
