// HTTP ของ Innovera ID (/v1) — logic อยู่ใน identity.ts / org.ts
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { COMPANY_ROLE_LABEL, type CompanyRole } from '@innovera/auth';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import type { IdConfig } from './config.ts';
import { clearSession, clientOf, COOKIE, cookies, setDevice, setPending, setSession, userOf } from './http.ts';
import { IdError, Identity, type LoginResult } from './identity.ts';
import { Orgs } from './org.ts';

export const CFG = Symbol('CFG');
export const IDENTITY = Symbol('IDENTITY');
export const ORGS = Symbol('ORGS');

/** ตอบผลการเข้าสู่ระบบ: ตั้ง cookie + บอกขั้นถัดไป (ไม่ส่ง token ใน body) */
function reply(res: Response, cfg: IdConfig, r: LoginResult) {
  if (r.kind === 'session') {
    setSession(res, cfg, r.tokens);
    if (r.trustedDevice) setDevice(res, cfg, r.trustedDevice);
    return { next: 'done' as const };
  }
  setPending(res, cfg, r.pending);
  return { next: r.stage, email: maskEmail(r.email) };
}
/** "wei@innovera.co.th" → "wei@innovera…" (แบบร่าง ScreenTwoFactor) */
export const maskEmail = (e: string): string => { const [u, d = ''] = e.split('@'); return `${u}@${d.split('.')[0]}…`; };

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(IDENTITY) private readonly id: Identity, @Inject(CFG) private readonly cfg: IdConfig) {}

  @Post('signup') @HttpCode(200)
  async signup(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { name: string; email: string; password: string; acceptTerms: boolean; marketing?: boolean }) {
    return reply(res, this.cfg, await this.id.signup(b, clientOf(req)));
  }
  @Post('verify-email') @HttpCode(200)
  async verifyEmail(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { code: string }) {
    return reply(res, this.cfg, await this.id.verifyEmail(cookies(req)[COOKIE.pending] ?? '', b.code, clientOf(req)));
  }
  @Post('verify-email/resend') @HttpCode(204)
  async resend(@Req() req: Request) { await this.id.resendVerifyCode(cookies(req)[COOKIE.pending] ?? '', clientOf(req)); }

  @Post('login') @HttpCode(200)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { email: string; password: string }) {
    return reply(res, this.cfg, await this.id.login(b, clientOf(req), cookies(req)[COOKIE.device] ?? null));
  }
  /** ข้อมูลของหน้า 2FA ระหว่างรอ (อีเมลแบบย่อ) */
  @Get('pending')
  async pending(@Req() req: Request, @Query('stage') stage: 'mfa' | 'setup' | 'verify') {
    return { email: maskEmail(await this.id.pendingEmail(cookies(req)[COOKIE.pending], clientOf(req), stage)) };
  }
  @Post('2fa/verify') @HttpCode(200)
  async verify2fa(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { code?: string; backupCode?: string; trust?: boolean }) {
    return reply(res, this.cfg, await this.id.verifyMfa(cookies(req)[COOKIE.pending] ?? '', b, clientOf(req)));
  }
  /** เริ่มตั้ง 2FA: จากขั้นเข้าสู่ระบบ (pending) หรือจากหน้าโปรไฟล์ (session) */
  @Post('2fa/setup') @HttpCode(200)
  async setup2fa(@Req() req: Request) {
    const c = cookies(req);
    const r = c[COOKIE.pending] ? await this.id.startMfaSetup({ pending: c[COOKIE.pending]!, client: clientOf(req) }) : await this.id.startMfaSetup({ userId: (await userOf(req, this.cfg)).sub });
    return { secret: r.secretFormatted, account: maskEmail(r.account), qr: await QRCode.toString(r.uri, { type: 'svg', margin: 0 }) };
  }
  @Post('2fa/enable') @HttpCode(200)
  async enable2fa(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { code: string }) {
    const c = cookies(req);
    const r = c[COOKIE.pending] ? await this.id.enableMfa({ pending: c[COOKIE.pending]!, client: clientOf(req) }, b.code) : await this.id.enableMfa({ userId: (await userOf(req, this.cfg)).sub }, b.code);
    if (r.tokens) setSession(res, this.cfg, r.tokens);
    return { backupCodes: r.backupCodes, next: r.tokens ? 'done' : 'profile' };
  }
  @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = cookies(req)[COOKIE.refresh];
    if (!rt) throw new IdError(401, 'กรุณาเข้าสู่ระบบ');
    try {
      setSession(res, this.cfg, await this.id.refresh(rt, clientOf(req)));
      return { next: 'done' };
    } catch (e) {
      clearSession(res, this.cfg);
      throw e;
    }
  }
  @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.id.logout(cookies(req)[COOKIE.refresh] ?? null, clientOf(req));
    clearSession(res, this.cfg);
  }
  @Post('password/forgot') @HttpCode(200)
  forgot(@Req() req: Request, @Body() b: { email: string }) { return this.id.forgotPassword(b.email, clientOf(req)); }
  @Post('password/reset') @HttpCode(200)
  async reset(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { token: string; password: string; confirm: string; logoutOthers: boolean }) {
    return reply(res, this.cfg, await this.id.resetPassword(b, clientOf(req)));
  }
}

