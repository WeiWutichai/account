// type ของตาราง (เขียนมือ · test schema.test.ts ตรวจว่าตรงกับ DB จริง) · เงินเป็น string เสมอ (NUMERIC → string ใน pg)
import type { ColumnType, Generated } from 'kysely';

type Money = ColumnType<string, string | undefined, string>;
type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type DateCol = ColumnType<string, string, string>; // 'YYYY-MM-DD'

export interface PublicDB {
  'public.organization': { id: Generated<string>; name: string; created_at: Ts };
  'public.app_user': { id: Generated<string>; email: string; display_name: string; password_hash: string | null; mfa_enabled: Generated<boolean>; created_at: Ts };
  'public.company': {
    id: Generated<string>; org_id: string; name_th: string; name_en: string | null; tax_id: string | null; branch_code: Generated<string>;
    business_type: Generated<string>; vat_registered: Generated<boolean>; service_tax_point: Generated<'on_payment' | 'on_invoice'>;
    wht_recognition: Generated<'on_payment' | 'on_invoice'>; fiscal_year_start: Generated<string>; db_dsn: string | null;
    status: Generated<'active' | 'suspended' | 'archived'>; created_at: Ts;
  };
}

export type AccountType = 'asset' | 'contra_asset' | 'liability' | 'equity' | 'revenue' | 'contra_revenue' | 'expense';

export interface AcctDB {
  'acct.account': { company_id: string; code: string; name: string; type: AccountType; parent_code: string | null; is_control: Generated<boolean>;
    control_kind: 'ar' | 'ap' | 'deposit_in' | 'deposit_out' | null; requires_contact: Generated<boolean>; active: Generated<boolean>; created_at: Ts };
  'acct.period': { company_id: string; fiscal_year: number; period_no: number; starts_on: DateCol; ends_on: DateCol;
    status: Generated<'open' | 'soft_closed' | 'hard_closed'>; closed_at: Date | null; closed_by: string | null };
  'acct.contact': { company_id: string; id: Generated<string>; code: string; name: string; kind: 'customer' | 'vendor' | 'both' | 'contractor' | 'employee';
    tax_id: string | null; branch_code: string | null; external_source: string | null; external_ref: string | null; created_at: Ts };
  'acct.product': { company_id: string; code: string; name: string; kind: Generated<'service' | 'goods' | 'expense' | 'kit'>; unit: string | null;
    price: string | null; price_2: string | null; vat: Generated<boolean>; revenue_account: string | null; expense_account: string | null };
  'acct.document': { company_id: string; id: Generated<string>; doc_type: string; doc_no: string | null;
    status: Generated<'draft' | 'pending_approval' | 'approved' | 'posted' | 'voided'>; issue_date: DateCol; due_date: string | null; contact_id: string | null;
    currency: Generated<string>; price_incl_vat: Generated<boolean>; subtotal: Money; discount: Money; vat: Money; wht: Money; grand_total: Money;
    branch_code: Generated<string>; external_source: string | null; external_ref: string | null; created_at: Ts; updated_at: Ts };
  'acct.document_line': { company_id: string; id: Generated<string>; document_id: string; line_no: number; line_type: Generated<'item' | 'heading' | 'note'>;
    product_code: string | null; description: string; qty: string | null; unit_price: string | null; discount: Money; amount: Money; vat_rate: string | null; account_code: string | null };
  'acct.number_series': { company_id: string; doc_type: string; pattern: string; prefix: string; period_key: string; next_no: Generated<number> };
  'acct.journal': { company_id: string; id: Generated<string>; journal_no: string; journal_date: DateCol; fiscal_year: number; period_no: number;
    book: Generated<string>; description: string | null; source_document_id: string | null; status: Generated<'draft' | 'posted' | 'voided'>;
    reversal_of: string | null; rule_version_id: string | null; posted_at: Date | null; created_at: Ts };
  'acct.journal_line': { company_id: string; id: Generated<string>; journal_id: string; line_no: number; account_code: string; contact_id: string | null;
    debit: Money; credit: Money; branch_code: Generated<string>; project_code: string | null; memo: string | null };
  'acct.audit_log': { company_id: string; id: Generated<string>; at: Ts; actor_id: string | null; action: string; entity: string; entity_id: string;
    before: unknown; after: unknown; prev_hash: Buffer | null; hash: Buffer | null };
}
