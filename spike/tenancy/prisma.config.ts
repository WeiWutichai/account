import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DIRECT_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/innovera' },
});
