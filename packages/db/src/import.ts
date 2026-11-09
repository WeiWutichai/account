// นำเข้าจาก Excel (PLAN M2): ผังบัญชี · คู่ค้า · สินค้า · ยอดยกมา (งบทดลอง) · ลูกหนี้/เจ้าหนี้คงค้างรายใบ
// ตรวจทั้งไฟล์ก่อน — ผิดแม้แถวเดียวไม่นำเข้าเลย (คืนรายการข้อผิดพลาดพร้อมเลขแถว)
import ExcelJS from 'exceljs';
import { Money, type JournalLine } from '@innovera/ledger';
import type { AccountType, Db } from './index.ts';
import { postJournalTx } from './ledger-service.ts';

export const TEMPLATE = {
  ผังบัญชี: ['รหัสบัญชี', 'ชื่อบัญชี', 'ประเภท', 'บัญชีคุม'],
  คู่ค้า: ['รหัส', 'ชื่อ', 'ประเภท', 'เลขผู้เสียภาษี', 'สาขา'],
  สินค้า: ['รหัส', 'ชื่อ', 'ประเภท', 'หน่วย', 'ราคาขาย', 'VAT', 'บัญชีรายได้'],
  ยอดยกมา: ['รหัสบัญชี', 'เดบิต', 'เครดิต'],
  ลูกหนี้คงค้าง: ['รหัสคู่ค้า', 'เลขที่เอกสาร', 'วันที่', 'ครบกำหนด', 'ยอดคงค้าง'],
  เจ้าหนี้คงค้าง: ['รหัสคู่ค้า', 'เลขที่เอกสาร', 'วันที่', 'ครบกำหนด', 'ยอดคงค้าง'],
} as const;
type SheetName = keyof typeof TEMPLATE;
type Row = Record<string, string>;
export interface ImportIssue { sheet: string; row: number; message: string }

const TYPE_MAP: Record<string, AccountType> = { สินทรัพย์: 'asset', หนี้สิน: 'liability', ทุน: 'equity', รายได้: 'revenue', ค่าใช้จ่าย: 'expense',
  asset: 'asset', liability: 'liability', equity: 'equity', revenue: 'revenue', expense: 'expense', contra_asset: 'contra_asset', contra_revenue: 'contra_revenue' };
const KIND_MAP: Record<string, 'customer' | 'vendor' | 'both' | 'contractor'> = { ลูกค้า: 'customer', ผู้ขาย: 'vendor', ทั้งสอง: 'both', ผู้รับเหมา: 'contractor',
  customer: 'customer', vendor: 'vendor', both: 'both', contractor: 'contractor' };

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'result' in v) return cellText(v.result as ExcelJS.CellValue);
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('').trim();
  return String(v);
}

/** ตัวเลขจาก Excel เป็น string 2 ตำแหน่ง (Excel เก็บเป็น float — ปัดที่ 2 ตำแหน่ง ถ้าเกินถือว่าผิด) */
function money(raw: string): string | null {
  if (raw === '') return '0.00';
  const t = raw.replace(/,/gu, '');
  if (!/^-?\d+(\.\d+)?$/u.test(t)) return null;
  const [i, f = ''] = t.split('.');
  if (f.length > 2 && !/^0+$/u.test(f.slice(2)) && !/^9{6,}/u.test(f.slice(2)) && !/^0{6,}/u.test(f.slice(2))) return null;
  return Money.parse(`${i}.${(f + '00').slice(0, 2)}`).toString();
}

