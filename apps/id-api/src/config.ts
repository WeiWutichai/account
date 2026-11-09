// ค่าตั้งของ Innovera ID · production ต้องตั้ง env ครบ (ไม่มีค่าตั้งต้น) · dev สร้างคีย์ชั่วคราวและเตือน
import { loadSigningKey, newSigningKey, type SigningKey } from '@innovera/auth';
import { createHash, createPrivateKey } from 'node:crypto';
import { exportJWK } from 'jose';

export interface IdConfig {
  signingKey: SigningKey;
  dataKey: string;      // AES-256 (base64) สำหรับ TOTP secret
  cookieKey: string;    // HMAC สำหรับ cookie pending/อุปกรณ์ที่เชื่อถือ
  audience: string[];   // แอปที่รับ access token
  secureCookies: boolean;
  cookieDomain: string | undefined;
  now: () => Date;      // ใส่เวลาได้ใน test
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<IdConfig> {
  const prod = env.NODE_ENV === 'production';
  const need = (k: string): string | undefined => {
    const v = env[k];
    if (!v && prod) throw new Error(`ต้องตั้ง ${k} ใน production`);
    return v;
  };
  const jwk = need('ID_JWT_PRIVATE_JWK');
  const dataKey = need('ID_DATA_KEY');
  const cookieKey = need('ID_COOKIE_KEY');
  if (!prod && (!jwk || !dataKey || !cookieKey)) console.warn('[id-api] ใช้คีย์ dev คงที่ (DEV ONLY) — production ต้องตั้ง ID_JWT_PRIVATE_JWK / ID_DATA_KEY / ID_COOKIE_KEY');
  return {
    signingKey: jwk ? await loadSigningKey(JSON.parse(jwk)) : await devSigningKey(),
    dataKey: dataKey ?? DEV_DATA_KEY,
    cookieKey: cookieKey ?? devSecret('cookie').toString('base64url'),
    audience: (env.ID_AUDIENCE ?? 'id,accounting').split(','),
    secureCookies: prod,
    cookieDomain: env.ID_COOKIE_DOMAIN,
    now: () => new Date(),
  };
}

// ---------- คีย์ dev คงที่ (ไม่ใช่ความลับ · ใช้ได้เฉพาะ NODE_ENV ≠ production) — restart แล้ว session/TOTP ใน dev ยังใช้ได้ ----------
const devSecret = (label: string): Buffer => createHash('sha256').update(`innovera-dev-only:${label}`).digest();
export const DEV_DATA_KEY = devSecret('data').toString('base64');
async function devSigningKey() {
  // Ed25519 จาก seed คงที่ (PKCS#8 prefix ของ Ed25519 + seed 32 byte)
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), devSecret('jwt')]);
  const jwk = await exportJWK(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
  return loadSigningKey({ ...jwk, kid: 'dev', alg: 'EdDSA' });
}
void newSigningKey;
