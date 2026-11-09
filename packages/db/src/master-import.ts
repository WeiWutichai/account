// นำเข้า Excel ของข้อมูลหลัก (ScreenContacts / ScreenProducts ปุ่ม "นำเข้า Excel")
// ตรวจทั้งไฟล์ด้วยกติกาเดียวกับ saveContact / saveProduct (contactValues / productValues) · ตรวจอย่างเดียว (dry-run) หรือบันทึกทั้งชุด
// ผิดแม้แถวเดียว → ไม่บันทึกเลย · รหัสที่มีอยู่แล้ว = แก้ไข (เฉพาะช่องที่กรอก — ช่องว่างคงค่าเดิม)
import ExcelJS from 'exceljs';
import type { CompanyTx, Db } from './index.ts';
import { LedgerError } from './ledger-service.ts';
import {
  contactInputOf, contactValues, productValues, saveContactTx, saveProductTx, type ContactInput, type ContactRole, type ProductInput,
} from './master.ts';

export type MasterKind = 'contacts' | 'products';

export const MASTER_TEMPLATE: Record<MasterKind, readonly string[]> = {
  contacts: ['รหัส', 'ชื่อ', 'บทบาท', 'ประเภทบุคคล', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'ผู้ติดต่อ', 'โทรศัพท์', 'อีเมล', 'เครดิต (วัน)', 'วงเงินเครดิต', 'WHT ตั้งต้น', 'บัญชีธนาคาร'],
  products: ['รหัส', 'ชื่อ', 'ประเภท', 'หน่วย', 'ราคา 1', 'ราคา 2', 'ราคา 3', 'ราคา 4', 'ราคา 5', 'รหัสภาษี', 'เหตุยกเว้น VAT', 'ต้นทุนประมาณ', 'บัญชีรายได้', 'บัญชีค่าใช้จ่าย', 'SKU'],
};
/** แถวตัวอย่างในไฟล์แม่แบบ (ข้อมูลจาก fixtures/sample-company.json) */
const SAMPLE: Record<MasterKind, string[]> = {
  contacts: ['C0012', '[ลูกค้า A] จำกัด', 'ลูกค้า', 'นิติบุคคล', '', '00000', '', '', '', '', '30', '500000.00', '', ''],
  products: ['S-0001', 'พัฒนาซอฟต์แวร์', 'บริการ', 'ชั่วโมง', '1500.00', '1200.00', '', '', '', 'VAT 7%', '', '800.00', '4100100', '', ''],
};

const ROLE: Record<string, ContactRole> = { ลูกค้า: 'customer', ผู้ขาย: 'vendor', ผู้รับเหมา: 'contractor', พนักงาน: 'employee', customer: 'customer', vendor: 'vendor', contractor: 'contractor', employee: 'employee' };
const ENTITY: Record<string, 'juristic' | 'individual' | 'foreign'> = { นิติบุคคล: 'juristic', บุคคลธรรมดา: 'individual', ต่างประเทศ: 'foreign', juristic: 'juristic', individual: 'individual', foreign: 'foreign' };
const KIND: Record<string, ProductInput['kind']> = { บริการ: 'service', สินค้า: 'goods', ค่าใช้จ่าย: 'expense', service: 'service', goods: 'goods', expense: 'expense' };
const VAT: Record<string, 'vat7' | 'exempt' | 'zero'> = { 'VAT 7%': 'vat7', '7%': 'vat7', ยกเว้น: 'exempt', '0%': 'zero', vat7: 'vat7', exempt: 'exempt', zero: 'zero' };

export interface MasterImportRow { row: number; code: string; name: string; action: 'create' | 'update' }
export interface MasterImportIssue { row: number; message: string }
export interface MasterImportResult { ok: boolean; committed: boolean; rows: MasterImportRow[]; issues: MasterImportIssue[] }

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'result' in v) return cellText(v.result as ExcelJS.CellValue);
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('').trim();
  return '';
}

