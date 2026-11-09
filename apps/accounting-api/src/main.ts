// ระบบบัญชี (hub) · /v1 ทุก route ผ่าน AuthGuard (Innovera ID + membership)
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppErrorFilter } from './errors.js';
import type { Db } from '@innovera/db';
import { deliverDue } from '@innovera/db/hub';
import { DB } from './db.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
app.useBodyParser('raw', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', limit: '20mb' });
app.useGlobalFilters(new AppErrorFilter());
// IP จริงใน audit log: เชื่อ x-forwarded-for เฉพาะจาก proxy ในเครือข่ายภายใน (accounting-web /api/proxy)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
// เรียกผ่าน proxy ของ accounting-web (same-origin) — ไม่เปิด CORS
// ตัวส่ง webhook (outbox) ทุก 30 วินาที · บริษัทที่มีรายการรอส่ง · ปิดได้ด้วย WEBHOOK_WORKER=0
if (process.env.WEBHOOK_WORKER !== '0') {
  const db = app.get<Db>(DB);
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      const companies = await db.withPublic((tx) => tx.selectFrom('public.company').select('id').where('status', '=', 'active').execute());
      for (const c of companies) await deliverDue(db, c.id).catch((e: Error) => console.error(`[webhook] ${c.id}: ${e.message}`));
    })().finally(() => { busy = false; });
  }, 30_000).unref();
}
const port = Number(process.env.PORT ?? 4000);
await app.listen(port);
console.log('accounting-api listening on http://localhost:' + port + '/health');
