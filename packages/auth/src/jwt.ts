// access token: JWT EdDSA อายุสั้น · แอปอื่นตรวจด้วย JWKS ของ id-api (/.well-known/jwks.json)
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK, type JWTPayload, type CryptoKey } from 'jose';

export const ISSUER = 'innovera-id';
export const ACCESS_TTL_S = 15 * 60;
export interface AccessClaims extends JWTPayload { sub: string; sid: string; amr: string[]; email: string }

export interface SigningKey { kid: string; privateKey: CryptoKey; publicJwk: JWK }

export async function newSigningKey(kid = `k${Date.now()}`): Promise<{ key: SigningKey; privateJwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA', use: 'sig' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: 'EdDSA' };
  return { key: { kid, privateKey, publicJwk }, privateJwk };
}
/** โหลดคีย์จาก env (JSON ของ private JWK) */
export async function loadSigningKey(privateJwk: JWK): Promise<SigningKey> {
  if (!privateJwk.kid) throw new Error('JWK ต้องมี kid');
  const privateKey = (await importJWK(privateJwk, 'EdDSA')) as CryptoKey;
  const { d: _d, ...pub } = privateJwk;
  return { kid: privateJwk.kid, privateKey, publicJwk: { ...pub, use: 'sig' } };
}

export function signAccess(key: SigningKey, c: { sub: string; sid: string; amr: string[]; email: string }, audience: string[], nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ sid: c.sid, amr: c.amr, email: c.email })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid }).setSubject(c.sub).setIssuer(ISSUER).setAudience(audience)
    .setIssuedAt(nowS).setExpirationTime(nowS + ACCESS_TTL_S).sign(key.privateKey);
}

type KeyInput = Parameters<typeof jwtVerify>[1];
export async function verifyAccess(token: string, keys: KeyInput, audience: string, currentDate?: Date): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keys, { issuer: ISSUER, audience, algorithms: ['EdDSA'], ...(currentDate ? { currentDate } : {}) });
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('token ไม่ครบ');
  return payload as AccessClaims;
}
