// type ของตาราง (เขียนมือ · test schema.test.ts ตรวจว่าตรงกับ DB จริง) · เงินเป็น string เสมอ (NUMERIC → string ใน pg)
import type { ColumnType, Generated } from 'kysely';

type Money = ColumnType<string, string | undefined, string>;
type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type DateCol = ColumnType<string, string, string>; // 'YYYY-MM-DD'

type Json = ColumnType<unknown, string | undefined, string>; // ส่ง JSON.stringify ตอนเขียน

export interface PublicDB {
  'public.organization': { id: Generated<string>; name: string; created_at: Ts; security_policy: ColumnType<{ require_2fa: boolean; session_hours: number }, string | undefined, string> };
  'public.app_user': {
    id: Generated<string>; email: string; display_name: string; password_hash: string | null; mfa_enabled: Generated<boolean>; created_at: Ts;
    email_verified_at: Ts | null; totp_secret_enc: string | null; totp_last_step: ColumnType<string | null, number | null | undefined, number | null>; phone_masked: string | null;
    locale: Generated<'th' | 'en'>; marketing_opt_in: Generated<boolean>; terms_accepted_at: Ts | null; last_login_at: Ts | null; status: Generated<'active' | 'disabled'>;
  };
  'public.company': {
    id: Generated<string>; org_id: string; name_th: string; name_en: string | null; tax_id: string | null; branch_code: Generated<string>;
    business_type: Generated<string>; vat_registered: Generated<boolean>; service_tax_point: Generated<'on_payment' | 'on_invoice'>;
    wht_recognition: Generated<'on_payment' | 'on_invoice'>; fiscal_year_start: Generated<string>; db_dsn: string | null;
    status: Generated<'active' | 'suspended' | 'archived'>; created_at: Ts;
    setup_step: Generated<number>; setup_done: Generated<boolean>; chart_template: Generated<'service' | 'trading' | 'dbd' | 'import'>; modules: Json;
    go_live_date: DateCol | null; created_by: string | null; address: string | null; phone: string | null; email: string | null;
  };
  'public.org_membership': { org_id: string; user_id: string; org_role: 'owner' | 'admin' | 'billing_admin' | 'member' | 'guest'; created_at: Ts; expires_at: DateCol | null };
  'public.company_membership': {
    company_id: string; user_id: string; company_role: string; approval_limit: Money | null; created_at: Ts;
    permissions: ColumnType<Record<string, Record<string, boolean>> | null, string | null | undefined, string | null>; scope: Generated<string>; expires_at: DateCol | null;
    require_2fa: Generated<boolean>; last_used_at: Ts | null;
  };
  'public.invite': {
    id: Generated<string>; org_id: string; company_id: string | null; email: string; role: string; token_hash: string; expires_at: Ts; accepted_at: Ts | null; created_at: Ts;
    kind: Generated<'member' | 'auditor'>; org_role: Generated<'admin' | 'billing_admin' | 'member' | 'guest'>; invited_by: string | null; access_until: DateCol | null;
    revoked_at: Ts | null; declined_at: Ts | null;
  };
  'public.plan': { code: string; name: string; limits: Json };
  'public.subscription': { org_id: string; plan_code: string; status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled'; renews_at: DateCol | null; company_limit: number | null; seat_limit: number | null; trial_ends_at: DateCol | null };
  'public.entitlement': { org_id: string; key: string; value: Json };
  'public.password_history': { user_id: string; password_hash: string; created_at: Ts };
  'public.backup_code': { user_id: string; idx: number; code_hash: string | null; used_at: Ts | null };
  'public.auth_session': {
    id: Generated<string>; family_id: string; user_id: string; token_hash: string; amr: string[]; ip_hash: string | null; user_agent: string | null;
    created_at: Ts; expires_at: Ts; rotated_at: Ts | null; revoked_at: Ts | null; revoke_reason: string | null;
  };
  'public.trusted_device': { id: Generated<string>; user_id: string; label: string | null; created_at: Ts; expires_at: Ts; revoked_at: Ts | null };
  'public.email_token': { id: Generated<string>; user_id: string; purpose: 'verify_email' | 'reset_password'; token_hash: string; attempts: Generated<number>; created_at: Ts; expires_at: Ts; used_at: Ts | null };
  'public.outbox_email': { id: Generated<string>; to_email: string; template: string; payload: Json; created_at: Ts; sent_at: Ts | null };
  'public.doc_share': { token_hash: string; company_id: string; document_id: string; created_at: Ts; expires_at: Ts | null; revoked_at: Ts | null };
  'public.api_client': { id: Generated<string>; company_id: string; name: string; kind: 'tms' | 'mcp' | 'custom'; key_prefix: string; key_hash: string; scopes: string[]; created_by: string | null; created_at: Ts; last_used_at: Ts | null; revoked_at: Ts | null };
  'public.innovera_staff': { user_id: string; role: 'support' | 'engineer' | 'billing' | 'ops' | 'admin'; active: Generated<boolean>; created_at: Ts };
  'public.support_ticket': { id: Generated<string>; number: Generated<number>; org_id: string; company_id: string | null; subject: string; status: Generated<'open' | 'in_progress' | 'waiting_consent' | 'waiting_billing' | 'closed'>;
    assignee: string | null; created_at: Ts; updated_at: Ts; closed_at: Ts | null };
  'public.support_access': { id: Generated<string>; ticket_id: string; company_id: string; requested_by: string; reason: string; scope: string; minutes: number; write_access: Generated<boolean>;
    status: Generated<'pending' | 'approved' | 'denied' | 'active' | 'ended' | 'cancelled'>; decided_by: string | null; decided_at: Ts | null; started_at: Ts | null; ends_at: Ts | null; created_at: Ts };
  'public.feature_flag': { key: string; scope: 'global' | 'org' | 'company'; target_id: string | null; value: ColumnType<unknown, string, string>; updated_by: string | null; updated_at: Ts };
  'public.audit_console': { id: Generated<string>; at: Ts; actor: string; action: string; target_company_id: string | null; reason: string; consent_ref: string | null; actor_user: string | null; access_id: string | null };
  'public.login_event': { id: Generated<string>; at: Ts; user_id: string | null; email: string; event: string; ip_hash: string | null; user_agent: string | null };
}

export type AccountType = 'asset' | 'contra_asset' | 'liability' | 'equity' | 'revenue' | 'contra_revenue' | 'expense';

export interface AcctDB {
  'acct.account': { company_id: string; code: string; name: string; type: AccountType; parent_code: string | null; is_control: Generated<boolean>;
    control_kind: 'ar' | 'ap' | 'deposit_in' | 'deposit_out' | null; requires_contact: Generated<boolean>; active: Generated<boolean>; created_at: Ts; category: string | null; binding: string | null };
  'acct.period': { company_id: string; fiscal_year: number; period_no: number; starts_on: DateCol; ends_on: DateCol;
    status: Generated<'open' | 'soft_closed' | 'hard_closed'>; closed_at: Date | null; closed_by: string | null; accrual_reviewed_at: Generated<Date | null>; accrual_reviewed_by: Generated<string | null> };
  'acct.contact': { company_id: string; id: Generated<string>; code: string; name: string; kind: 'customer' | 'vendor' | 'both' | 'contractor' | 'employee';
    tax_id: string | null; branch_code: string | null; external_source: string | null; external_ref: string | null; created_at: Ts;
    address: string | null; contact_person: string | null; phone: string | null; email: string | null; credit_days: number | null; credit_limit: string | null;
    roles: Generated<string[]>; entity_type: Generated<'juristic' | 'individual' | 'foreign'>; ar_account: Generated<string | null>; ap_account: Generated<string | null>;
    wht_received: Generated<string | null>; pnd_form: Generated<'3' | '53' | null>; price_level: Generated<number>; bank_account: Generated<string | null>; ship_address: Generated<string | null>; default_wht: Generated<string | null> };
  'acct.product': { company_id: string; code: string; name: string; kind: Generated<'service' | 'goods' | 'expense' | 'kit'>; unit: string | null;
    price: string | null; price_2: string | null; vat: Generated<boolean>; revenue_account: string | null; expense_account: string | null;
    price_3: Generated<string | null>; price_4: Generated<string | null>; price_5: Generated<string | null>; vat_code: Generated<'vat7' | 'exempt' | 'zero'>; default_wht: Generated<string | null>; sku: Generated<string | null>;
    est_cost: Generated<string | null>; vat_exempt_reason: Generated<string | null> };
  'acct.document': { company_id: string; id: Generated<string>; doc_type: string; doc_no: string | null;
    status: Generated<'draft' | 'pending_approval' | 'approved' | 'posted' | 'voided'>; issue_date: DateCol; due_date: string | null; contact_id: string | null;
    currency: Generated<string>; price_incl_vat: Generated<boolean>; subtotal: Money; discount: Money; vat: Money; wht: Money; grand_total: Money;
    branch_code: Generated<string>; external_source: string | null; external_ref: string | null; created_at: Ts; updated_at: Ts;
    // M4 (0007)
    rule_code: string | null; tax_mode: 'on_payment' | 'immediate' | null; ref_document_id: string | null; address: string | null; notes: string | null; reference: string | null;
    journal_id: string | null; created_by: string | null; approved_by: string | null; approved_at: Ts | null; voided_at: Ts | null; void_reason: string | null; void_journal_id: string | null;
    receive_account: string | null; fee: Money; fee_account: string | null; wht_cert_no: string | null; wht_rate: string | null; bill_discount: Money; credit_days: number | null; sent_at: Ts | null;
    vendor_ref: string | null; pay_now: Generated<boolean>; batch_ref: string | null; approval_level: Generated<number> ; party_tax_id: Generated<string | null>; vendor_invoice_date: ColumnType<string | null, string | null | undefined, string | null>; project_code: Generated<string | null>;
    salesperson: Generated<string | null>; payment_terms: Generated<string | null>; price_level: Generated<number | null>; print_count: Generated<number>;
    vat_claim_month: Generated<string | null> };
  'acct.wht_certificate': { company_id: string; id: Generated<string>; cert_no: string; payment_id: string; contact_id: string; pnd: '3' | '53'; income_type: string; income_section: string | null;
    pay_date: DateCol; base: string; rate: string; amount: string; pending_auditor: Generated<boolean>; voided: Generated<boolean>; created_at: Ts };
  'acct.bank_account': { company_id: string; id: Generated<string>; gl_account: string; bank_name: string; branch: string | null; account_no: string; account_name: string | null;
    is_default_receive: Generated<boolean>; created_at: Ts };
  'acct.bank_statement_line': { company_id: string; id: Generated<string>; bank_account: string; line_date: DateCol; description: string; amount: string; balance: string | null; ref: string | null;
    import_batch: string; fingerprint: string; matched_journal_id: string | null; match_status: Generated<'unmatched' | 'auto' | 'manual' | 'ignored'>; created_at: Ts };
  'acct.fixed_asset': { company_id: string; id: Generated<string>; code: string; name: string; asset_account: string; accum_account: string; expense_account: string; start_date: DateCol;
    life_years: string; cost: string; salvage: Money; opening_accum: Money; opening_accum_date: DateCol | null; status: Generated<'active' | 'disposed' | 'fully_depreciated'>; disposed_on: DateCol | null;
    source_document_id: string | null; created_at: Ts;
    sale_amount: Generated<string | null>; sale_vat: Generated<string | null>; disposal_contact_id: Generated<string | null>; disposal_ref: Generated<string | null>; disposal_journal_id: Generated<string | null> };
  'acct.tax_filing': { company_id: string; id: Generated<string>; form: 'pp30' | 'pnd3' | 'pnd53'; month: string; seq: Generated<number>; status: Generated<'draft' | 'filed'>;
    filed_at: DateCol | null; filed_by: string | null; reference_no: string | null; amount: Money; output_vat: string | null; input_vat: string | null; carried_in: Money; carry_forward: Money; journal_id: string | null; created_at: Ts };
  'acct.depreciation_run': { company_id: string; fiscal_year: number; period_no: number; journal_id: string; total: string; detail: ColumnType<unknown, string, string>; created_at: Ts };
  'acct.report_format': { company_id: string; id: Generated<string>; name: string; definition: ColumnType<unknown, string, string>; updated_at: Ts };
  'acct.webhook_endpoint': { company_id: string; id: Generated<string>; url: string; secret: string; events: string[]; active: Generated<boolean>; api_client_id: string | null; created_at: Ts };
  'acct.webhook_delivery': { company_id: string; id: Generated<string>; endpoint_id: string; event: string; payload: ColumnType<unknown, string, string>; status: Generated<'pending' | 'sent' | 'dead'>;
    attempts: Generated<number>; next_attempt_at: Generated<Date>; last_error: string | null; created_at: Ts; sent_at: Ts | null };
  'acct.company_setting': { company_id: string; key: string; value: ColumnType<unknown, string, string>; updated_at: Ts };
  'acct.settlement': { company_id: string; id: Generated<string>; payment_id: string; document_id: string; applied: string; wht: Money; wht_base: string | null; vat_due: Money; voided: Generated<boolean>; created_at: Ts };
  'acct.billing_item': { company_id: string; billing_id: string; document_id: string; line_no: number };
  'acct.cheque': { company_id: string; id: Generated<string>; direction: 'received' | 'issued'; cheque_no: string; bank: string; branch: string | null; cheque_date: DateCol; amount: string;
    status: Generated<'on_hand' | 'deposited' | 'cleared' | 'bounced' | 'cancelled' | 'issued' | 'presented'>; document_id: string | null; contact_id: string | null; deposited_on: DateCol | null; cleared_on: DateCol | null; created_at: Ts;
    payer_name: Generated<string | null>; ref_no: Generated<string | null>; bounced_on: ColumnType<string | null, string | null | undefined, string | null>; bounce_reason: Generated<string | null>; journal_ids: Generated<string[]> };
  'acct.document_event': { company_id: string; id: Generated<string>; document_id: string; at: Ts; actor: string | null; event: string; detail: ColumnType<unknown, string | undefined, string> };
  'acct.doc_setting': { company_id: string; doc_type: string; prefix: string; pattern: Generated<string>; reset: Generated<'monthly' | 'yearly' | 'never'>; settings: ColumnType<Record<string, unknown>, string | undefined, string>; updated_at: Ts };
  'acct.document_line': { company_id: string; id: Generated<string>; document_id: string; line_no: number; line_type: Generated<'item' | 'heading' | 'note'>;
    product_code: string | null; description: string; qty: string | null; unit_price: string | null; discount: Money; amount: Money; vat_rate: string | null; account_code: string | null; wht_type: string | null; est_cost: Generated<string | null> };
  'acct.number_series': { company_id: string; doc_type: string; pattern: string; prefix: string; period_key: string; next_no: Generated<number> };
  'acct.journal': { company_id: string; id: Generated<string>; journal_no: string; journal_date: DateCol; fiscal_year: number; period_no: number;
    book: Generated<string>; description: string | null; source_document_id: string | null; status: Generated<'draft' | 'posted' | 'voided'>;
    reversal_of: string | null; rule_version_id: string | null; posted_at: Date | null; created_at: Ts;
    auto_reverse: Generated<boolean>; recurring: 'monthly_last_day' | null; created_by: string | null };
  'acct.journal_template': { company_id: string; id: Generated<string>; name: string; book: Generated<string>; description: string | null; lines: unknown; created_at: Ts };
  'acct.journal_line': { company_id: string; id: Generated<string>; journal_id: string; line_no: number; account_code: string; contact_id: string | null;
    debit: Money; credit: Money; branch_code: Generated<string>; project_code: string | null; memo: string | null };
  'acct.posting_rule': { company_id: string; id: Generated<string>; code: string; doc_type: string; name: string; active: Generated<boolean> };
  'acct.posting_rule_version': { company_id: string; id: Generated<string>; rule_id: string; version: number; definition: unknown; created_at: Ts };
  'acct.audit_log': { company_id: string; id: Generated<string>; at: Ts; actor_id: string | null; action: string; entity: string; entity_id: string;
    before: unknown; after: unknown; prev_hash: Buffer | null; hash: Buffer | null };
}