export async function readWorkbook(buf: ArrayBuffer | Buffer): Promise<{ sheets: Partial<Record<SheetName, Row[]>>; issues: ImportIssue[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const sheets: Partial<Record<SheetName, Row[]>> = {};
  const issues: ImportIssue[] = [];
  for (const name of Object.keys(TEMPLATE) as SheetName[]) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
    const missing = TEMPLATE[name].filter((h) => !header.includes(h));
    if (missing.length) { issues.push({ sheet: name, row: 1, message: `ไม่มีคอลัมน์ ${missing.join(', ')}` }); continue; }
    const rows: Row[] = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const vals = (r.values as ExcelJS.CellValue[]).slice(1).map(cellText);
      if (vals.every((v) => v === '')) return;
      rows.push(Object.fromEntries([...header.map((h, i) => [h, vals[i] ?? '']), ['__row', String(n)]]));
    });
    sheets[name] = rows;
  }
  return { sheets, issues };
}

export interface ImportPlan {
  accounts: { code: string; name: string; type: AccountType; control: 'ar' | 'ap' | null }[];
  contacts: { code: string; name: string; kind: 'customer' | 'vendor' | 'both' | 'contractor'; tax_id: string | null; branch: string | null }[];
  products: { code: string; name: string; kind: 'service' | 'goods'; unit: string | null; price: string | null; vat: boolean; revenue_account: string | null }[];
  opening: JournalLine[];
  openItems: { side: 'ar' | 'ap'; contact: string; doc_no: string; date: string; due: string | null; amount: string }[];
}

