// Phase 2A SWT — จุดเชื่อมกับเอกสารขาย/ซื้อเดิม (sales.ts · purchase.ts เรียกไฟล์นี้ · ไฟล์นี้ไม่ import sales/purchase เพื่อกัน import วน)
// โมดูล "software" ปิด (ค่าตั้งต้น) = ไม่มีบรรทัดสัญญา / ไม่มีผู้ขายต่างประเทศที่ใช้ภาษี SWT → ทุกฟังก์ชันคืนค่าเดิม (พฤติกรรม Phase 1)
import { allocate, assertBalanced, Money, revenueSchedule, type JournalLine } from '@innovera/ledger';
import { sql } from 'kysely';
import type { CompanyTx } from './index.ts';
import { LedgerError } from './ledger-service.ts';

/** คีย์โมดูลใน public.company.modules (jsonb) */
export const SOFTWARE_MODULE = 'software';
export const DEFERRED_REVENUE = '2170100';

/** โมดูลเปิดอยู่หรือไม่ (บริษัทของ transaction ปัจจุบัน · acct.current_company()) */
export async function moduleOnTx(tx: CompanyTx, key = SOFTWARE_MODULE): Promise<boolean> {
  const r = await sql<{ on: boolean | null }>`select (modules->>${key})::boolean as on from public.company where id = acct.current_company()`.execute(tx);
  return r.rows[0]?.on === true;
}
export async function requireModuleTx(tx: CompanyTx): Promise<void> {
  if (!(await moduleOnTx(tx))) throw new LedgerError('ยังไม่ได้เปิดโมดูลสัญญา/ซอฟต์แวร์ (software) ของบริษัทนี้');
}
/** ค่าตั้งของบริษัท (acct.company_setting) · ไม่มี = ค่าตั้งต้น */
export async function settingTx<T>(tx: CompanyTx, key: string, fallback: T): Promise<T> {
  const r = await tx.selectFrom('acct.company_setting').select('value').where('key', '=', key).executeTakeFirst();
  return r ? (r.value as T) : fallback;
}

// ---------- ขาย: IV ที่มีบรรทัดสัญญารับรู้ตามช่วงเวลา (ratably) ----------

export interface ScheduleSeed { contractLineId: string; documentLineId: string; amount: Money; from: string; to: string; account: string }
/**
 * ย้ายส่วนรายได้ของบรรทัด ratably จากบัญชีรายได้ที่สูตรลง → Cr 2170100 รายได้รับล่วงหน้า (VAT/ลูกหนี้ตามสูตรเดิมทุกอย่าง · 2150400 → 2150100 ตอนรับเงิน)
 * ยอดของบรรทัด = ยอดก่อน VAT − ส่วนลดท้ายบิลที่กระจายตามสัดส่วน · บัญชีที่ลด: บัญชีรายได้ของบรรทัดสัญญา → บรรทัดเอกสาร → สินค้า → บรรทัด Cr รายได้แรกที่พอ
 * คืน seeds สำหรับสร้างตารางรับรู้หลังลงบัญชี (commitSchedule)
 */
export async function deferRevenueTx(tx: CompanyTx, docId: string, docType: string, lines: JournalLine[]): Promise<{ lines: JournalLine[]; seeds: ScheduleSeed[] }> {
  if (docType !== 'IV') return { lines, seeds: [] };
  const items = await tx.selectFrom('acct.document_line as l')
    .leftJoin('acct.contract_line as c', (j) => j.onRef('c.id', '=', 'l.contract_line_id').onRef('c.company_id', '=', 'l.company_id'))
    .leftJoin('acct.product as p', (j) => j.onRef('p.code', '=', 'l.product_code').onRef('p.company_id', '=', 'l.company_id'))
    .select(['l.id', 'l.amount', 'l.account_code', 'l.service_from', 'l.service_to', 'c.id as contract_line_id', 'c.recognition', 'c.revenue_account', 'p.revenue_account as product_account'])
    .where('l.document_id', '=', docId).where('l.line_type', '=', 'item').orderBy('l.line_no').execute();
  const ratable = items.filter((i) => i.contract_line_id && i.recognition === 'ratably');
  if (!ratable.length) return { lines, seeds: [] };
  const doc = await tx.selectFrom('acct.document').select(['discount']).where('id', '=', docId).executeTakeFirstOrThrow();
  const amounts = items.map((i) => Money.parse(i.amount));
  const disc = allocate(Money.parse(doc.discount), amounts);
  const revenueAccounts = new Set((await tx.selectFrom('acct.account').select('code').where('type', '=', 'revenue').execute()).map((a) => a.code));
  const out = lines.map((l) => ({ ...l }));
  const seeds: ScheduleSeed[] = [];
  for (const r of ratable) {
    if (!r.service_from || !r.service_to) throw new LedgerError('บรรทัดสัญญาที่รับรู้ตามช่วงเวลาต้องมีช่วงบริการ');
    const idx = items.indexOf(r);
    const amount = amounts[idx]!.minus(disc[idx]!);
    if (amount.isZero()) continue;
    const prefer = [r.revenue_account, r.account_code, r.product_account].filter((a): a is string => Boolean(a));
    const hit = prefer.map((a) => out.findIndex((l) => l.side === 'Cr' && l.account === a && !l.amount.lt(amount))).find((i) => i >= 0)
      ?? out.findIndex((l) => l.side === 'Cr' && revenueAccounts.has(l.account) && !l.amount.lt(amount));
    if (hit === undefined || hit < 0) throw new LedgerError('หาบรรทัดรายได้ของสูตรลงบัญชีที่จะโอนเป็นรายได้รับล่วงหน้าไม่ได้ — ตรวจสูตรลงบัญชีของใบแจ้งหนี้');
    out[hit] = { ...out[hit]!, amount: out[hit]!.amount.minus(amount) };
    seeds.push({ contractLineId: r.contract_line_id!, documentLineId: r.id, amount, from: r.service_from, to: r.service_to, account: out[hit]!.account });
  }
  const deferred = Money.sum(seeds.map((s) => s.amount));
  const kept = out.filter((l) => !l.amount.isZero());
  const at = kept.findIndex((l) => l.side === 'Cr' && l.account === DEFERRED_REVENUE);
  if (at >= 0) kept[at] = { ...kept[at]!, amount: kept[at]!.amount.plus(deferred) };
  else if (!deferred.isZero()) kept.push({ side: 'Cr', account: DEFERRED_REVENUE, amount: deferred, memo: 'รายได้รับล่วงหน้า (รับรู้ตามช่วงเวลาบริการ)' });
  assertBalanced(kept);
  return { lines: kept, seeds };
}

