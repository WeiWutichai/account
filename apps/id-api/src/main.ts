// Innovera ID (M3) — signup / login / 2FA / session / องค์กร / คำเชิญ · ใช้ร่วมทุกแอป Innovera
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.ts';
import { IdErrorFilter } from './errors.ts';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
// อยู่หลัง proxy (id-web / load balancer) 1 ชั้น → req.ip = IP จริงของผู้ใช้
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.useGlobalFilters(new IdErrorFilter());
const port = Number(process.env.PORT ?? 4100);
await app.listen(port);
console.log('id-api listening on http://localhost:' + port + '/health');
