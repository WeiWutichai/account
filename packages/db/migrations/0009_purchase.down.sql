DROP TABLE acct.company_setting;
DROP TABLE acct.wht_certificate;
DROP INDEX acct.document_batch;
ALTER TABLE acct.document DROP COLUMN approval_level, DROP COLUMN batch_ref, DROP COLUMN pay_now, DROP COLUMN vendor_ref;
ALTER TABLE acct.document_line DROP COLUMN wht_type;