/** ใบลดหนี้อ้างใบแจ้งหนี้ที่มีรายได้รับล่วงหน้า — สูตร CN เดิมเดบิตรายได้ ไม่ใช่ 2170100 · TODO(Wei): วิธีลดหนี้ subscription ยังไม่กำหนด → ไม่ให้ลงบัญชี */
export async function assertCreditNoteAllowedTx(tx: CompanyTx, refDocumentId: string | null): Promise<void> {
  if (!refDocumentId) return;
  const s = await tx.selectFrom('acct.revenue_schedule').select('id').where('document_id', '=', refDocumentId).where('voided', '=', false).limit(1).executeTakeFirst();
  if (s) throw new LedgerError('ใบแจ้งหนี้นี้มีรายได้รับล่วงหน้า (สัญญา) — ลดหนี้ยังไม่รองรับ (รอยืนยันวิธีบันทึก) · ยกเลิกใบแจ้งหนี้แล้วออกใหม่แทน');
}

/**
 * ก่อนยกเลิกเอกสาร (voidDocumentTx):
 * - IV ที่มีตารางรับรู้: รับรู้ไปแล้วบางงวด → ต้องยกเลิกการรับรู้งวดนั้นก่อน · ยังไม่รับรู้ → ปิดตาราง (voided) · ยอดใช้งานที่ผูกใบนี้กลับเป็นยังไม่ออกบิล
 * - ใบสำคัญจ่าย/ค่าใช้จ่ายที่มี ภ.พ.36 ยื่นแล้ว → ยกเลิกไม่ได้ (ต้องยื่นเพิ่มเติม/ขอคืนนอกระบบ · TODO(Wei))
 */
export async function swtBeforeVoidTx(tx: CompanyTx, docId: string): Promise<void> {
  const recognized = await tx.selectFrom('acct.revenue_schedule as s').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 's.journal_id').onRef('j.company_id', '=', 's.company_id'))
    .select(['s.period', 'j.journal_no']).where('s.document_id', '=', docId).where('s.voided', '=', false).execute();
  if (recognized.length) throw new LedgerError(`ใบนี้รับรู้รายได้ไปแล้ว (${[...new Set(recognized.map((r) => `${r.period} ${r.journal_no}`))].join(', ')}) — ยกเลิกการรับรู้รายได้ของงวดนั้นก่อน`);
  await tx.updateTable('acct.revenue_schedule').set({ voided: true }).where('document_id', '=', docId).execute();
  await tx.updateTable('acct.usage_record').set({ document_id: null }).where('document_id', '=', docId).execute();
  const filed = await tx.selectFrom('acct.pp36_entry').select('id').where('payment_id', '=', docId).where('filing_id', 'is not', null).limit(1).executeTakeFirst();
  if (filed) throw new LedgerError('การจ่ายนี้ยื่น ภ.พ.36 แล้ว — ยกเลิกไม่ได้ (ต้องยื่นแบบเพิ่มเติม/ขอคืน · รอยืนยัน)');
}

/** สร้างตารางรับรู้รายเดือนหลัง IV ลงบัญชี (pro-rate ตามวัน · ปัดเศษเดือนสุดท้าย) */
export async function commitScheduleTx(tx: CompanyTx, companyId: string, docId: string, seeds: ScheduleSeed[]): Promise<void> {
  for (const s of seeds) {
    for (const row of revenueSchedule(s.amount.toString(), s.from, s.to)) {
      await tx.insertInto('acct.revenue_schedule').values({ company_id: companyId, contract_line_id: s.contractLineId, document_id: docId, document_line_id: s.documentLineId,
        period: row.period, days: row.days, amount: row.amount, revenue_account: s.account, journal_id: null }).execute();
    }
  }
}
