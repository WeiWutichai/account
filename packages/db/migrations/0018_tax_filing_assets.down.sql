ALTER TABLE acct.period DROP COLUMN accrual_reviewed_by, DROP COLUMN accrual_reviewed_at;
ALTER TABLE acct.fixed_asset DROP CONSTRAINT fixed_asset_disposal_journal_fk,
  DROP COLUMN disposal_journal_id, DROP COLUMN disposal_ref, DROP COLUMN disposal_contact_id, DROP COLUMN sale_vat, DROP COLUMN sale_amount;
ALTER TABLE acct.document DROP COLUMN vat_claim_month;
DROP TABLE acct.tax_filing;
