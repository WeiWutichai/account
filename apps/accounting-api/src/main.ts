// ระบบบัญชี (hub) · M0: มีแค่ GET /health
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
const port = Number(process.env.PORT ?? 4000);
await app.listen(port);
console.log('accounting-api listening on http://localhost:' + port + '/health');
