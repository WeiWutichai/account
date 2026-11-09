DROP TRIGGER contact_default_roles ON acct.contact;
DROP FUNCTION acct.contact_default_roles();
ALTER TABLE acct.cheque DROP COLUMN journal_ids, DROP COLUMN bounce_reason, DROP COLUMN bounced_on, DROP COLUMN ref_no, DROP COLUMN payer_name;
ALTER TABLE acct.product DROP COLUMN sku, DROP COLUMN default_wht, DROP COLUMN vat_code, DROP COLUMN price_5, DROP COLUMN price_4, DROP COLUMN price_3;
ALTER TABLE acct.contact DROP CONSTRAINT contact_roles, DROP CONSTRAINT contact_ap_account, DROP CONSTRAINT contact_ar_account,
  DROP COLUMN ship_address, DROP COLUMN bank_account, DROP COLUMN price_level, DROP COLUMN pnd_form, DROP COLUMN wht_received,
  DROP COLUMN ap_account, DROP COLUMN ar_account, DROP COLUMN entity_type, DROP COLUMN roles;
