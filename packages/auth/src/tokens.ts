// token สุ่ม · hash · HMAC · รหัส OTP — เก็บเฉพาะ hash ใน DB เสมอ
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** token สุ่ม 32 byte (base64url) สำหรับลิงก์ในอีเมล / refresh token */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** รหัสตัวเลข 6 หลัก (ยืนยันอีเมล) */
export const numericCode = (digits = 6): string => String(randomInt(0, 10 ** digits)).padStart(digits, '0');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** ค่าลงนาม `payload.sig` (HMAC-SHA256) — ใช้กับ cookie pending-2FA / อุปกรณ์ที่เชื่อถือ */
export function sign(payload: string, key: string): string {
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}
export function unsign(signed: string, key: string): string | null {
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = signed.slice(0, i);
  return safeEqual(sign(payload, key), signed) ? payload : null;
}
/** ผูก cookie กับ IP/UA: เก็บแค่ hash สั้น ไม่เก็บ IP ตรง */
export const bindingOf = (ip: string, ua: string): string => sha256(`${ip}|${ua}`).slice(0, 16);
