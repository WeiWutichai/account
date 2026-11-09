// ตรวจสมดุลของสูตร (ScreenFormula "ตรวจสมดุล ... ✓ · น้ำหนัก Dr = Cr ✓") ด้วยยอดตัวอย่างที่สอดคล้องกันตามประเภทเอกสาร
import { post, type PostingInput, type RuleDefinition } from '@innovera/ledger';

const SAMPLE: Record<string, PostingInput> = {
  IV: { docType: 'IV', amounts: { grand_total: '1070.00', net: '1000.00', vat: '70.00' }, lines: [{ amounts: { amount: '1000.00' } }], accounts: { cash: '1100100' } },
  CN: { docType: 'CN', amounts: { grand_total: '107.00', vat: '7.00' }, lines: [{ amounts: { amount: '100.00' } }] },
  RV: { docType: 'RV', amounts: { cash_in: '1037.90', wht: '32.10', fee: '0.00', vat_due: '70.00', settled: '1070.00' }, accounts: { cash: '1100100' } },
  AP: { docType: 'AP', amounts: { grand_total: '1070.00', vat: '70.00' }, lines: [{ account: '5301200', amounts: { amount: '1000.00' } }] },
  EXP: { docType: 'EXP', amounts: { paid: '1040.00', wht: '30.00', vat: '70.00' }, lines: [{ account: '5301200', amounts: { amount: '1000.00' } }], accounts: { cash: '1100100' } },
  PV: { docType: 'PV', amounts: { settled: '1070.00', paid: '1040.00', wht: '30.00' }, accounts: { cash: '1100100' } },
  CNR: { docType: 'CNR', amounts: { grand_total: '107.00', vat: '7.00' }, lines: [{ account: '5301200', amounts: { amount: '100.00' } }] },
};
const KEY: Record<string, string> = { 'line.amount': 'total', net: 'total' };

export function ruleCheck(rule: RuleDefinition): { ok: boolean; equation: string; message: string } {
  const side = (s: 'Dr' | 'Cr') => [...new Set(rule.lines.filter((l) => l.side === s).map((l) => KEY[l.amount] ?? l.amount))];
  const equation = `${side('Dr').join(' + ')} = ${side('Cr').join(' + ')}`;
  const sample = SAMPLE[rule.docType];
  if (!sample) return { ok: false, equation, message: `ยังไม่มีชุดตรวจสำหรับเอกสาร ${rule.docType}` };
  try {
    post(rule, sample);
    return { ok: true, equation, message: '' };
  } catch (e) {
    return { ok: false, equation, message: (e as Error).message };
  }
}