@Controller('v1')
export class MeController {
  constructor(@Inject(IDENTITY) private readonly id: Identity, @Inject(ORGS) private readonly orgs: Orgs, @Inject(CFG) private readonly cfg: IdConfig) {}

  @Get('me')
  async me(@Req() req: Request) {
    const u = await userOf(req, this.cfg);
    if (!(await this.id.isSessionActive(u.sid))) throw new IdError(401, 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
    const user = await this.id.userById(u.sub);
    return { user, companies: await this.orgs.companiesOf(u.sub), amr: u.amr };
  }
  @Get('companies')
  async companies(@Req() req: Request) { return this.orgs.companiesOf((await userOf(req, this.cfg)).sub); }
  @Post('companies')
  async createCompany(@Req() req: Request, @Body() b: Parameters<Orgs['createCompany']>[1]) { return this.orgs.createCompany((await userOf(req, this.cfg)).sub, b); }
  @Put('companies/:id/setup-step')
  async setupStep(@Req() req: Request, @Param('id') id: string, @Body() b: { step: number }) { await this.orgs.setSetupStep((await userOf(req, this.cfg)).sub, id, b.step); return { ok: true }; }
  /** ตรวจสิทธิ์เข้าบริษัท (accounting-api เรียก) */
  @Get('companies/:id/membership')
  async membership(@Req() req: Request, @Param('id') id: string) {
    const m = await this.orgs.membership((await userOf(req, this.cfg)).sub, id);
    if (!m) throw new IdError(403, 'ไม่มีสิทธิ์เข้าบริษัทนี้');
    return m;
  }
  @Get('companies/:id/users')
  async users(@Req() req: Request, @Param('id') id: string) { return this.orgs.companyUsers((await userOf(req, this.cfg)).sub, id); }
  @Put('companies/:id/users/:uid')
  async updateUser(@Req() req: Request, @Param('id') id: string, @Param('uid') uid: string, @Body() b: Parameters<Orgs['updateCompanyUser']>[3]) {
    await this.orgs.updateCompanyUser((await userOf(req, this.cfg)).sub, id, uid, b);
    return { ok: true };
  }
  @Delete('companies/:id/users/:uid')
  async revokeUser(@Req() req: Request, @Param('id') id: string, @Param('uid') uid: string) {
    await this.orgs.revokeCompanyAccess((await userOf(req, this.cfg)).sub, id, uid);
    return { ok: true };
  }
  @Get('orgs/:id')
  async org(@Req() req: Request, @Param('id') id: string) { return this.orgs.orgOverview((await userOf(req, this.cfg)).sub, id); }
  @Post('invites')
  async invite(@Req() req: Request, @Body() b: { orgId: string; companyId: string; email: string; role: CompanyRole; kind?: 'member' | 'auditor'; accessUntil?: string }) {
    const r = await this.orgs.invite((await userOf(req, this.cfg)).sub, b);
    return { id: r.id }; // token ส่งทางอีเมลเท่านั้น
  }
  @Delete('invites/:id')
  async revokeInvite(@Req() req: Request, @Param('id') id: string) { await this.orgs.revokeInvite((await userOf(req, this.cfg)).sub, id); return { ok: true }; }
  /** หน้า ScreenInviteAccept (ดูได้โดยไม่ต้องเข้าสู่ระบบ) */
  @Get('invites/by-token/:token')
  async inviteInfo(@Req() req: Request, @Param('token') token: string) {
    const viewer = await userOf(req, this.cfg).then((u) => ({ userId: u.sub, email: u.email })).catch(() => null);
    return { ...(await this.orgs.inviteInfo(token, viewer)), viewer: viewer ? maskEmail(viewer.email) : null };
  }
  @Post('invites/by-token/:token/accept')
  async accept(@Req() req: Request, @Param('token') token: string) { const u = await userOf(req, this.cfg); return this.orgs.acceptInvite({ userId: u.sub, email: u.email }, token); }
  @Post('invites/by-token/:token/decline') @HttpCode(204)
  async decline(@Req() req: Request, @Param('token') token: string) { const u = await userOf(req, this.cfg); await this.orgs.declineInvite({ userId: u.sub, email: u.email }, token); }
  @Get('roles')
  roles() { return COMPANY_ROLE_LABEL; }
}

@Controller('.well-known')
export class JwksController {
  constructor(@Inject(CFG) private readonly cfg: IdConfig) {}
  @Get('jwks.json')
  jwks() { return { keys: [this.cfg.signingKey.publicJwk] }; }
}
