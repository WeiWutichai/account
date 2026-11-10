-- ย้อน 0021: ข้อมูลสกุลต่างประเทศ/สาขาหายทั้งหมด (เอกสารสกุลต่างประเทศเหลือยอดสกุลเดิมโดยไม่มีอัตรา)
ALTER TABLE acct.journal_line DROP CONSTRAINT journal_line_fx_pair, DROP COLUMN amount_fx, DROP COLUMN currency;
ALTER TABLE acct.settlement DROP COLUMN vat_due_thb, DROP COLUMN settled_thb;
ALTER TABLE acct.document DROP COLUMN base_thb, DROP COLUMN vat_thb, DROP COLUMN grand_total_thb, DROP COLUMN fx_rate;
DROP TABLE acct.fx_revaluation;
DROP TABLE acct.branch;
DROP TABLE acct.exchange_rate;
DROP TABLE acct.currency;
