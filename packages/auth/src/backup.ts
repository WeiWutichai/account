// รหัสสำรอง 10 ชุด รูปแบบ "a7k2-93mq" (แบบร่าง ScreenTwoFactor) · เก็บ bcrypt · ใช้ได้ครั้งเดียว
import { compare, hash } from '@node-rs/bcrypt';
import { randomInt } from 'node:crypto';

const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // ตัด i l o 0 1 ที่อ่านสับสน
export const BACKUP_COUNT = 10;
const part = () => Array.from({ length: 4 }, () => CHARS[randomInt(CHARS.length)]).join('');
export const generateBackupCodes = (n = BACKUP_COUNT): string[] => Array.from({ length: n }, () => `${part()}-${part()}`);
export const normalizeBackupCode = (c: string): string => c.trim().toLowerCase().replace(/\s/gu, '');
export const hashBackupCode = (c: string): Promise<string> => hash(normalizeBackupCode(c), { cost: 10 });
/** คืน index ของรหัสที่ตรง (ยังไม่ถูกใช้) หรือ -1 */
export async function matchBackupCode(code: string, hashes: (string | null)[]): Promise<number> {
  const c = normalizeBackupCode(code);
  if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/u.test(c)) return -1;
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    if (h && (await compare(c, h))) return i;
  }
  return -1;
}
