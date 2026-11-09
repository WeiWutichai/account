// M6 รายงานภาษี · อายุหนี้ · งบ · ตรวจความถูกต้อง (docs/technical-plan-M6.md) — คำนวณจากเอกสาร/GL จริงเท่านั้น
// จุดภาษีขาย: บริการ = วันที่รับเงิน (RV ที่โอน 2150400 → 2150100 · ม.78/1) · ใบกำกับทันที (IV immediate / DP / CN / DN) = วันที่ออก
import { Money, type MoneyString } from '@innovera/ledger';
import { sql } from 'kysely';
import type { CompanyTx, Db } from './index.ts';
import { trialBalance } from './ledger-service.ts';

const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const neg = (s: string) => Money.parse(s).neg().toString();

export interface VatRow { date: string; docId: string; docNo: string; docType: string; partner: string; taxId: string | null; branch: string | null; base: string; vat: string; vendorRef?: string | null }

async function salesRows(tx: CompanyTx, from: string, to: string): Promise<VatRow[]> {
  const docs = await tx.selectFrom('acct.document as d').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.subtotal', 'd.discount', 'd.vat', 'd.tax_mode', 'c.name', 'c.tax_id', 'c.branch_code'])
    .where('d.status', '=', 'posted').where('d.issue_date', '>=', from).where('d.issue_date', '<=', to)
    .where((eb) => eb.or([
      eb.and([eb('d.doc_type', '=', 'RV'), eb('d.vat', '>', '0')]),
      eb.and([eb('d.doc_type', '=', 'IV'), eb('d.tax_mode', '=', 'immediate')]),
      eb('d.doc_type', 'in', ['CN', 'DN', 'DP']),
    ])).orderBy('d.issue_date').orderBy('d.doc_no').execute();
  return docs.map((d) => {
    // RV: subtotal = ยอดที่รับ (รวมภาษีถูกหัก) · ฐาน = รับ − ภาษีขายที่โอน (fixtures RV2611-0021 = 1,458,130.84)
    const base = d.doc_type === 'RV' ? Money.parse(d.subtotal).minus(Money.parse(d.vat)).toString() : Money.parse(d.subtotal).minus(Money.parse(d.discount)).toString();
    const sign = d.doc_type === 'CN' ? -1 : 1;
    return { date: d.issue_date, docId: d.id, docNo: d.doc_no ?? '', docType: d.doc_type, partner: d.name ?? '', taxId: d.tax_id, branch: d.branch_code,
      base: sign < 0 ? neg(base) : base, vat: sign < 0 ? neg(d.vat) : d.vat };
  });
}
async function purchaseRows(tx: CompanyTx, from: string, to: string): Promise<VatRow[]> {
  const docs = await tx.selectFrom('acct.document as d').leftJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
    .select(['d.id', 'd.doc_no', 'd.doc_type', 'd.issue_date', 'd.subtotal', 'd.discount', 'd.vat', 'd.vendor_ref', 'c.name', sql<string | null>`coalesce(d.party_tax_id, c.tax_id)`.as('tax_id'), 'c.branch_code'])
    .where('d.status', '=', 'posted').where('d.issue_date', '>=', from).where('d.issue_date', '<=', to).where('d.doc_type', 'in', ['AP', 'EXP', 'DNR', 'CNR']).where('d.vat', '>', '0')
    .orderBy('d.issue_date').orderBy('d.doc_no').execute();
  // TODO(M6): ภาษีซื้อที่ขอใช้สิทธิ์เดือนถัดไป (ม.82/3 ภายใน 6 เดือน) — fixtures input_vat_prior_month_claims · ตอนนี้ใช้เดือนของใบกำกับ
  return docs.map((d) => {
    const base = Money.parse(d.subtotal).minus(Money.parse(d.discount)).toString();
    const cn = d.doc_type === 'CNR';
    return { date: d.issue_date, docId: d.id, docNo: d.doc_no ?? '', docType: d.doc_type, partner: d.name ?? '', taxId: d.tax_id, branch: d.branch_code, vendorRef: d.vendor_ref,
      base: cn ? neg(base) : base, vat: cn ? neg(d.vat) : d.vat };
  });
}
const sum = (rows: VatRow[], k: 'base' | 'vat') => Money.sum(rows.map((r) => Money.parse(r[k]))).toString();

