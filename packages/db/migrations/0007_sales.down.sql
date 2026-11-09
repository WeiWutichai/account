DROP TABLE public.doc_share;
DROP TABLE acct.doc_setting;
DROP TABLE acct.document_event;
DROP TABLE acct.cheque;
DROP TABLE acct.billing_item;
DROP TABLE acct.settlement;
DROP INDEX acct.document_contact_idx;
DROP INDEX acct.document_ref_idx;
ALTER TABLE acct.document DROP CONSTRAINT document_journal, DROP CONSTRAINT document_ref,
  DROP COLUMN sent_at, DROP COLUMN credit_days, DROP COLUMN bill_discount, DROP COLUMN wht_rate, DROP COLUMN wht_cert_no,
  DROP COLUMN fee_account, DROP COLUMN fee, DROP COLUMN receive_account, DROP COLUMN void_journal_id, DROP COLUMN void_reason, DROP COLUMN voided_at,
  DROP COLUMN approved_at, DROP COLUMN approved_by, DROP COLUMN created_by, DROP COLUMN journal_id, DROP COLUMN reference, DROP COLUMN notes, DROP COLUMN address,
  DROP COLUMN ref_document_id, DROP COLUMN tax_mode, DROP COLUMN rule_code;
