// รหัสผ่าน: Argon2id (OWASP: m=19 MiB, t=2, p=1) · นโยบายตามแบบร่าง ScreenSignup / ScreenPasswordReset
import { hash, verify } from '@node-rs/argon2';

// algorithm 2 = Argon2id (const enum ของไลบรารีใช้ข้าม isolatedModules ไม่ได้)
export const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const MIN_LENGTH = 12;
export const HISTORY = 5;

export const hashPassword = (pw: string): Promise<string> => hash(pw.normalize('NFKC'), ARGON);
export async function verifyPassword(stored: string | null | undefined, pw: string): Promise<boolean> {
  if (!stored) return false;
  try { return await verify(stored, pw.normalize('NFKC')); } catch { return false; }
}
/** ต้อง hash ใหม่เมื่อพารามิเตอร์เปลี่ยน */
export const needsRehash = (stored: string): boolean => !stored.startsWith(`$argon2id$v=19$m=${ARGON.memoryCost},t=${ARGON.timeCost},p=${ARGON.parallelism}$`);

// รายการรหัสผ่านที่รั่วไหลบ่อย (ยาว ≥ 12) — TODO(M3.5): ตรวจกับฐานข้อมูลรั่วไหลเต็มแบบ offline (ไม่ส่งรหัสออกนอกระบบ)
const BREACHED = new Set(['123456789012', '1234567890123', 'qwertyuiopas', 'password1234', 'password12345', 'passwordpassword', 'iloveyou1234', '111111111111', '000000000000',
  'qwerty123456', 'abcdefghijkl', 'abc123456789', 'admin1234567', 'welcome12345', 'letmein12345', 'changeme1234', 'football1234', 'princess1234', 'sunshine1234',
  'monkey123456', 'dragon123456', 'qwertyuiop12', '1q2w3e4r5t6y', 'zaq12wsxcde3', 'asdfghjkl123', 'p@ssw0rd1234', 'passw0rd1234', 'trustno11234', 'superman1234']);

export type PasswordIssue = 'too_short' | 'breached' | 'contains_identity' | 'reused' | 'mismatch';
export const ISSUE_TEXT: Record<PasswordIssue, string> = {
  too_short: `อย่างน้อย ${MIN_LENGTH} ตัวอักษร`,
  breached: 'รหัสผ่านนี้อยู่ในรายการรหัสผ่านที่รั่วไหล',
  contains_identity: 'รหัสผ่านต้องไม่มีอีเมลหรือชื่อของคุณ',
  reused: `ห้ามซ้ำกับ ${HISTORY} รหัสล่าสุด`,
  mismatch: 'ยืนยันรหัสผ่านไม่ตรงกัน',
};

export async function checkPassword(pw: string, ctx: { email?: string; confirm?: string; history?: string[] } = {}): Promise<PasswordIssue[]> {
  const issues: PasswordIssue[] = [];
  const p = pw.normalize('NFKC');
  if ([...p].length < MIN_LENGTH) issues.push('too_short');
  const lower = p.toLowerCase();
  if (BREACHED.has(lower) || /^(.)\1+$/u.test(p)) issues.push('breached');
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) issues.push('contains_identity');
  if (ctx.confirm !== undefined && ctx.confirm !== pw) issues.push('mismatch');
  for (const h of (ctx.history ?? []).slice(0, HISTORY)) {
    if (await verifyPassword(h, pw)) { issues.push('reused'); break; }
  }
  return issues;
}
