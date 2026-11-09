// Innovera ID · M0: มีแค่ GET /health
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
const port = Number(process.env.PORT ?? 4100);
await app.listen(port);
console.log('id-api listening on http://localhost:' + port + '/health');
