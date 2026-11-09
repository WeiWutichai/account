// ระบบบัญชี (hub) · M0: มีแค่ GET /health
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppErrorFilter } from './errors.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
app.useBodyParser('raw', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', limit: '20mb' });
app.useGlobalFilters(new AppErrorFilter());
app.enableCors({ origin: [/localhost:3010$/u] });
const port = Number(process.env.PORT ?? 4000);
await app.listen(port);
console.log('accounting-api listening on http://localhost:' + port + '/health');
