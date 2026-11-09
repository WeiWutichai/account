// Innovera Console API (M8) — เฉพาะทีม Innovera (public.innovera_staff) ที่เข้าสู่ระบบด้วย 2FA · อ่านข้ามบริษัทด้วย console_reader
// ข้อมูลบัญชีของลูกค้าอ่านได้เฉพาะผ่าน withSupportAccess (ticket + consent ของ Owner + เวลาจำกัด + audit ทั้งสองฝั่ง)
import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { verifyAccess } from '@innovera/auth';
import { createDb, type Db } from '@innovera/db';
import { consoleAudit, consoleOps, consoleOverview, consoleTenants, decideAccess, endAccess, listFlags, listTickets, openTicket, pendingAccessFor, requestAccess, setFlag, staffRole, startAccess, withSupportAccess, type StaffRole } from '@innovera/db/console';
import { trialBalance } from '@innovera/db/ledger';
import { listMigrations } from '@innovera/db/migrate';
import { reconChecks } from '@innovera/db/reports';
import { createRemoteJWKSet } from 'jose';
import type { Request } from 'express';
import { companyOf, Public, userOf } from './context.js';
import { DB } from './db.js';

export const READER = Symbol('READER');
export const readerProvider = { provide: READER, useFactory: (): Db => createDb(process.env.CONSOLE_DATABASE_URL ?? 'postgres://console_reader:console_reader@localhost:56432/innovera', 4) };
const jwks = createRemoteJWKSet(new URL(`${process.env.ID_API_URL ?? 'http://localhost:4100'}/.well-known/jwks.json`));
type StaffReq = Request & { staff?: { userId: string; role: StaffRole } };

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<StaffReq>();
    const token = req.header('authorization')?.match(/^Bearer (.+)$/u)?.[1] ?? (req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith('inn_at='))?.slice(7);
    if (!token) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ');
    const c = await verifyAccess(token, jwks, 'accounting').catch(() => { throw new UnauthorizedException('session หมดอายุ'); });
    if (!c.amr.some((a) => a === 'otp' || a === 'backup_code')) throw new ForbiddenException('Console ต้องยืนยัน 2FA ทุกครั้งที่เข้าสู่ระบบ');
    const role = await staffRole(this.db, c.sub);
    if (!role) throw new ForbiddenException('เฉพาะทีม Innovera');
    req.staff = { userId: c.sub, role };
    return true;
  }
}

@Public()
@UseGuards(StaffGuard)
@Controller('console/v1')
export class ConsoleController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(READER) private readonly reader: Db) {}
  @Get('me') me(@Req() req: StaffReq) { return req.staff; }
  @Get('overview') overview() { return consoleOverview(this.reader); }
  @Get('tenants') tenants(@Query('q') q?: string) { return consoleTenants(this.reader, q); }
  @Get('ops') ops() { return consoleOps(this.reader, listMigrations().map((m) => m.id)); }
  @Get('tickets') tickets() { return listTickets(this.db); }
  @Post('tickets') ticket(@Req() req: StaffReq, @Body() b: { orgId: string; companyId?: string; subject: string }) { return openTicket(this.db, req.staff!.userId, b); }
  @Post('access') request(@Req() req: StaffReq, @Body() b: { ticketId: string; reason: string; scope: string; minutes: 30 | 60; write?: boolean }) { return requestAccess(this.db, req.staff!, b); }
  @Post('access/:id/start') start(@Req() req: StaffReq, @Param('id') id: string) { return startAccess(this.db, req.staff!, id); }
  @Post('access/:id/end') async end(@Req() req: StaffReq, @Param('id') id: string) { await endAccess(this.db, req.staff!, id); return { ok: true }; }
  /** ตัวอย่างการอ่านระหว่างเซสชัน (อ่านอย่างเดียว) — ทุกครั้งบันทึก audit ทั้งสองฝั่ง */
  @Get('access/:id/trial-balance') tb(@Req() req: StaffReq, @Param('id') id: string, @Query('year') year: string) {
    return withSupportAccess(this.db, req.staff!, id, `งบทดลอง ${year}`, (cid) => trialBalance(this.db, cid, { fiscalYear: Number(year) }));
  }
  @Get('access/:id/recon') recon(@Req() req: StaffReq, @Param('id') id: string, @Query('month') month: string) {
    return withSupportAccess(this.db, req.staff!, id, `ตรวจความถูกต้อง ${month}`, (cid) => reconChecks(this.db, cid, month));
  }
  @Get('flags') flags() { return listFlags(this.db); }
  @Post('flags') async flag(@Req() req: StaffReq, @Body() b: { key: string; scope: 'global' | 'org' | 'company'; targetId?: string; value: unknown }) {
    if (req.staff!.role !== 'engineer' && req.staff!.role !== 'admin') throw new ForbiddenException('ตั้ง flag ได้เฉพาะ engineer/admin');
    await setFlag(this.db, req.staff!.userId, b);
    return { ok: true };
  }
  @Get('audit') audit() { return consoleAudit(this.db); }
}

/** ฝั่งลูกค้า (accounting-web): คำขอเข้าดูของทีม Innovera ในคิวหน้าแรก · Owner อนุมัติ/ปฏิเสธ */
@Controller('v1/support-access')
export class SupportAccessController {
  constructor(@Inject(DB) private readonly db: Db) {}
  @Get() list(@Req() req: Request) { return pendingAccessFor(this.db, companyOf(req)); }
  @Post(':id/decide') async decide(@Req() req: Request, @Param('id') id: string, @Body() b: { approve: boolean }) {
    const u = userOf(req);
    await decideAccess(this.db, companyOf(req), { userId: u.userId, role: u.role }, id, b.approve === true);
    return { ok: true };
  }
}