/** ตรวจทั้งไฟล์ · existing = รหัสที่มีอยู่แล้วในบริษัท (นำเข้าเพิ่มได้) */
export function validate(sheets: Partial<Record<SheetName, Row[]>>, existing: { accounts: Map<string, { control: string | null }>; contacts: Set<string> }): { plan: ImportPlan; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const bad = (sheet: string, r: Row, message: string) => issues.push({ sheet, row: Number(r['__row']), message });
  const plan: ImportPlan = { accounts: [], contacts: [], products: [], opening: [], openItems: [] };
  const accounts = new Map(existing.accounts);
  for (const r of sheets.ผังบัญชี ?? []) {
    const code = r['รหัสบัญชี']!, type = TYPE_MAP[r['ประเภท']!], ctl = r['บัญชีคุม'] === 'ลูกหนี้' || r['บัญชีคุม'] === 'ar' ? 'ar' : r['บัญชีคุม'] === 'เจ้าหนี้' || r['บัญชีคุม'] === 'ap' ? 'ap' : null;
    if (!/^\d{7}$/u.test(code)) bad('ผังบัญชี', r, `รหัสบัญชีต้องเป็นตัวเลข 7 หลัก: "${code}"`);
    else if (!type) bad('ผังบัญชี', r, `ประเภทไม่ถูกต้อง: "${r['ประเภท']}"`);
    else if (!r['ชื่อบัญชี']) bad('ผังบัญชี', r, 'ไม่มีชื่อบัญชี');
    else { plan.accounts.push({ code, name: r['ชื่อบัญชี']!, type, control: ctl }); accounts.set(code, { control: ctl }); }
  }
  const contacts = new Set(existing.contacts);
  for (const r of sheets.คู่ค้า ?? []) {
    const kind = KIND_MAP[r['ประเภท']!];
    const tax = r['เลขผู้เสียภาษี'] || null;
    if (!r['รหัส'] || !r['ชื่อ']) bad('คู่ค้า', r, 'ต้องมีรหัสและชื่อ');
    else if (!kind) bad('คู่ค้า', r, `ประเภทไม่ถูกต้อง: "${r['ประเภท']}"`);
    else if (tax && !/^\d{13}$/u.test(tax)) bad('คู่ค้า', r, `เลขผู้เสียภาษีต้องมี 13 หลัก: "${tax}"`);
    else { plan.contacts.push({ code: r['รหัส']!, name: r['ชื่อ']!, kind, tax_id: tax, branch: r['สาขา'] || null }); contacts.add(r['รหัส']!); }
  }
  for (const r of sheets.สินค้า ?? []) {
    const price = r['ราคาขาย'] ? money(r['ราคาขาย']) : null;
    const rev = r['บัญชีรายได้'] || null;
    if (!r['รหัส'] || !r['ชื่อ']) bad('สินค้า', r, 'ต้องมีรหัสและชื่อ');
    else if (r['ราคาขาย'] && price === null) bad('สินค้า', r, `ราคาไม่ถูกต้อง: "${r['ราคาขาย']}"`);
    else if (rev && !accounts.has(rev)) bad('สินค้า', r, `ไม่พบบัญชีรายได้ ${rev}`);
    else plan.products.push({ code: r['รหัส']!, name: r['ชื่อ']!, kind: r['ประเภท'] === 'สินค้า' || r['ประเภท'] === 'goods' ? 'goods' : 'service', unit: r['หน่วย'] || null,
      price, vat: !['ไม่มี', 'no', 'N', 'ยกเว้น'].includes(r['VAT'] ?? ''), revenue_account: rev });
  }
  for (const r of sheets.ยอดยกมา ?? []) {
    const acc = r['รหัสบัญชี']!, dr = money(r['เดบิต'] ?? ''), cr = money(r['เครดิต'] ?? '');
    if (!accounts.has(acc)) { bad('ยอดยกมา', r, `ไม่พบบัญชี ${acc}`); continue; }
    if (dr === null || cr === null) { bad('ยอดยกมา', r, 'ยอดเงินไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)'); continue; }
    const d = Money.of(dr), c = Money.of(cr);
    if (d.isNegative() || c.isNegative() || (!d.isZero() && !c.isZero())) { bad('ยอดยกมา', r, 'ใส่เดบิตหรือเครดิตอย่างใดอย่างหนึ่ง และห้ามติดลบ'); continue; }
    if (!d.isZero()) plan.opening.push({ side: 'Dr', account: acc, amount: d });
    if (!c.isZero()) plan.opening.push({ side: 'Cr', account: acc, amount: c });
  }
  for (const [sheet, side] of [['ลูกหนี้คงค้าง', 'ar'], ['เจ้าหนี้คงค้าง', 'ap']] as const) {
    for (const r of sheets[sheet] ?? []) {
      const amt = money(r['ยอดคงค้าง'] ?? '');
      if (!contacts.has(r['รหัสคู่ค้า']!)) bad(sheet, r, `ไม่พบคู่ค้า ${r['รหัสคู่ค้า']}`);
      else if (!r['เลขที่เอกสาร']) bad(sheet, r, 'ไม่มีเลขที่เอกสาร');
      else if (!/^\d{4}-\d{2}-\d{2}$/u.test(r['วันที่'] ?? '')) bad(sheet, r, `วันที่ไม่ถูกต้อง: "${r['วันที่']}"`);
      else if (amt === null || !Money.of(amt).gt(Money.zero())) bad(sheet, r, 'ยอดคงค้างต้องมากกว่า 0');
      else plan.openItems.push({ side, contact: r['รหัสคู่ค้า']!, doc_no: r['เลขที่เอกสาร']!, date: r['วันที่']!, due: r['ครบกำหนด'] || null, amount: amt });
    }
  }
  // ยอดยกมาต้องดุล และบัญชีคุมต้องเท่ากับผลรวมรายใบ
  if (plan.opening.length) {
    const dr = Money.sum(plan.opening.filter((l) => l.side === 'Dr').map((l) => l.amount));
    const cr = Money.sum(plan.opening.filter((l) => l.side === 'Cr').map((l) => l.amount));
    if (!dr.equals(cr)) issues.push({ sheet: 'ยอดยกมา', row: 0, message: `ยอดยกมาไม่ดุล: เดบิต ${dr.toString()} ≠ เครดิต ${cr.toString()}` });
    for (const kind of ['ar', 'ap'] as const) {
      const ctl = [...accounts].filter(([, a]) => a.control === kind).map(([c]) => c);
      const glBal = Money.sum(plan.opening.filter((l) => ctl.includes(l.account)).map((l) => (l.side === (kind === 'ar' ? 'Dr' : 'Cr') ? l.amount : l.amount.neg())));
      const items = Money.sum(plan.openItems.filter((i) => i.side === kind).map((i) => Money.of(i.amount)));
      if (!glBal.equals(items)) issues.push({ sheet: kind === 'ar' ? 'ลูกหนี้คงค้าง' : 'เจ้าหนี้คงค้าง', row: 0,
        message: `ผลรวมรายใบ ${items.toString()} ≠ ยอดบัญชีคุม ${glBal.toString()}` });
    }
  }
  return { plan, issues };
}