export async function vatReports(db: Db, companyId: string, ym: string) {
  const { from, to } = monthRange(ym);
  return db.withCompany(companyId, async (tx) => {
    const sales = await salesRows(tx, from, to);
    const purchases = await purchaseRows(tx, from, to);
    // ยอดขายที่ได้รับยกเว้น: รับชำระใบที่ไม่มี VAT (เช่น ค่าเช่า ม.81(1)(ฑ)) ในเดือน
    const exempt = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
      .innerJoin('acct.document as i', (j) => j.onRef('i.id', '=', 's.document_id').onRef('i.company_id', '=', 's.company_id'))
      .select(sql<string>`coalesce(sum(s.applied + s.wht), 0)`.as('v')).where('p.doc_type', '=', 'RV').where('p.status', '=', 'posted').where('s.voided', '=', false)
      .where('i.vat', '=', '0').where('p.issue_date', '>=', from).where('p.issue_date', '<=', to).executeTakeFirstOrThrow();
    const outputVat = Money.parse(sum(sales, 'vat'));
    const inputVat = Money.parse(sum(purchases, 'vat'));
    const taxable = Money.parse(sum(sales, 'base'));
    const exemptSales = Money.parse(exempt.v);
    return {
      month: ym, sales: { rows: sales, base: taxable.toString(), vat: outputVat.toString() }, purchases: { rows: purchases, base: sum(purchases, 'base'), vat: inputVat.toString() },
      pp30: { salesTotal: taxable.plus(exemptSales).toString(), exemptSales: exemptSales.toString(), taxableSales: taxable.toString(), outputVat: outputVat.toString(),
        purchasesCreditable: sum(purchases, 'base'), inputVat: inputVat.toString(), netPayable: outputVat.minus(inputVat).toString(),
        // ยื่นแล้ว: ล้างภาษีขาย/ภาษีซื้อเข้าบัญชีภาษีค้างจ่าย (fixtures pp30.post_on_filed)
        postOnFiled: [['Dr', '2150100', outputVat.toString()], ['Cr', '1170100', inputVat.toString()], ['Cr', '2150200', outputVat.minus(inputVat).toString()]] as [string, string, MoneyString][] },
    };
  });
}

/** ภ.ง.ด.3 / ภ.ง.ด.53 ของเดือนที่จ่าย (จาก 50 ทวิ ที่ออก) */
export async function pndReport(db: Db, companyId: string, ym: string, pnd: '3' | '53') {
  const { from, to } = monthRange(ym);
  const rows = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.wht_certificate as w').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'w.contact_id').onRef('c.company_id', '=', 'w.company_id'))
    .innerJoin('acct.document as p', (j) => j.onRef('p.id', '=', 'w.payment_id').onRef('p.company_id', '=', 'w.company_id'))
    .select(['w.cert_no', 'w.pay_date', 'w.income_type', 'w.income_section', 'w.base', 'w.rate', 'w.amount', 'w.pending_auditor', 'c.name', 'c.tax_id', 'c.branch_code', 'c.address', 'p.doc_no'])
    .where('w.pnd', '=', pnd).where('w.voided', '=', false).where('w.pay_date', '>=', from).where('w.pay_date', '<=', to).orderBy('w.pay_date').orderBy('w.cert_no').execute());
  return { month: ym, pnd, rows, certs: rows.length, base: Money.sum(rows.map((r) => Money.parse(r.base))).toString(), tax: Money.sum(rows.map((r) => Money.parse(r.amount))).toString(),
    pendingAuditor: rows.some((r) => r.pending_auditor) };
}

/**
 * ไฟล์ข้อความสำหรับโปรแกรม RD Prep (ภ.ง.ด.3/53) — คั่นด้วย | หนึ่งบรรทัดต่อผู้รับเงิน
 * TODO(Wei): ยังไม่มีสำเนา spec ไฟล์นำเข้า RD Prep ในเครื่อง — ลำดับคอลัมน์ด้านล่างต้องตรวจกับ spec จริง + validator ก่อนใช้ยื่น (Gate M6)
 */
