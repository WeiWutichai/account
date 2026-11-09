// ภาษีหัก ณ ที่จ่าย "ที่คาดไว้" ของเอกสารที่ยังไม่ลงบัญชี — แสดงอย่างเดียว (หักจริงตอนจ่าย: approvePurchase/approvePayment ใน packages/db)
// วิธีเดียวกับ whtOnPayment ใน @innovera/tax-th: ฐานต่อประเภทเงินได้ × อัตรา ปัด 2 ตำแหน่ง (half-up) · BigInt ไม่ใช้ float
// TODO(backend): ไม่มี endpoint คำนวณ WHT ของร่างด้วยค่าตั้งบริษัท (tax.wht.freelance_software_dev) — GET /v1/wht-types ส่งค่าตั้งต้นของกฎหมาย
//                ถ้าบริษัทตั้งฟรีแลนซ์เป็น progressive ยอดที่นี่เป็นแค่ค่าตั้งต้นชั่วคราว (ป้าย "รอยืนยัน") · ตอนอนุมัติ backend หยุดเอง (PendingAuditorError)
import { divRound, fromCents, parseDec, toCents } from '../../sales/_lib/num.ts';
import type { WhtTypeDef } from './types.ts';

export interface WhtPreview { type: string; label: string; section: string | null; rate: string; base: string; amount: string; pendingAuditor: boolean }

/** lines: ยอดสุทธิต่อบรรทัด + ประเภทเงินได้ · minus: ยอดที่ลดฐาน (ใบลดหนี้ซื้อ) ตามบัญชี — ตรงกับ whtForBill */
export function expectedWht(lines: { amount: string; account: string | null; whtType: string | null }[], types: Record<string, WhtTypeDef>, minus: { amount: string; account: string | null }[] = []): WhtPreview[] {
  const base = new Map<string, bigint>();
  for (const l of lines) if (l.whtType && types[l.whtType]) base.set(l.whtType, (base.get(l.whtType) ?? 0n) + toCents(l.amount));
  for (const m of minus) {
    const hit = lines.find((l) => l.account === m.account && l.whtType && types[l.whtType]);
    if (hit) base.set(hit.whtType!, (base.get(hit.whtType!) ?? 0n) - toCents(m.amount));
  }
  return [...base].map(([type, b]) => {
    const t = types[type]!;
    const r = parseDec(t.rate, 6) ?? 0n;
    return { type, label: t.label, section: t.section ?? null, rate: t.rate, base: fromCents(b), amount: fromCents(divRound(b * r, 1_000_000n)), pendingAuditor: t.status === 'PENDING_AUDITOR' };
  });
}

export const sumWht = (xs: readonly { amount: string }[]): string => fromCents(xs.reduce((s, x) => s + toCents(x.amount), 0n));
