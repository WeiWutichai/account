// ค่าตั้งของ Innovera ID · production ต้องตั้ง env ครบ (ไม่มีค่าตั้งต้น) · dev สร้างคีย์ชั่วคราวและเตือน
import { loadSigningKey, newSigningKey, type SigningKey } from '@innovera/auth';
import { randomBytes } from 'node:crypto';

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
  if (!prod && (!jwk || !dataKey || !cookieKey)) console.warn('[id-api] ใช้คีย์ชั่วคราวสำหรับ dev — ตั้ง ID_JWT_PRIVATE_JWK / ID_DATA_KEY / ID_COOKIE_KEY เพื่อให้คงที่');
  return {
    signingKey: jwk ? await loadSigningKey(JSON.parse(jwk)) : (await newSigningKey('dev')).key,
    dataKey: dataKey ?? randomBytes(32).toString('base64'),
    cookieKey: cookieKey ?? randomBytes(32).toString('base64url'),
    audience: (env.ID_AUDIENCE ?? 'id,accounting').split(','),
    secureCookies: prod,
    cookieDomain: env.ID_COOKIE_DOMAIN,
    now: () => new Date(),
  };
}