export function rdPrepTxt(report: Awaited<ReturnType<typeof pndReport>>): string {
  return report.rows.map((r, i) => [
    String(i + 1), r.tax_id ?? '', r.branch_code ?? '00000', r.name, r.address ?? '', r.pay_date.split('-').reverse().map((x, k) => (k === 2 ? String(Number(x) + 543) : x)).join('/'),
    r.income_section ?? r.income_type, Money.parse(r.rate).times('100').toString().replace(/\.00$/u, ''), r.base, r.amount, '1',
  ].join('|')).join('\r\n') + '\r\n';
}

// ---------- อายุหนี้ (ScreenAging) ----------

export async function aging(db: Db, companyId: string, asOf: string, side: 'AR' | 'AP') {
  const types = side === 'AR' ? ['IV', 'DN'] : ['AP', 'EXP', 'DNR'];
  return db.withCompany(companyId, async (tx) => {
    const docs = await tx.selectFrom('acct.document as d').innerJoin('acct.contact as c', (j) => j.onRef('c.id', '=', 'd.contact_id').onRef('c.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_no', 'd.issue_date', 'd.due_date', 'd.grand_total', 'c.id as contact_id', 'c.code', 'c.name',
        // ตัดยอด/ลดหนี้ที่เกิดถึงวันที่ asOf เท่านั้น
        sql<string>`coalesce((select sum(s.applied + s.wht) from acct.settlement s join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
          where s.document_id = d.id and s.company_id = d.company_id and not s.voided and p.issue_date <= ${asOf}), 0)`.as('settled')])
      .where('d.doc_type', 'in', types).where('d.pay_now', '=', false).where('d.issue_date', '<=', asOf) // EXP จ่ายทันทีไม่มีหนี้ค้าง.where((eb) => eb.or([eb('d.status', '=', 'posted'), eb.and([eb('d.status', '=', 'voided'), eb('d.voided_at', '>', new Date(`${asOf}T23:59:59+07:00`))])]))
      .execute();
    const buckets = ['current', 'b1_30', 'b31_60', 'b61_90', 'b91_120', 'over_120'] as const;
    type B = (typeof buckets)[number];
    const byContact = new Map<string, { contactId: string; code: string; name: string; docs: { docNo: string; due: string | null; days: number; amount: string; bucket: B }[] } & Record<B | 'total', Money>>();
    for (const d of docs) {
      const open = Money.parse(d.grand_total).minus(Money.parse(d.settled));
      if (!open.gt(Money.zero())) continue;
      const due = d.due_date ?? d.issue_date;
      const days = Math.floor((Date.parse(asOf) - Date.parse(due)) / 86_400_000);
      const bucket: B = days <= 0 ? 'current' : days <= 30 ? 'b1_30' : days <= 60 ? 'b31_60' : days <= 90 ? 'b61_90' : days <= 120 ? 'b91_120' : 'over_120';
      const row = byContact.get(d.contact_id) ?? { contactId: d.contact_id, code: d.code, name: d.name, docs: [], ...Object.fromEntries([...buckets, 'total'].map((b) => [b, Money.zero()])) } as never;
      row[bucket] = row[bucket].plus(open);
      row.total = row.total.plus(open);
      row.docs.push({ docNo: d.doc_no ?? '', due: d.due_date, days, amount: open.toString(), bucket });
      byContact.set(d.contact_id, row);
    }
    const rows = [...byContact.values()].sort((a, b) => (b.total.gt(a.total) ? 1 : -1)).map((r) => ({
      contactId: r.contactId, code: r.code, name: r.name, docs: r.docs, ...Object.fromEntries([...buckets, 'total'].map((b) => [b, r[b as B | 'total'].toString()])),
    }));
    const totals = Object.fromEntries([...buckets, 'total'].map((b) => [b, Money.sum([...byContact.values()].map((r) => r[b as B | 'total'])).toString()]));
    // ยอด GL ของบัญชีคุม ณ วันที่ เทียบกับรายใบ
    const control = side === 'AR' ? '1130100' : '2110100';
    const gl = await tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .select([sql<string>`coalesce(sum(l.debit) - sum(l.credit), 0)`.as('b')]).where('l.account_code', '=', control).where('j.status', '<>', 'draft').where('j.journal_date', '<=', asOf).executeTakeFirstOrThrow();
    const glBal = side === 'AR' ? Money.parse(gl.b) : Money.parse(gl.b).neg();
    return { asOf, side, rows, totals, gl: { account: control, balance: glBal.toString(), diff: glBal.minus(Money.parse(totals.total as string)).toString() } };
  });
}

