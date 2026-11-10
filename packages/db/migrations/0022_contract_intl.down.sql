-- ย้อน 0022: ต้องไม่มี 50 ทวิ แบบ 54 / การยื่น ภ.พ.36 · ภ.ง.ด.54 ค้างอยู่ (CHECK เดิมจะไม่ผ่าน — ตั้งใจไม่ลบข้อมูลภาษีเอง)
ALTER TABLE acct.fixed_asset DROP COLUMN intangible_origin, DROP COLUMN kind;
ALTER TABLE acct.pp36_entry DROP CONSTRAINT pp36_entry_filing;
ALTER TABLE acct.tax_filing DROP CONSTRAINT tax_filing_form_check,
  ADD CONSTRAINT tax_filing_form_check CHECK (form IN ('pp30', 'pnd3', 'pnd53'));
ALTER TABLE acct.wht_certificate DROP COLUMN gross_up, DROP COLUMN treaty, DROP COLUMN country,
  DROP CONSTRAINT wht_certificate_pnd_check,
  ADD CONSTRAINT wht_certificate_pnd_check CHECK (pnd IN ('3', '53'));
ALTER TABLE acct.contact DROP COLUMN country;
DROP TABLE acct.pp36_entry;
DROP TABLE acct.usage_record;
DROP TABLE acct.revenue_recognition_run;
DROP TABLE acct.revenue_schedule;
ALTER TABLE acct.document_line DROP CONSTRAINT document_line_contract_line, DROP COLUMN service_to, DROP COLUMN service_from, DROP COLUMN contract_line_id;
DROP INDEX acct.document_contract_period;
ALTER TABLE acct.document DROP CONSTRAINT document_contract, DROP COLUMN contract_period_start, DROP COLUMN contract_id;
DROP TABLE acct.contract_line;
DROP TABLE acct.contract;
ALTER TABLE acct.document_line DROP CONSTRAINT document_line_company_id_id;
