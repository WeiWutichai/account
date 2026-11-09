import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, Public } from './context.js';
import { health, type Health } from './health.js';
import { dbProvider } from './db.js';
import { GlController } from './gl.controller.js';
import { SalesController } from './sales.controller.js';
import { PurchaseController } from './purchase.controller.js';
import { M6Controller } from './m6.controller.js';
import { ApiKeyGuard, ExtController } from './ext.controller.js';
import { HubController } from './hub.controller.js';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  get(): Promise<Health> {
    return health('accounting-api');
  }
}

@Module({ controllers: [HealthController, GlController, SalesController, PurchaseController, M6Controller, ExtController, HubController], providers: [dbProvider, ApiKeyGuard, { provide: APP_GUARD, useClass: AuthGuard }] })
export class AppModule {}
