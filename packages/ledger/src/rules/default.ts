// สูตรลงบัญชีตั้งต้น (ธุรกิจบริการ จด VAT) · เป็นข้อมูล — บริษัทแก้ได้ (version ใหม่) · ADR-002
// TODO(Wei) T3: golden 1 (PLAN) ให้ Service[IV] เครดิต 4100200 แต่บรรทัด IV2611-0052 ใน fixtures/แบบร่างระบุ 4100100
//   → Service[IV] ใช้บัญชีรายได้ของสูตร (4100200) ไม่อ่านจากบรรทัด จนกว่า Wei ยืนยัน
import type { RuleDefinition } from '../engine.ts';

const AR = { from: ['contact.ar'], default: '1130100' } as const;
const AP = { from: ['contact.ap'], default: '2110100' } as const;
const CASH = { from: ['input.cash'] } as const; // บัญชีเงินที่เลือกในเอกสาร (ธนาคาร/เงินสด/เช็ครับ) — ไม่มีค่าตั้งต้น ห้ามเดา

export const DEFAULT_RULES: readonly RuleDefinition[] = [
  {
    code: 'Service[IV]', docType: 'IV', name: 'บริการ (VAT เมื่อรับเงิน)', book: 'SJ', settlement: 'open',
    lines: [
      { side: 'Dr', account: AR, amount: 'grand_total' },
      { side: 'Dr', account: { default: '2140100' }, amount: 'deposit', memo: 'หักเงินมัดจำรับ (ScreenDeposit)' },
      { side: 'Cr', account: { default: '4100200' }, amount: 'net' },
      { side: 'Cr', account: { default: '2150400' }, amount: 'vat', memo: 'ภาษีขายยังไม่ถึงกำหนด' },
    ],
  },
  {
    // ลำดับบรรทัดตาม ScreenFormula · TODO(Wei) T2: แบบร่างใช้ 1154200 เป็นภาษีถูกหัก แต่ fixtures/ผังบัญชีใช้ 1160100
    // บรรทัด wht ใช้เฉพาะบริษัทที่ตั้ง wht_recognition = on_invoice (ค่าตั้งต้นของระบบคือรับรู้ตอนรับเงิน) — ไม่มียอด = ไม่สร้างบรรทัด
    code: 'Credit[IV]', docType: 'IV', name: 'ขายเชื่อ', book: 'SJ', settlement: 'open',
    lines: [
      { side: 'Dr', account: AR, amount: 'grand_total' },
      { side: 'Dr', account: { default: '2140100' }, amount: 'deposit', memo: 'หักเงินมัดจำรับ (ScreenDeposit)' },
      { side: 'Dr', account: { default: '1160100' }, amount: 'wht' },
      { side: 'Cr', account: { from: ['line', 'product'], default: '4100100' }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '4190100' }, amount: 'discount' },
      { side: 'Cr', account: { default: '2150100' }, amount: 'vat' },
    ],
  },
  {
    code: 'Cash[IV]', docType: 'IV', name: 'ขายสด', book: 'SJ', settlement: 'paid',
    lines: [
      { side: 'Dr', account: CASH, amount: 'grand_total' },
      { side: 'Cr', account: { from: ['line', 'product'], default: '4100100' }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '4190100' }, amount: 'discount' },
      { side: 'Cr', account: { default: '2150100' }, amount: 'vat' },
    ],
  },
  {
    code: 'CN[ref IV]', docType: 'CN', name: 'ลดหนี้อ้างใบกำกับ (ม.86/10)', book: 'SJ',
    lines: [
      { side: 'Dr', account: { from: ['line', 'product'], default: '4100100' }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '2150100' }, amount: 'vat' },
      { side: 'Cr', account: AR, amount: 'grand_total' },
    ],
  },
  {
    code: 'CN[no-ref]', docType: 'CN', name: 'ลดหนี้ไม่อ้างใบกำกับ', book: 'SJ',
    lines: [
      { side: 'Dr', account: { from: ['line', 'product'], default: '4100100' }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '2150100' }, amount: 'vat' },
      { side: 'Cr', account: AR, amount: 'grand_total' },
    ],
  },
  {
    // ใบเพิ่มหนี้ (ม.86/9) — ภาษีขายรวมในเดือนที่ออกใบเพิ่มหนี้ (ม.82/9) · fixtures DN2612-0001
    code: 'DN[ref IV]', docType: 'DN', name: 'เพิ่มหนี้อ้างใบกำกับ (ม.86/9)', book: 'SJ', settlement: 'open',
    lines: [
      { side: 'Dr', account: AR, amount: 'grand_total' },
      { side: 'Cr', account: { from: ['line', 'product'], default: '4100100' }, amount: 'line.amount', perLine: true },
      { side: 'Cr', account: { default: '2150100' }, amount: 'vat' },
    ],
  },
  {
    // รับเงินมัดจำ: จุดภาษีเกิดเมื่อรับเงิน · fixtures DP2610-0006 receive_journal
    code: 'Deposit[DP]', docType: 'DP', name: 'รับเงินมัดจำ', book: 'RJ', settlement: 'paid',
    lines: [
      { side: 'Dr', account: CASH, amount: 'grand_total' },
      { side: 'Cr', account: { default: '2140100' }, amount: 'net' },
      { side: 'Cr', account: { default: '2150100' }, amount: 'vat' },
    ],
  },
  {
    code: 'Receive[RV]', docType: 'RV', name: 'รับชำระ (โอนภาษีขายที่ถึงกำหนด)', book: 'RJ',
    lines: [
      { side: 'Dr', account: CASH, amount: 'cash_in' },
      { side: 'Dr', account: { default: '1160100' }, amount: 'wht', memo: 'ตามหนังสือรับรอง 50 ทวิ ของลูกค้า' },
      { side: 'Dr', account: { from: ['input.fee'], default: '5401100' }, amount: 'fee', memo: 'ค่าธรรมเนียม/ส่วนต่าง (ScreenReceipt เลือกบัญชีได้)' },
      { side: 'Dr', account: { default: '2150400' }, amount: 'vat_due' },
      { side: 'Cr', account: AR, amount: 'settled' },
      { side: 'Cr', account: { default: '2150100' }, amount: 'vat_due' },
    ],
  },
  {
    code: 'Credit[AP]', docType: 'AP', name: 'ซื้อเชื่อ', book: 'PJ', settlement: 'open',
    lines: [
      { side: 'Dr', account: { from: ['line', 'product'] }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '1170100' }, amount: 'vat' },
      { side: 'Cr', account: AP, amount: 'grand_total' },
    ],
  },
  {
    code: 'Cash[EXP]', docType: 'EXP', name: 'จ่ายทันที', book: 'PV', settlement: 'paid',
    lines: [
      { side: 'Dr', account: { from: ['line', 'product'] }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '1170100' }, amount: 'vat' },
      { side: 'Cr', account: CASH, amount: 'paid' },
      { side: 'Cr', account: { default: '2150300' }, amount: 'wht' },
    ],
  },
  {
    // ค่าใช้จ่ายที่ยังไม่จ่าย (ตั้งเจ้าหนี้) — หัก ณ ที่จ่ายตอนจ่ายจริงใน PV
    code: 'Credit[EXP]', docType: 'EXP', name: 'ค่าใช้จ่ายตั้งหนี้', book: 'PJ', settlement: 'open',
    lines: [
      { side: 'Dr', account: { from: ['line', 'product'] }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '1170100' }, amount: 'vat' },
      { side: 'Cr', account: AP, amount: 'grand_total' },
    ],
  },
  {
    code: 'Pay[PV]', docType: 'PV', name: 'จ่ายชำระ + หัก ณ ที่จ่าย', book: 'PV',
    lines: [
      { side: 'Dr', account: AP, amount: 'settled' },
      { side: 'Cr', account: CASH, amount: 'paid' },
      { side: 'Cr', account: { default: '2150300' }, amount: 'wht' },
    ],
  },
  {
    code: 'CNR', docType: 'CNR', name: 'ใบลดหนี้ซื้อ (กลับภาษีซื้อ)', book: 'PJ',
    lines: [
      { side: 'Dr', account: AP, amount: 'grand_total' },
      { side: 'Cr', account: { from: ['line', 'product'] }, amount: 'line.amount', perLine: true },
      { side: 'Cr', account: { default: '1170100' }, amount: 'vat' },
    ],
  },
  {
    // ScreenPurchaseCreditNote "CNR[Credit] ตั้งเครดิตผู้ขาย": บิลเดิมจ่ายแล้ว (ลดหนี้เกินยอดค้าง) — บรรทัดเหมือน CNR
    // ส่วนที่เกินยอดค้างคงเป็นยอดเดบิตของผู้ขายในบัญชีเจ้าหนี้ (เครดิตคงเหลือ) ใช้หักในการจ่ายครั้งถัดไป
    code: 'CNR[Credit]', docType: 'CNR', name: 'ใบลดหนี้ซื้อ — ตั้งเครดิตผู้ขาย', book: 'PJ',
    lines: [
      { side: 'Dr', account: AP, amount: 'grand_total' },
      { side: 'Cr', account: { from: ['line', 'product'] }, amount: 'line.amount', perLine: true },
      { side: 'Cr', account: { default: '1170100' }, amount: 'vat' },
    ],
  },
  {
    code: 'DNR', docType: 'DNR', name: 'ใบเพิ่มหนี้ซื้อ (ภาษีซื้อเพิ่ม)', book: 'PJ',
    lines: [
      { side: 'Dr', account: { from: ['line', 'product'] }, amount: 'line.amount', perLine: true },
      { side: 'Dr', account: { default: '1170100' }, amount: 'vat' },
      { side: 'Cr', account: AP, amount: 'grand_total' },
    ],
  },
];

