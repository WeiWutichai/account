// ประเภทเงินได้และอัตราหัก ณ ที่จ่าย (ประกาศอธิบดีฯ ท.ป.4/2528) — ตรวจกับ fixtures wht_rates ใน golden test
// freelance_software_dev = รอผู้สอบบัญชี (CLAUDE.md): อัตรา/วิธีจริงอ่านจากค่าตั้งของบริษัท tax.wht.freelance_software_dev
import type { WhtType } from './index.ts';

export const WHT_TYPES: Readonly<Record<string, WhtType & { label: string; section?: string }>> = {
  transport_domestic: { key: 'transport_domestic', rate: '0.01', pnd: '53', label: 'ค่าขนส่ง' },
  advertising: { key: 'advertising', rate: '0.02', pnd: '53', label: 'ค่าโฆษณา' },
  service: { key: 'service', rate: '0.03', pnd: '3|53', label: 'ค่าบริการ' },
  hire_of_work: { key: 'hire_of_work', rate: '0.03', pnd: '3|53', label: 'ค่าจ้างทำของ' },
  professional: { key: 'professional', rate: '0.03', pnd: '3|53', label: 'ค่าวิชาชีพอิสระ' },
  rent: { key: 'rent', rate: '0.05', pnd: '3|53', label: 'ค่าเช่า' },
  freelance_software_dev: { key: 'freelance_software_dev', rate: '0.03', pnd: '3|53', label: 'ค่าจ้างพัฒนาซอฟต์แวร์ (ฟรีแลนซ์)', section: '40(2)', method: 'flat', status: 'PENDING_AUDITOR' },
};

/** ค่าตั้งของบริษัทสำหรับฟรีแลนซ์ (CLAUDE.md: { income_type: "40(2)"|"40(8)", method: "flat"|"progressive", rate? }) · ค่าตั้งต้นชั่วคราว = 40(2) หักคงที่ 3% */
export interface FreelanceWhtConfig { income_type: '40(2)' | '40(8)'; method: 'flat' | 'progressive'; rate?: string }
export const FREELANCE_DEFAULT: FreelanceWhtConfig = { income_type: '40(2)', method: 'flat', rate: '0.03' };

export function whtTypeFor(key: string, freelance: FreelanceWhtConfig = FREELANCE_DEFAULT): WhtType & { label: string; section?: string } {
  const t = WHT_TYPES[key];
  if (!t) throw new Error(`ไม่รู้จักประเภทเงินได้ ${key}`);
  if (key !== 'freelance_software_dev') return t;
  return { ...t, rate: freelance.rate ?? t.rate, method: freelance.method, section: freelance.income_type, status: 'PENDING_AUDITOR' };
}
/** ภ.ง.ด.3 = บุคคลธรรมดา · ภ.ง.ด.53 = นิติบุคคล (เลขผู้เสียภาษีนิติบุคคลขึ้นต้นด้วย 0) */
export const pndOf = (taxId: string | null | undefined): '3' | '53' => (taxId && taxId.startsWith('0') ? '53' : '3');
