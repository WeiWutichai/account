import { defineConfig } from 'vitest/config';

// unit test เท่านั้น · e2e (Playwright) อยู่ใน e2e/ รันแยกด้วย npx playwright test
export default defineConfig({ test: { include: ['test/**/*.test.ts', 'app/**/*.test.ts'], exclude: ['e2e/**', 'node_modules/**', '.next/**'] } });