export async function masterTemplate(kind: MasterKind): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'contacts' ? 'คู่ค้า' : 'สินค้า');
  ws.addRow([...MASTER_TEMPLATE[kind]]);
  ws.addRow(SAMPLE[kind]);
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ชีตแรกของไฟล์ · แถว 1 = หัวคอลัมน์ตามแม่แบบ */
async function readRows(kind: MasterKind, buf: Buffer): Promise<{ rows: Record<string, string>[]; issues: MasterImportIssue[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { rows: [], issues: [{ row: 0, message: 'อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx)' }] };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], issues: [{ row: 0, message: 'ไม่มีชีตในไฟล์' }] };
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
  const missing = MASTER_TEMPLATE[kind].slice(0, 3).filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], issues: [{ row: 1, message: `ไม่มีคอลัมน์ ${missing.join(', ')}` }] };
  const rows: Record<string, string>[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const vals = (r.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    if (vals.every((v) => v === '')) return;
    rows.push(Object.fromEntries([...header.map((h, i) => [h, vals[i] ?? '']), ['__row', String(n)]]));
  });
  if (!rows.length) return { rows, issues: [{ row: 0, message: 'ไม่มีข้อมูลในไฟล์' }] };
  return { rows, issues: [] };
}

const num = (s: string) => s.replace(/,/gu, '').trim();
/** ช่องที่กรอก (ไม่ว่าง) เท่านั้น — แถวที่แก้คู่ค้าเดิมคงค่าเดิมของช่องที่เว้นว่าง */
const filled = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const opt = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

function contactFromRow(r: Record<string, string>): Partial<ContactInput> {
  const roles = opt(r['บทบาท'])?.split(/[,/·]/u).map((x) => x.trim()).filter(Boolean);
  const mapped = roles?.map((x) => ROLE[x]);
  if (mapped?.some((x) => !x)) throw new LedgerError(`บทบาทไม่ถูกต้อง: "${r['บทบาท']}" (ลูกค้า / ผู้ขาย / ผู้รับเหมา / พนักงาน)`);
  const ent = opt(r['ประเภทบุคคล']);
  if (ent && !ENTITY[ent]) throw new LedgerError(`ประเภทบุคคลไม่ถูกต้อง: "${ent}"`);
  const days = opt(r['เครดิต (วัน)']);
  if (days && !/^\d+$/u.test(days)) throw new LedgerError(`เครดิต (วัน) ไม่ถูกต้อง: "${days}"`);
  const limit = opt(r['วงเงินเครดิต']);
  return filled({
    code: opt(r['รหัส']), name: opt(r['ชื่อ']), roles: mapped as ContactRole[] | undefined, entityType: ent ? ENTITY[ent] : undefined,
    taxId: opt(r['เลขผู้เสียภาษี']), branchCode: opt(r['สาขา']), address: opt(r['ที่อยู่']), contactPerson: opt(r['ผู้ติดต่อ']), phone: opt(r['โทรศัพท์']), email: opt(r['อีเมล']),
    creditDays: days ? Number(days) : undefined, creditLimit: limit ? num(limit) : undefined, defaultWht: opt(r['WHT ตั้งต้น']), bankAccount: opt(r['บัญชีธนาคาร']),
  });
}

function productFromRow(r: Record<string, string>, existing: ProductInput | null): ProductInput {
  const k = opt(r['ประเภท']);
  if (k && !KIND[k]) throw new LedgerError(`ประเภทไม่ถูกต้อง: "${k}" (บริการ / สินค้า / ค่าใช้จ่าย)`);
  const v = opt(r['รหัสภาษี']);
  if (v && !VAT[v]) throw new LedgerError(`รหัสภาษีไม่ถูกต้อง: "${v}" (VAT 7% / ยกเว้น / 0%)`);
  const prices = [1, 2, 3, 4, 5].map((i) => { const x = opt(r[`ราคา ${i}`]); return x ? num(x) : existing?.prices?.[i - 1] ?? null; });
  const est = opt(r['ต้นทุนประมาณ']);
  return {
    code: opt(r['รหัส']) ?? existing?.code ?? '', name: opt(r['ชื่อ']) ?? existing?.name ?? '', kind: k ? KIND[k]! : existing?.kind ?? 'service', unit: opt(r['หน่วย']) ?? existing?.unit ?? null,
    prices, vatCode: v ? VAT[v]! : existing?.vatCode ?? 'vat7', defaultWht: existing?.defaultWht ?? null, sku: opt(r['SKU']) ?? existing?.sku ?? null,
    revenueAccount: opt(r['บัญชีรายได้']) ?? existing?.revenueAccount ?? null, expenseAccount: opt(r['บัญชีค่าใช้จ่าย']) ?? existing?.expenseAccount ?? null,
    ...(est ? { estCost: num(est) } : {}), ...(opt(r['เหตุยกเว้น VAT']) ? { vatExemptReason: opt(r['เหตุยกเว้น VAT'])! } : {}),
  };
}

