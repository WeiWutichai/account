-- ย้อน 0019: matched_journal_id ยังเก็บ journal แรกของแต่ละรายการไว้แล้ว (การจับคู่ 1 ต่อหลายเหลือ journal แรก)
ALTER TABLE acct.document DROP CONSTRAINT document_petty_cash_fund, DROP COLUMN closed_at, DROP COLUMN petty_cash_fund_id;
DROP TABLE acct.petty_cash_count;
DROP TABLE acct.petty_cash_fund;
DROP TABLE acct.bank_recon_close;
DROP TABLE acct.bank_match;
ALTER TABLE acct.bank_statement_line DROP CONSTRAINT bank_statement_line_company_id_id;