// ---------- งบการเงินจาก GL (ScreenReports) ----------

export async function financialStatements(db: Db, companyId: string, p: { fiscalYear: number; upToPeriod: number }) {
  const tb = await trialBalance(db, companyId, p);
  const accounts = await db.withCompany(companyId, (tx) => tx.selectFrom('acct.account').select(['code', 'name', 'type']).execute());
  const typeOf = new Map(accounts.map((a) => [a.code, a]));
  const lines = tb.map((r) => ({ ...r, name: typeOf.get(r.account)?.name ?? '', type: typeOf.get(r.account)?.type ?? '' }));
  const pick = (types: string[]) => lines.filter((l) => types.includes(l.type));
  const bal = (xs: typeof lines, creditNormal: boolean) => Money.sum(xs.map((x) => (creditNormal ? Money.parse(x.balance).neg() : Money.parse(x.balance))));
  const revenue = bal(pick(['revenue', 'contra_revenue']), true);
  const expense = bal(pick(['expense']), false);
  const assets = bal(pick(['asset', 'contra_asset']), false);
  const liabilities = bal(pick(['liability']), true);
  const equity = bal(pick(['equity']), true);
  const profit = revenue.minus(expense);
  return {
    pl: { revenue: pick(['revenue', 'contra_revenue']), expense: pick(['expense']), totalRevenue: revenue.toString(), totalExpense: expense.toString(), profit: profit.toString() },
    bs: { assets: pick(['asset', 'contra_asset']), liabilities: pick(['liability']), equity: pick(['equity']), totalAssets: assets.toString(), totalLiabilities: liabilities.toString(),
      totalEquity: equity.plus(profit).toString(), balanced: assets.equals(liabilities.plus(equity).plus(profit)) },
  };
}

// ---------- ตรวจความถูกต้อง (ScreenReconReport · R3) ----------

export interface ReconCheckRow { key: string; section: 1 | 2 | 3; label: string; byDocs: string; byGl: string; diff: string; ok: boolean; count?: string; note?: string }

/**
 * ScreenReconReport: 3 ด้าน (16 จุดตรวจ · แบบร่างแสดงตัวอย่าง "14")
 * 1 เอกสาร ↔ GL: ยอดเอกสารที่ผ่านรายการในงวด ↔ ยอดเคลื่อนไหวของบัญชีที่ตรวจ (journal ของเอกสารประเภทนั้น + JV คีย์มือที่ไม่มีเอกสาร)
 * 2 รายงานภาษี ↔ GL · 3 sub-ledger ↔ บัญชีคุม ณ สิ้นงวด
 * JV ระบบที่ไม่มีเอกสารแต่ไม่ใช่คีย์มือ (ค่าเสื่อม · นำฝาก/ผ่าน/คืนเช็ค) ไม่นับเป็น "JV ไม่มีเอกสาร"
 */
