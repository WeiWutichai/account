import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor, AuthGuard, Public } from './context.js';
import { health, type Health } from './health.js';
import { dbProvider } from './db.js';
import { GlController } from './gl.controller.js';
import { SalesController } from './sales.controller.js';
import { PurchaseController } from './purchase.controller.js';
import { M6Controller } from './m6.controller.js';
import { ApiCallInterceptor, ApiKeyGuard, ExtController } from './ext.controller.js';
import { HubController } from './hub.controller.js';
import { MasterController } from './master.controller.js';
import { ConsoleController, readerProvider, StaffGuard, SupportAccessController } from './console.controller.js';
import { ContractController } from './contract.controller.js';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  get(): Promise<Health> {
    return health('accounting-api');
  }
}

@Module({ controllers: [HealthController, GlController, SalesController, PurchaseController, M6Controller, ExtController, HubController, MasterController, ConsoleController, SupportAccessController, ContractController], providers: [dbProvider, readerProvider, StaffGuard, ApiKeyGuard, ApiCallInterceptor, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }] })
export class AppModule {}
