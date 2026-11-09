DROP TABLE acct.journal_template;
ALTER TABLE acct.journal DROP COLUMN created_by, DROP COLUMN recurring, DROP COLUMN auto_reverse;
ALTER TABLE acct.account DROP COLUMN binding, DROP COLUMN category;