async function existingProducts(tx: CompanyTx) {
  const rows = await tx.selectFrom('acct.product').selectAll().execute();
  return new Map(rows.map((p) => [p.code, {
    code: p.code, name: p.name, kind: p.kind, unit: p.unit, prices: [p.price, p.price_2, p.price_3, p.price_4, p.price_5], vatCode: p.vat_code, defaultWht: p.default_wht, sku: p.sku,
    revenueAccount: p.revenue_account, expenseAccount: p.expense_account,
  } satisfies ProductInput]));
}

/** commit = false: ตรวจอย่างเดียว (แสดงผลก่อนนำเข้า) · commit = true: บันทึกทั้งชุดใน transaction เดียว (ไม่บันทึกถ้ามีข้อผิดพลาด) */
export async function importMaster(db: Db, companyId: string, actorId: string | null, kind: MasterKind, buf: Buffer, p: { commit: boolean }): Promise<MasterImportResult> {
  const read = await readRows(kind, buf);
  if (read.issues.length) return { ok: false, committed: false, rows: [], issues: read.issues };
  return db.withCompany(companyId, async (tx) => {
    const issues: MasterImportIssue[] = [];
    const rows: MasterImportRow[] = [];
    const seen = new Set<string>();
    const accounts = new Set((await tx.selectFrom('acct.account').select('code').execute()).map((a) => a.code));
    const contacts = kind === 'contacts' ? new Map((await tx.selectFrom('acct.contact').selectAll().execute()).map((c) => [c.code, c])) : new Map();
    const products = kind === 'products' ? await existingProducts(tx) : new Map<string, ProductInput>();
    const plan: (() => Promise<unknown>)[] = [];
    for (const r of read.rows) {
      const row = Number(r['__row']);
      const code = opt(r['รหัส']) ?? '';
      try {
        if (!code) throw new LedgerError('ไม่มีรหัส');
        if (seen.has(code)) throw new LedgerError(`รหัส ${code} ซ้ำในไฟล์`);
        seen.add(code);
        if (kind === 'contacts') {
          const old = contacts.get(code);
          const input = { ...(old ? contactInputOf(old) : { code, name: '', roles: [] }), ...contactFromRow(r) } as ContactInput;
          const values = contactValues(input);
          rows.push({ row, code, name: values.name, action: old ? 'update' : 'create' });
          plan.push(() => saveContactTx(tx, companyId, actorId, values, old?.id, 'contact.import'));
        } else {
          const old = products.get(code) ?? null;
          const values = productValues(productFromRow(r, old));
          for (const a of [values.revenue_account, values.expense_account]) if (a && !accounts.has(a)) throw new LedgerError(`ไม่มีบัญชี ${a} ในผังบัญชี`);
          rows.push({ row, code, name: values.name, action: old ? 'update' : 'create' });
          plan.push(() => saveProductTx(tx, companyId, actorId, values, old ? code : undefined, 'product.import'));
        }
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e;
        issues.push({ row, message: e.message });
      }
    }
    if (issues.length || !p.commit) return { ok: issues.length === 0, committed: false, rows, issues };
    for (const run of plan) await run();
    return { ok: true, committed: true, rows, issues };
  });
}
