// cookie / client info / ตัวตรวจ access token — แปลง HTTP ↔ Identity
import { verifyAccess, type AccessClaims } from '@innovera/auth';
import { createLocalJWKSet } from 'jose';
import type { Request, Response } from 'express';
import type { IdConfig } from './config.ts';
import { IdError, type ClientInfo, type Tokens } from './identity.ts';

export const COOKIE = { access: 'inn_at', refresh: 'inn_rt', pending: 'inn_mfa', device: 'inn_dev' } as const;

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export const clientOf = (req: Request): ClientInfo => ({ ip: req.ip ?? req.socket.remoteAddress ?? '', ua: req.header('user-agent') ?? '' });

function base(cfg: IdConfig) {
  return { httpOnly: true, secure: cfg.secureCookies, path: '/', ...(cfg.cookieDomain ? { domain: cfg.cookieDomain } : {}) };
}
export function setSession(res: Response, cfg: IdConfig, t: Tokens) {
  res.cookie(COOKIE.access, t.access, { ...base(cfg), sameSite: 'lax', maxAge: 15 * 60_000 });
  res.cookie(COOKIE.refresh, t.refresh, { ...base(cfg), sameSite: 'strict', expires: t.refreshExpires });
  res.clearCookie(COOKIE.pending, base(cfg));
}
export function setPending(res: Response, cfg: IdConfig, v: string) {
  res.cookie(COOKIE.pending, v, { ...base(cfg), sameSite: 'strict', maxAge: 5 * 60_000 });
}
export function setDevice(res: Response, cfg: IdConfig, v: string) {
  res.cookie(COOKIE.device, v, { ...base(cfg), sameSite: 'strict', maxAge: 30 * 86_400_000 });
}
export function clearSession(res: Response, cfg: IdConfig) {
  for (const c of [COOKIE.access, COOKIE.refresh, COOKIE.pending]) res.clearCookie(c, base(cfg));
}

/** อ่านผู้ใช้จาก access token (cookie หรือ Authorization: Bearer) */
export async function userOf(req: Request, cfg: IdConfig): Promise<AccessClaims> {
  const bearer = req.header('authorization')?.match(/^Bearer (.+)$/u)?.[1];
  const token = bearer ?? cookies(req)[COOKIE.access];
  if (!token) throw new IdError(401, 'กรุณาเข้าสู่ระบบ');
  try {
    return await verifyAccess(token, createLocalJWKSet({ keys: [cfg.signingKey.publicJwk] }), 'id', cfg.now());
  } catch {
    throw new IdError(401, 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
  }
}
