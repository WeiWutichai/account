import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { health, type Health } from './health.js';

@Controller()
export class HealthController {
  @Get('health')
  get(): Promise<Health> {
    return health('accounting-api');
  }
}

@Module({ controllers: [HealthController] })
export class AppModule {}
