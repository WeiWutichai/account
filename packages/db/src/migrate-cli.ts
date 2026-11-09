import { migrateDown, migrateUp } from './migrate.ts';

const url = process.env.MIGRATE_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:55432/innovera';
const cmd = process.argv[2];
const ran = cmd === 'down' ? await migrateDown(url, Number(process.argv[3] ?? 1)) : await migrateUp(url);
console.log(ran.length ? `${cmd}: ${ran.join(', ')}` : `${cmd}: ไม่มีอะไรต้องรัน`);
