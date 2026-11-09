// context ของ request (M3): ผู้ใช้จาก access token ของ Innovera ID + บริษัทที่เลือก (x-company-id · FR-TN-04) + membership/สิทธิ์จาก DB
// ทุก route ใน /v1 ผ่าน AuthGuard · ไม่มี route ไหนอ่านข้ามบริษัท (PLAN §2)
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException, BadRequestException, type CallHandler, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, effectivePermissions, verifyAccess, type Action, type Area, type CompanyRole as AuthRole, type Permissions } from '@innovera/auth';
import { withAuditContext, type AuditContext, type Db } from '@innovera/db';
import type { CompanyRole } from '@innovera/ledger';
import { createRemoteJWKSet } from 'jose';
import type { Request } from 'express';
import { DB } from './db.js';

export interface ReqCtx { userId: string; email: string; companyId: string; role: AuthRole; ledgerRole: CompanyRole; permissions: Permissions; approvalLimit: string | null }
type WithCtx = Request & { ctx?: ReqCtx };

const ID_API = process.env.ID_API_URL ?? 'http://localhost:4100';
const jwks = createRemoteJWKSet(new URL(`${ID_API}/.well-known/jwks.json`), { cooldownDuration: 30_000 });
/** dev เท่านั้น: x-company-id/x-role แทน session (ห้ามใน production — ตรวจตอนเริ่ม) */
export const DEV_HEADERS = process.env.AUTH_DEV_HEADERS === '1';
if (DEV_HEADERS && process.env.NODE_ENV === 'production') throw new Error('AUTH_DEV_HEADERS ใช้ใน production ไม่ได้');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PERM = 'perm';
/** สิทธิ์ที่ route ต้องมี (ตามเมทริกซ์ ScreenUsers/ScreenUserEdit) */
export const Need = (area: Area, action: Action) => SetMetadata(PERM, { area, action });
export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);

/** บทบาทของ ledger (ตรวจงวดปิดอ่อน) — บทบาทอื่นแปลงตามสิทธิ์ผ่านรายการ */
export function toLedgerRole(role: AuthRole, p: Permissions): CompanyRole {
  if (role === 'owner' || role === 'accounting_manager' || role === 'accountant' || role === 'ar_clerk' || role === 'viewer' || role === 'auditor') return role;
  if (role === 'petty_cash_holder') return 'ap_clerk';
  return can(p, 'journal', 'post') ? 'accountant' : 'viewer';
}

function tokenOf(req: Request): string | undefined {
  const bearer = req.header('authorization')?.match(/^Bearer (.+)$/u)?.[1];
  if (bearer) return bearer;
  return (req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith('inn_at='))?.slice(7);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db, @Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<WithCtx>();
    const companyId = req.header('x-company-id') ?? (DEV_HEADERS ? process.env.DEV_COMPANY_ID : undefined);
    if (!companyId || !UUID.test(companyId)) throw new BadRequestException('ต้องเลือกบริษัท (x-company-id)');
    let userId: string;
    let email: string;
    let role: AuthRole;
    let override: Parameters<typeof effectivePermissions>[1] = null;
    let approvalLimit: string | null = null;
    if (DEV_HEADERS && !tokenOf(req)) {
      userId = 'dev';
      email = 'dev@localhost';
      role = (req.header('x-role') ?? 'accountant') as AuthRole;
    } else {
      const token = tokenOf(req);
      if (!token) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ');
      const claims = await verifyAccess(token, jwks, 'accounting').catch(() => { throw new UnauthorizedException('session หมดอายุ — กรุณาเข้าสู่ระบบใหม่'); });
      userId = claims.sub;
      email = claims.email;
      const m = await this.db.withPublic((tx) => tx.selectFrom('public.company_membership').select(['company_role', 'permissions', 'expires_at', 'require_2fa', 'approval_limit'])
        .where('user_id', '=', userId).where('company_id', '=', companyId).executeTakeFirst());
      if (!m || (m.expires_at && m.expires_at < new Date().toISOString().slice(0, 10))) throw new ForbiddenException('ไม่มีสิทธิ์เข้าบริษัทนี้');
      // บริษัทบังคับ 2FA: session ต้องผ่าน otp/backup_code/อุปกรณ์ที่เชื่อถือ
      if (m.require_2fa && !claims.amr.some((a) => a === 'otp' || a === 'backup_code' || a === 'trusted_device')) throw new ForbiddenException('บริษัทนี้บังคับ 2FA — ตั้งค่า 2FA ก่อนใช้งาน');
      role = m.company_role as AuthRole;
      override = m.permissions;
      approvalLimit = m.approval_limit;
    }
    const permissions = effectivePermissions(role, override);
    const need = this.reflector.getAllAndOverride<{ area: Area; action: Action } | undefined>(PERM, [ctx.getHandler(), ctx.getClass()]);
    if (need && !can(permissions, need.area, need.action)) throw new ForbiddenException('ไม่มีสิทธิ์ทำรายการนี้');
    req.ctx = { userId, email, companyId, role, ledgerRole: toLedgerRole(role, permissions), permissions, approvalLimit };
    return true;
  }
}

function ctxOf(req: Request): ReqCtx {
  const c = (req as WithCtx).ctx;
  if (!c) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ');
  return c;
}
export const companyOf = (req: Request): string => ctxOf(req).companyId;
export const roleOf = (req: Request): CompanyRole => ctxOf(req).ledgerRole;
export const userOf = (req: Request): ReqCtx => ctxOf(req);
/** user id สำหรับเขียนลงฐาน (โหมด dev headers = null) */
export const actorIdOf = (req: Request): string | null => { const u = ctxOf(req).userId; return u === 'dev' ? null : u; };

/** IP ของผู้เรียก (Express req.ip — main.ts ตั้ง trust proxy ให้เชื่อ x-forwarded-for จาก proxy ของ accounting-web ในเครือข่ายภายใน) */
export const ipOf = (req: Request): string | null => (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/u, '') || null;
export function channelOf(path: string): AuditContext['channel'] {
  if (path.startsWith('/ext/v1/mcp')) return 'mcp';
  return path.startsWith('/ext/') ? 'api' : 'web';
}

/** ส่งช่องทาง/IP/API client ของ request เข้า withCompany → ค่าตั้งต้นของ acct.audit_log.channel/ip/api_client_id (migration 0016)
 *  รันหลัง guard (ApiKeyGuard ตั้ง req.api แล้ว) · Nest ผูก next.handle() กับ async context ตอนเรียก จึงสืบทอดถึง handler */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { api?: { id: string } }>();
    return withAuditContext({ channel: channelOf(req.path), ip: ipOf(req), clientId: req.api?.id ?? null }, () => next.handle());
  }
}