/** นำเข้าทั้งชุด: ข้อมูลหลักก่อน แล้วลงยอดยกมาเป็น journal เดียว (OB) · ไม่มีอะไรถูกบันทึกถ้าตรวจไม่ผ่าน */
export async function importWorkbook(db: Db, companyId: string, buf: ArrayBuffer | Buffer, p: { openingDate: string; role: 'owner' | 'accounting_manager' }) {
  const { sheets, issues: readIssues } = await readWorkbook(buf);
  if (readIssues.length) return { ok: false as const, issues: readIssues };
  const existing = await db.withCompany(companyId, async (tx) => ({
    accounts: new Map((await tx.selectFrom('acct.account').select(['code', 'control_kind']).execute()).map((a) => [a.code, { control: a.control_kind }])),
    contacts: new Set((await tx.selectFrom('acct.contact').select('code').execute()).map((c) => c.code)),
  }));
  const { plan, issues } = validate(sheets, existing);
  if (issues.length) return { ok: false as const, issues };
  const opening = await db.withCompany(companyId, async (tx) => {
    for (const a of plan.accounts) await tx.insertInto('acct.account').values({ company_id: companyId, code: a.code, name: a.name, type: a.type, parent_code: null,
      is_control: a.control !== null, control_kind: a.control, requires_contact: a.control !== null }).onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: a.name })).execute();
    for (const c of plan.contacts) await tx.insertInto('acct.contact').values({ company_id: companyId, code: c.code, name: c.name, kind: c.kind, tax_id: c.tax_id, branch_code: c.branch,
      external_source: null, external_ref: null }).onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: c.name })).execute();
    for (const pr of plan.products) await tx.insertInto('acct.product').values({ company_id: companyId, code: pr.code, name: pr.name, kind: pr.kind, unit: pr.unit, price: pr.price,
      price_2: null, vat: pr.vat, revenue_account: pr.revenue_account, expense_account: null }).onConflict((oc) => oc.columns(['company_id', 'code']).doUpdateSet({ name: pr.name, price: pr.price })).execute();
    const ids = new Map((await tx.selectFrom('acct.contact').select(['id', 'code']).execute()).map((c) => [c.code, c.id]));
    for (const it of plan.openItems) await tx.insertInto('acct.document').values({ company_id: companyId, doc_type: it.side === 'ar' ? 'OB-AR' : 'OB-AP', doc_no: it.doc_no, status: 'posted',
      issue_date: it.date, due_date: it.due, contact_id: ids.get(it.contact)!, grand_total: it.amount, external_source: null, external_ref: null }).execute();
    // ยอดยกมาอยู่ใน transaction เดียวกับข้อมูลหลัก — ล้มเหลวที่จุดไหนก็ไม่มีอะไรถูกบันทึก
    return plan.opening.length
      ? postJournalTx(tx, companyId, { date: p.openingDate, lines: plan.opening, role: p.role, prefix: 'OB', description: 'ยอดยกมา (นำเข้าจาก Excel)' })
      : null;
  });
  return { ok: true as const, counts: { accounts: plan.accounts.length, contacts: plan.contacts.length, products: plan.products.length, openItems: plan.openItems.length, openingLines: plan.opening.length }, opening };
}
