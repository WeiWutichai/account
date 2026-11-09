// TOTP (RFC 6238) — SHA-1 · 6 หลัก · 30 วินาที ตามแบบร่าง ScreenTwoFactor · ยอมคลาดเคลื่อน ±1 ช่วง · ห้ามใช้ช่วงเดิมซ้ำ
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP = { digits: 6, period: 30, algorithm: 'SHA1', window: 1 } as const;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/gu, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('คีย์ base32 ไม่ถูกต้อง');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
/** คีย์ใหม่ 20 byte (160 bit ตาม RFC 4226) */
export const generateSecret = (): string => base32Encode(randomBytes(20));
/** แสดงเป็นกลุ่มละ 4 ตัว เช่น "JBSW Y3DP EHPK 3PXP" */
export const formatSecret = (s: string): string => s.replace(/(.{4})/gu, '$1 ').trim();

export function hotp(key: Buffer, counter: bigint, digits: number = TOTP.digits, algorithm = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const h = createHmac(algorithm, key).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const stepAt = (unixMs: number): number => Math.floor(unixMs / 1000 / TOTP.period);
export const totpAt = (secret: string, unixMs: number): string => hotp(base32Decode(secret), BigInt(stepAt(unixMs)));

/** คืนช่วงเวลาที่ตรง (เก็บเป็น last_step กันใช้ซ้ำ) หรือ null */
export function verifyTotp(secret: string, code: string, unixMs: number, lastStep: number | null = null): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const key = base32Decode(secret);
  const now = stepAt(unixMs);
  for (let d = -TOTP.window; d <= TOTP.window; d++) {
    const step = now + d;
    if (lastStep !== null && step <= lastStep) continue;
    if (hotp(key, BigInt(step)) === code) return step;
  }
  return null;
}
export function otpauthUri(secret: string, account: string, issuer = 'Innovera ID'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=${TOTP.algorithm}&digits=${TOTP.digits}&period=${TOTP.period}`;
}
