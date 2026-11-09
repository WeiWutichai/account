import { createDb, type Db } from '@innovera/db';

export const DB = Symbol('DB');
export const dbProvider = { provide: DB, useFactory: (): Db => createDb(process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera', 10) };
