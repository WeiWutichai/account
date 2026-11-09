DROP TABLE acct.bank_account;
ALTER TABLE acct.document_line DROP COLUMN est_cost;
ALTER TABLE acct.document DROP COLUMN print_count, DROP COLUMN price_level, DROP COLUMN payment_terms, DROP COLUMN salesperson;
ALTER TABLE acct.product DROP COLUMN vat_exempt_reason, DROP COLUMN est_cost;
ALTER TABLE acct.contact DROP COLUMN default_wht;
