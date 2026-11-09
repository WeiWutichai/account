import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { createDb } from '@innovera/db';
import { Redis } from 'ioredis';
import { loadConfig, type IdConfig } from './config.ts';
import { AuthController, CFG, IDENTITY, JwksController, MeController, ORGS } from './controllers.ts';
import { health, type Health } from './health.js';
import { Identity } from './identity.ts';
import { redisLimiter } from './limiter.ts';
import { Orgs } from './org.ts';

@Controller()
export class HealthController {
  @Get('health')
  get(): Promise<Health> {
    return health('id-api');
  }
}

const DB = Symbol('DB');
@Module({
  controllers: [HealthController, AuthController, MeController, JwksController],
  providers: [
    { provide: CFG, useFactory: () => loadConfig() },
    { provide: DB, useFactory: () => createDb(process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera', 10) },
    { provide: IDENTITY, inject: [DB, CFG], useFactory: (db: ReturnType<typeof createDb>, cfg: IdConfig) =>
      new Identity(db, redisLimiter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:56379', { maxRetriesPerRequest: 2 })), cfg) },
    { provide: ORGS, inject: [DB, CFG], useFactory: (db: ReturnType<typeof createDb>, cfg: IdConfig) => new Orgs(db, cfg.now) },
  ],
})
export class AppModule {}
