// เข้ารหัสข้อมูลลับที่ต้องอ่านกลับได้ (TOTP secret) · AES-256-GCM · คีย์ 32 byte (base64) จาก env
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyOf(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('คีย์เข้ารหัสต้องยาว 32 byte (base64)');
  return k;
}
/** คืน `v1.iv.tag.ciphertext` (base64url) */
export function encrypt(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(keyB64), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), body].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
}
export function decrypt(blob: string, keyB64: string): string {
  const [v, iv, tag, body] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('รูปแบบข้อมูลเข้ารหัสไม่ถูกต้อง');
  const d = createDecipheriv('aes-256-gcm', keyOf(keyB64), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
