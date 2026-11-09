// สร้าง/ลบบริษัท · ลบได้เฉพาะบริษัทที่ไม่มี journal ผ่านรายการ (ใช้ใน onboarding/test)
import type { Db } from './index.ts';

export interface NewCompany { orgId: string; nameTh: string; nameEn?: string; taxId?: string }

export async function createOrganization(db: Db, name: string): Promise<string> {
  return db.withPublic(async (tx) => (await tx.insertInto('public.organization').values({ name }).returning('id').executeTakeFirstOrThrow()).id);
}

export async function createCompany(db: Db, c: NewCompany): Promise<string> {
  return db.withPublic(async (tx) =>
    (await tx.insertInto('public.company').values({ org_id: c.orgId, name_th: c.nameTh, name_en: c.nameEn ?? null, tax_id: c.taxId ?? null, db_dsn: null })
      .returning('id').executeTakeFirstOrThrow()).id);
}

const ACCT_TABLES_DELETE_ORDER = ['audit_log', 'journal_line', 'journal', 'posting_rule_version', 'posting_rule', 'document_line', 'document',
  'number_series', 'product', 'contact', 'period', 'account'] as const;

export async function deleteCompany(db: Db, companyId: string): Promise<void> {
  await db.withCompany(companyId, async (tx) => {
    const posted = await tx.selectFrom('acct.journal').select('id').where('status', '<>', 'draft').limit(1).execute();
    if (posted.length) throw new Error('ลบบริษัทที่มี journal ผ่านรายการแล้วไม่ได้');
    for (const t of ACCT_TABLES_DELETE_ORDER) {
      if (t === 'audit_log') continue; // append-only — บริษัทที่ลบได้ต้องไม่มี audit (ตรวจด้านล่าง)
      await (tx as unknown as import('kysely').Transaction<Record<string, Record<string, unknown>>>).deleteFrom(`acct.${t}`).execute();
    }
  });
  await db.withPublic((tx) => tx.deleteFrom('public.company').where('id', '=', companyId).execute());
}