export async function reconChecks(db: Db, companyId: string, ym: string) {
  const { from, to } = monthRange(ym);
  const vat = await vatReports(db, companyId, ym);
  const pnd3 = await pndReport(db, companyId, ym, '3');
  const pnd53 = await pndReport(db, companyId, ym, '53');
  const ar = await aging(db, companyId, to, 'AR');
  const ap = await aging(db, companyId, to, 'AP');
  const P = (v: string | null | undefined) => Money.parse(v ?? '0');
  const check = (section: 1 | 2 | 3, key: string, label: string, byDocs: Money | string, byGl: Money | string, extra: { count?: string; note?: string } = {}): ReconCheckRow => {
    const d = typeof byDocs === 'string' ? Money.parse(byDocs) : byDocs;
    const g = typeof byGl === 'string' ? Money.parse(byGl) : byGl;
    return { key, section, label, byDocs: d.toString(), byGl: g.toString(), diff: g.minus(d).toString(), ok: g.equals(d), ...extra };
  };
  return db.withCompany(companyId, async (tx) => {
    // journal ที่ยังมีผล (ไม่ใช่ร่าง · ไม่ใช่ reversal · ไม่ถูกกลับรายการ) ในงวด
    const live = () => tx.selectFrom('acct.journal_line as l').innerJoin('acct.journal as j', (jn) => jn.onRef('j.id', '=', 'l.journal_id').onRef('j.company_id', '=', 'l.company_id'))
      .leftJoin('acct.document as d', (jn) => jn.onRef('d.id', '=', 'j.source_document_id').onRef('d.company_id', '=', 'j.company_id'))
      .where('j.status', '<>', 'draft').where('j.reversal_of', 'is', null)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('acct.journal as r').select('r.id').whereRef('r.reversal_of', '=', 'j.id'))));
    const lines = await live().where('j.journal_date', '>=', from).where('j.journal_date', '<=', to)
      .select(['j.id as journal_id', 'j.journal_no', 'j.source_document_id', 'd.doc_type', 'l.account_code', 'l.debit', 'l.credit']).execute();
    // JV ระบบ (ไม่ใช่คีย์มือ): ค่าเสื่อม · เช็ค
    const sysIds = new Set<string>([
      ...(await tx.selectFrom('acct.depreciation_run').select('journal_id').execute()).map((r) => r.journal_id),
      ...(await tx.selectFrom('acct.cheque').select('journal_ids').execute()).flatMap((r) => r.journal_ids),
    ]);
    const manual = lines.filter((l) => !l.source_document_id && !sysIds.has(l.journal_id));
    const sum = (rows: typeof lines, acct: (a: string) => boolean, side: 'Dr' | 'Cr') =>
      Money.sum(rows.filter((l) => acct(l.account_code)).map((l) => (side === 'Dr' ? P(l.debit).minus(P(l.credit)) : P(l.credit).minus(P(l.debit)))));
    const ofTypes = (types: string[]) => lines.filter((l) => l.doc_type && types.includes(l.doc_type));
    const docs = await tx.selectFrom('acct.document').select(['id', 'doc_type', 'subtotal', 'grand_total', 'vat', 'journal_id', 'issue_date', 'status'])
      .where('status', '=', 'posted').where('issue_date', '>=', from).where('issue_date', '<=', to).execute();
    const dsum = (types: string[], f: (d: (typeof docs)[number]) => Money) => Money.sum(docs.filter((d) => types.includes(d.doc_type)).map(f));
    const n = (types: string[]) => String(docs.filter((d) => types.includes(d.doc_type)).length);
    const rev = (a: string) => a.startsWith('41');
    const cost = (a: string) => a.startsWith('5') || /^15[1-4]/u.test(a);
    const cash = (a: string) => a.startsWith('1100') || a.startsWith('1150');
    const manualNos = (acct: (a: string) => boolean) => [...new Set(manual.filter((l) => acct(l.account_code)).map((l) => l.journal_no))];
    const noteOf = (nos: string[], ok: boolean) => (ok || !nos.length ? {} : { note: `${nos.join(', ')} คีย์มือ ไม่มีเอกสารอ้างอิง` });

    const sec1: ReconCheckRow[] = [];
    {
      const d = dsum(['IV'], (x) => P(x.subtotal));
      const g = sum(ofTypes(['IV']), rev, 'Cr').plus(sum(manual, rev, 'Cr'));
      const c = check(1, 'doc_iv', 'ใบกำกับภาษี IV (ขาย)', d, g, { count: n(['IV']) });
      sec1.push({ ...c, ...noteOf(manualNos(rev), c.ok) });
    }
    sec1.push(check(1, 'doc_cn_dn', 'ใบลดหนี้ CN / เพิ่มหนี้ DN', dsum(['DN'], (x) => P(x.subtotal)).minus(dsum(['CN'], (x) => P(x.subtotal))),
      sum(ofTypes(['CN', 'DN']), (a) => rev(a) || a === '4150100', 'Cr'), { count: n(['CN', 'DN']) }));
    {
      const c = check(1, 'doc_ap_exp', 'บิลซื้อ AP + ค่าใช้จ่าย EXP', dsum(['AP', 'EXP'], (x) => P(x.subtotal)),
        sum(ofTypes(['AP', 'EXP']), cost, 'Dr').plus(sum(manual, (a) => a.startsWith('53') || /^15[1-4]/u.test(a), 'Dr')), { count: n(['AP', 'EXP']) });
      sec1.push({ ...c, ...noteOf(manualNos((a) => a.startsWith('53') || /^15[1-4]/u.test(a)), c.ok) });
    }
    sec1.push(check(1, 'doc_rv', 'รับชำระ RV', dsum(['RV'], (x) => P(x.grand_total)), sum(ofTypes(['RV']), cash, 'Dr'), { count: n(['RV']) }));
    sec1.push(check(1, 'doc_pv', 'จ่ายชำระ PV', dsum(['PV'], (x) => P(x.grand_total).neg()), sum(ofTypes(['PV']), cash, 'Dr'), { count: n(['PV']) }));
    {
      const noJv = docs.filter((d) => !d.journal_id && !['QO', 'SO', 'PR', 'PO', 'BN', 'BNR', 'PC'].includes(d.doc_type));
      const manualJvs = [...new Set(manual.map((l) => l.journal_no))];
      const amt = Money.sum(manual.map((l) => P(l.debit)));
      sec1.push({ key: 'doc_orphans', section: 1, label: 'เอกสารผ่านรายการแต่ไม่มี JV / JV ไม่มีเอกสาร', byDocs: '0.00', byGl: '0.00', diff: '0.00', ok: !noJv.length && !manualJvs.length,
        count: `${noJv.length} / ${manualJvs.length}`, ...(manualJvs.length ? { note: `${manualJvs.join(', ')} (คีย์มือ ${amt.toString()})` } : {}) });
    }

    // ---------- 2 รายงานภาษี ↔ GL ----------
    const move = (a: string, side: 'Dr' | 'Cr') => sum(lines, (x) => x === a, side);
    const balance = async (accounts: string[]) => {
      const r = await live().where('j.journal_date', '<=', to).where('l.account_code', 'in', accounts).select(sql<string>`coalesce(sum(l.debit - l.credit), 0)`.as('b')).executeTakeFirstOrThrow();
      return Money.parse(r.b);
    };
    // ภาษีขายยังไม่ถึงกำหนด ตามเอกสาร = ส่วน VAT ของยอดค้างรับของใบที่ลง 2150400 (ตัดชำระถึงสิ้นงวด)
    const deferredDocs = await tx.selectFrom('acct.document as d').innerJoin('acct.journal_line as l', (jn) => jn.onRef('l.journal_id', '=', 'd.journal_id').onRef('l.company_id', '=', 'd.company_id'))
      .select(['d.id', 'd.doc_type', 'd.grand_total', sql<string>`sum(l.credit - l.debit)`.as('vat'),
        sql<string>`coalesce((select sum(s.vat_due) from acct.settlement s join acct.document p on p.id = s.payment_id and p.company_id = s.company_id
          where s.document_id = d.id and s.company_id = d.company_id and not s.voided and p.issue_date <= ${to}), 0)`.as('due')])
      .where('d.doc_type', 'in', ['IV', 'DN', 'CN']).where('d.status', '=', 'posted').where('d.issue_date', '<=', to).where('l.account_code', '=', '2150400').groupBy(['d.id', 'd.doc_type', 'd.grand_total']).execute();
    const deferred = Money.sum(deferredDocs.map((x) => P(x.vat).minus(P(x.due))));
    const whtIn = await tx.selectFrom('acct.settlement as s').innerJoin('acct.document as p', (jn) => jn.onRef('p.id', '=', 's.payment_id').onRef('p.company_id', '=', 's.company_id'))
      .select(sql<string>`coalesce(sum(s.wht), 0)`.as('w')).where('p.doc_type', '=', 'RV').where('p.status', '=', 'posted').where('s.voided', '=', false).where('p.issue_date', '<=', to).executeTakeFirstOrThrow();
    const sec2 = [
      check(2, 'vat_output', 'ภาษีขาย: รายงานภาษีขาย ↔ GL 2150100 (เครดิตสุทธิในเดือน)', vat.sales.vat, move('2150100', 'Cr')),
      check(2, 'vat_input', 'ภาษีซื้อ: รายงานภาษีซื้อ ↔ GL 1170100 (เดบิตสุทธิในเดือน)', vat.purchases.vat, move('1170100', 'Dr')),
      check(2, 'vat_deferred', 'ภาษีขายยังไม่ถึงกำหนด: ใบที่ยังไม่รับเงิน ↔ GL 2150400 (ยอดคงเหลือ)', deferred, (await balance(['2150400'])).neg()),
      check(2, 'wht_payable', 'ภาษีหัก ณ ที่จ่าย: ภ.ง.ด.3 + 53 ↔ GL 2150300 (เครดิตในเดือน)', Money.parse(pnd3.tax).plus(Money.parse(pnd53.tax)), Money.sum(lines.filter((x) => x.account_code === '2150300').map((x) => P(x.credit)))),
      check(2, 'wht_received', 'ภาษีถูกหัก ณ ที่จ่าย: 50 ทวิ ที่ได้รับ ↔ GL 1160100 (ยอดคงเหลือ)', P(whtIn.w), await balance(['1160100'])),
    ];

    // ---------- 3 sub-ledger ↔ บัญชีคุม ----------
    const docCount = (a: typeof ar) => `${a.rows.length} / ${a.rows.reduce((s, r) => s + r.docs.length, 0)}`;
    const deps = await tx.selectFrom('acct.document as d').select(['d.id', 'd.contact_id', 'd.subtotal',
      sql<string>`coalesce((select sum(s.applied) from acct.settlement s join acct.document i on i.id = s.document_id and i.company_id = s.company_id
        where s.payment_id = d.id and s.company_id = d.company_id and not s.voided and i.status = 'posted' and i.issue_date <= ${to}), 0)`.as('used')])
      .where('d.doc_type', '=', 'DP').where('d.status', '=', 'posted').where('d.issue_date', '<=', to).execute();
    const depOpen = deps.map((x) => ({ ...x, open: P(x.subtotal).minus(P(x.used)) })).filter((x) => x.open.gt(Money.zero()));
    const paidDeposit = await live().where('j.journal_date', '<=', to).where('l.account_code', '=', '1140100').where('l.contact_id', 'is not', null)
      .select(['l.contact_id', sql<string>`sum(l.debit - l.credit)`.as('b')]).groupBy('l.contact_id').execute();
    const paidOpen = paidDeposit.filter((x) => P(x.b).gt(Money.zero()));
    const cheques = await tx.selectFrom('acct.cheque').select(['amount']).where('direction', '=', 'received').where('status', 'in', ['on_hand', 'deposited']).execute();
    const sec3 = [
      check(3, 'ar_control', 'ลูกหนี้รายใบ ↔ GL 1130100', ar.totals.total as string, ar.gl.balance, { count: docCount(ar) }),
      check(3, 'ap_control', 'เจ้าหนี้รายใบ ↔ GL 2110100', ap.totals.total as string, ap.gl.balance, { count: docCount(ap) }),
      check(3, 'deposit_received', 'เงินมัดจำรับรายใบ ↔ GL 2140100', Money.sum(depOpen.map((x) => x.open)), (await balance(['2140100'])).neg(),
        { count: `${new Set(depOpen.map((x) => x.contact_id)).size} / ${depOpen.length}` }),
      // TODO(backend): ยังไม่มีเอกสารมัดจำจ่าย — sub-ledger = ยอดรายผู้ขายที่ผูกคู่ค้าใน GL
      check(3, 'deposit_paid', 'เงินมัดจำจ่ายรายผู้ขาย ↔ GL 1140100', Money.sum(paidOpen.map((x) => P(x.b))), await balance(['1140100']),
        { count: `${paidOpen.length} / ${paidOpen.length}` }),
      check(3, 'cheques', 'ทะเบียนเช็ครับในมือ + นำฝาก ↔ GL 1150100 + 1150200', Money.sum(cheques.map((c) => P(c.amount))), await balance(['1150100', '1150200']),
        { count: `${cheques.length} ฉบับ` }),
    ];
    const checks = [...sec1, ...sec2, ...sec3];
    return { month: ym, checks, passed: checks.filter((c) => c.ok).length, toReview: checks.filter((c) => !c.ok).length };
  });
}
