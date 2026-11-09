import { describe, expect, it } from 'vitest';
import {
  base32Decode, base32Encode, bindingOf, can, checkPassword, countsSeat, decrypt, diffFromRole, effectivePermissions, encrypt, formatSecret, generateBackupCodes,
  generateSecret, hashBackupCode, hashPassword, hotp, ledgerRole, loadSigningKey, matchBackupCode, needsRehash, newSigningKey, numericCode, otpauthUri, randomToken,
  safeEqual, sha256, sign, signAccess, stepAt, totpAt, unsign, verifyAccess, verifyPassword, verifyTotp, ROLE_DEFAULTS, ISSUE_TEXT,
} from '../src/index.ts';
import { createLocalJWKSet } from 'jose';
import { randomBytes } from 'node:crypto';

describe('TOTP (RFC 6238 ภาคผนวก B · SHA-1)', () => {
  const key = Buffer.from('12345678901234567890');
  it.each([[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']])('T=%i → %s', (t, code) => {
    expect(hotp(key, BigInt(Math.floor(t / 30)), 8)).toBe(code);
  });
  it('base32 ไป–กลับ · จัดกลุ่ม 4 ตัว · คีย์ผิดรูป', () => {
    expect(base32Encode(key)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq=').equals(key)).toBe(true);
    expect(formatSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(() => base32Decode('A1')).toThrow();
    expect(base32Encode(Buffer.from([0xff]))).toBe('74');
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/u);
  });
  it('ตรวจรหัส: ±1 ช่วง · ห้ามใช้ช่วงเดิมซ้ำ · รูปแบบผิด', () => {
    const s = generateSecret();
    const t = 1_800_000_000_000;
    const code = totpAt(s, t);
    const step = verifyTotp(s, code, t);
    expect(step).toBe(stepAt(t));
    expect(verifyTotp(s, totpAt(s, t - 30_000), t)).toBe(stepAt(t) - 1);
    expect(verifyTotp(s, totpAt(s, t - 90_000), t)).toBeNull();
    expect(verifyTotp(s, code, t, step)).toBeNull(); // ใช้ซ้ำ
    expect(verifyTotp(s, '12345', t)).toBeNull();
    expect(otpauthUri(s, 'wei@innovera.co.th')).toBe(`otpauth://totp/Innovera%20ID%3Awei%40innovera.co.th?secret=${s}&issuer=Innovera%20ID&algorithm=SHA1&digits=6&period=30`);
  });
});

describe('รหัสผ่าน', () => {
  it('Argon2id ตามพารามิเตอร์ OWASP · ตรวจถูก/ผิด · hash ว่าง/เสีย', async () => {
    const h = await hashPassword('ม้าลายกินหญ้า-2569');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$x')).toBe(true);
    expect(await verifyPassword(h, 'ม้าลายกินหญ้า-2569')).toBe(true);
    expect(await verifyPassword(h, 'ผิด')).toBe(false);
    expect(await verifyPassword(null, 'x')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
  it('นโยบาย: ≥ 12 ตัว · รั่วไหล · มีอีเมล · ยืนยันไม่ตรง · ห้ามซ้ำ 5 รหัสล่าสุด', async () => {
    expect(await checkPassword('สั้นไป')).toEqual(['too_short']);
    expect(await checkPassword('password1234')).toEqual(['breached']);
    expect(await checkPassword('aaaaaaaaaaaaaa')).toEqual(['breached']);
    expect(await checkPassword('wei.innovera-secret-9', { email: 'wei.innovera@x.co' })).toEqual(['contains_identity']);
    expect(await checkPassword('ยาวพอแล้วนะครับ12', { confirm: 'อื่น' })).toEqual(['mismatch']);
    const old = await hashPassword('รหัสเก่าที่เคยใช้-01');
    expect(await checkPassword('รหัสเก่าที่เคยใช้-01', { history: [old] })).toEqual(['reused']);
    expect(await checkPassword('รหัสใหม่ที่ไม่ซ้ำ-02', { history: [old], email: 'a@b.c' })).toEqual([]);
    expect(ISSUE_TEXT.too_short).toBe('อย่างน้อย 12 ตัวอักษร');
  });
});

describe('รหัสสำรอง', () => {
  it('10 ชุด รูปแบบ xxxx-xxxx · ตรงได้ครั้งเดียวเมื่อถูกลบ hash · รูปแบบผิด', async () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/u);
    const hashes: (string | null)[] = await Promise.all(codes.slice(0, 3).map(hashBackupCode));
    expect(await matchBackupCode(` ${codes[1]!.toUpperCase()} `, hashes)).toBe(1);
    hashes[1] = null;
    expect(await matchBackupCode(codes[1]!, hashes)).toBe(-1);
    expect(await matchBackupCode('ไม่ใช่รหัส', hashes)).toBe(-1);
  });
});

describe('token · HMAC · เข้ารหัส', () => {
  it('token/hash/ตัวเลข', () => {
    expect(randomToken()).toMatch(/^[\w-]{43}$/u);
    expect(sha256('a')).toHaveLength(64);
    expect(numericCode()).toMatch(/^\d{6}$/u);
    expect(safeEqual('ab', 'ab')).toBe(true);
    expect(safeEqual('ab', 'abc')).toBe(false);
    expect(bindingOf('1.2.3.4', 'ua')).toHaveLength(16);
  });
  it('ลงนามและตรวจ · ถูกแก้ = null', () => {
    const s = sign('user:1', 'k');
    expect(unsign(s, 'k')).toBe('user:1');
    expect(unsign(`${s}x`, 'k')).toBeNull();
    expect(unsign(s, 'k2')).toBeNull();
    expect(unsign('nodot', 'k')).toBeNull();
  });
  it('AES-256-GCM ไป–กลับ · คีย์ผิดขนาด · ข้อมูลถูกแก้', () => {
    const k = randomBytes(32).toString('base64');
    const e = encrypt('JBSWY3DPEHPK3PXP', k);
    expect(decrypt(e, k)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => encrypt('x', 'c2hvcnQ=')).toThrow(/32 byte/u);
    expect(() => decrypt('v2.a.b.c', k)).toThrow();
    const parts = e.split('.');
    expect(() => decrypt([parts[0], parts[1], parts[2], Buffer.from('zz').toString('base64url')].join('.'), k)).toThrow();
  });
});

describe('JWT EdDSA', () => {
  it('ลงนาม/ตรวจ · audience · หมดอายุ · โหลดคีย์จาก JWK', async () => {
    const { key, privateJwk } = await newSigningKey('k1');
    const jwks = createLocalJWKSet({ keys: [key.publicJwk] });
    const t = await signAccess(key, { sub: 'u1', sid: 's1', amr: ['pwd', 'otp'], email: 'a@b.c' }, ['accounting']);
    expect(await verifyAccess(t, jwks, 'accounting')).toMatchObject({ sub: 'u1', sid: 's1', amr: ['pwd', 'otp'] });
    await expect(verifyAccess(t, jwks, 'tms')).rejects.toThrow();
    await expect(verifyAccess(t, jwks, 'accounting', new Date(Date.now() + 16 * 60_000))).rejects.toThrow();
    const loaded = await loadSigningKey(privateJwk);
    expect(loaded.publicJwk).not.toHaveProperty('d');
    const t2 = await signAccess(loaded, { sub: 'u2', sid: 's2', amr: ['pwd'], email: 'x@y.z' }, ['accounting']);
    expect((await verifyAccess(t2, jwks, 'accounting')).sub).toBe('u2');
    await expect(loadSigningKey({ ...privateJwk, kid: undefined })).rejects.toThrow(/kid/u);
  });
});

describe('บทบาทและสิทธิ์ (ScreenUsers / ScreenUserEdit)', () => {
  it('เมทริกซ์ย่อตามแบบร่าง', () => {
    const p = (r: keyof typeof ROLE_DEFAULTS) => effectivePermissions(r);
    expect(['owner', 'accounting_manager', 'accountant', 'ar_clerk', 'viewer', 'auditor'].map((r) => can(p(r as 'owner'), 'sales', 'write'))).toEqual([true, true, true, true, false, false]);
    expect(['owner', 'accounting_manager', 'accountant', 'ar_clerk', 'viewer', 'auditor'].map((r) => can(p(r as 'owner'), 'purchase', 'write'))).toEqual([true, true, true, false, false, false]);
    expect(['owner', 'accounting_manager', 'accountant'].map((r) => can(p(r as 'owner'), 'approve_pay', 'post'))).toEqual([true, true, false]);
    expect(['owner', 'accounting_manager', 'accountant'].map((r) => can(p(r as 'owner'), 'void', 'post'))).toEqual([true, true, false]);
    expect(['viewer', 'auditor', 'ar_clerk'].every((r) => can(p(r as 'owner'), 'reports', 'read'))).toBe(true);
    expect(can(p('accounting_manager'), 'settings', 'write')).toBe(true);
    expect(can(p('accountant'), 'settings', 'read')).toBe(false);
  });
  it('ปรับรายคน + สรุปการเปลี่ยนแปลง (ScreenUserEdit: + ผ่านรายการ IV)', () => {
    const p = effectivePermissions('ar_clerk', { sales: { post: true } });
    expect(can(p, 'sales', 'post')).toBe(true);
    expect(diffFromRole('ar_clerk', p)).toEqual({ added: ['sales.post'], removed: [] });
    expect(diffFromRole('accountant', effectivePermissions('accountant', { sales: { write: false } }))).toEqual({ added: [], removed: ['sales.write'] });
    expect(can(effectivePermissions('custom'), 'sales', 'read')).toBe(false);
    expect(can(effectivePermissions('custom', { reports: { read: true } }), 'reports', 'read')).toBe(true);
  });
  it('บทบาทลงบัญชี · ที่นั่ง', () => {
    expect(['owner', 'accounting_manager', 'accountant', 'viewer'].map((r) => ledgerRole(r as 'owner'))).toEqual(['owner', 'accounting_manager', 'accountant', null]);
    expect(countsSeat('guest')).toBe(false);
    expect(countsSeat('member')).toBe(true);
  });
});