/**
 * สูตรของโมดูลสินค้าคงคลัง (Phase 2A INV · เปิดต่อบริษัท) — แยกจาก DEFAULT_RULES เพื่อไม่ให้รายการสูตรของบริษัทที่ไม่เปิดโมดูลเปลี่ยน
 * line.value = มูลค่าตามต้นทุนถัวเฉลี่ยของบรรทัด (ค่าบวก) · บัญชีจาก product = บัญชีสินค้าคงเหลือของสินค้า · จาก line = บัญชีคู่ (ต้นทุนขาย/ค่าใช้จ่าย/ผลต่าง)
 * TODO(Wei): บัญชีและวิธีลง (perpetual/periodic) เป็นค่าตั้ง "รอผู้สอบบัญชี" — inventory.method ค่าตั้งต้นชั่วคราว periodic
 */
export const INVENTORY_RULES: readonly RuleDefinition[] = [
  {
    // ใบรับสินค้า (FR-PU-09): รับของก่อนได้บิล → สินค้ารับแล้วรอใบแจ้งหนี้ (GR/IR) · บิลซื้อที่อ้าง GR ล้าง 2130100
    code: 'Stock[GR]', docType: 'GR', name: 'รับสินค้า (GR/IR)', book: 'GJ',
    lines: [
      { side: 'Dr', account: { from: ['product'], default: '1200100' }, amount: 'line.value', perLine: true },
      { side: 'Cr', account: { default: '2130100' }, amount: 'total', memo: 'สินค้ารับแล้วรอใบแจ้งหนี้' },
    ],
  },
  {
    code: 'Stock[GI]', docType: 'GI', name: 'เบิกใช้สินค้า', book: 'GJ',
    lines: [
      { side: 'Dr', account: { from: ['line'], default: '5020100' }, amount: 'line.value', perLine: true },
      { side: 'Cr', account: { from: ['product'], default: '1200100' }, amount: 'line.value', perLine: true },
    ],
  },
  {
    code: 'Stock[ADJ]', docType: 'ADJ', name: 'ปรับยอด/ตรวจนับสินค้า', book: 'GJ',
    lines: [
      { side: 'Dr', account: { from: ['product'], default: '1200100' }, amount: 'line.gain', perLine: true },
      { side: 'Cr', account: { from: ['line'], default: '5020900' }, amount: 'line.gain', perLine: true },
      { side: 'Dr', account: { from: ['line'], default: '5020900' }, amount: 'line.loss', perLine: true },
      { side: 'Cr', account: { from: ['product'], default: '1200100' }, amount: 'line.loss', perLine: true },
    ],
  },
  {
    // perpetual: ตัดต้นทุนทุกการขาย (บรรทัดเพิ่มใน journal ของใบขาย)
    code: 'Stock[COGS]', docType: 'COGS', name: 'ต้นทุนขาย (perpetual)', book: 'SJ',
    lines: [
      { side: 'Dr', account: { from: ['line'], default: '5020100' }, amount: 'line.value', perLine: true },
      { side: 'Cr', account: { from: ['product'], default: '1200100' }, amount: 'line.value', perLine: true },
    ],
  },
];

export function ruleByCode(code: string): RuleDefinition {
  const r = DEFAULT_RULES.find((x) => x.code === code);
  if (!r) throw new Error(`ไม่พบสูตร ${code}`);
  return r;
}
