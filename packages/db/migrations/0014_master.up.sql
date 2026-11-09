-- ข้อมูลหลักตามแบบร่าง: ScreenContacts (แท็บ "สำหรับนักบัญชี") · ScreenProducts (ราคา 1–5 รหัสภาษี WHT SKU) · ScreenCheque (สถานะ + เหตุผลเช็คคืน)
ALTER TABLE acct.contact
  ADD COLUMN roles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN entity_type text NOT NULL DEFAULT 'juristic' CHECK (entity_type IN ('juristic', 'individual', 'foreign')),
  ADD COLUMN ar_account text,
  ADD COLUMN ap_account text,
  ADD COLUMN wht_received text,
  ADD COLUMN pnd_form text CHECK (pnd_form IN ('3', '53')),
  ADD COLUMN price_level smallint NOT NULL DEFAULT 1 CHECK (price_level BETWEEN 1 AND 5),
  ADD COLUMN bank_account text,
  ADD COLUMN ship_address text,
  ADD CONSTRAINT contact_ar_account FOREIGN KEY (company_id, ar_account) REFERENCES acct.account(company_id, code),
  ADD CONSTRAINT contact_ap_account FOREIGN KEY (company_id, ap_account) REFERENCES acct.account(company_id, code),
  ADD CONSTRAINT contact_roles CHECK (roles <@ ARRAY['customer', 'vendor', 'contractor', 'employee']::text[]);
-- ตั้งบทบาทจาก kind เดิม (both = ลูกค้า + ผู้ขาย)
UPDATE acct.contact SET roles = CASE kind WHEN 'both' THEN ARRAY['customer', 'vendor'] ELSE ARRAY[kind] END;

ALTER TABLE acct.product
  ADD COLUMN price_3 numeric(18,4),
  ADD COLUMN price_4 numeric(18,4),
  ADD COLUMN price_5 numeric(18,4),
  ADD COLUMN vat_code text NOT NULL DEFAULT 'vat7' CHECK (vat_code IN ('vat7', 'exempt', 'zero')),
  ADD COLUMN default_wht text,
  ADD COLUMN sku text;
UPDATE acct.product SET vat_code = CASE WHEN vat THEN 'vat7' ELSE 'exempt' END;

ALTER TABLE acct.cheque
  ADD COLUMN payer_name text,
  ADD COLUMN ref_no text,
  ADD COLUMN bounced_on date,
  ADD COLUMN bounce_reason text,
  ADD COLUMN journal_ids uuid[] NOT NULL DEFAULT '{}';

-- คู่ค้าที่สร้างจากที่อื่น (seed / import / API ภายนอก) ไม่ได้ระบุบทบาท → ใช้ตาม kind
CREATE FUNCTION acct.contact_default_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    NEW.roles := CASE NEW.kind WHEN 'both' THEN ARRAY['customer', 'vendor'] ELSE ARRAY[NEW.kind] END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contact_default_roles BEFORE INSERT ON acct.contact FOR EACH ROW EXECUTE FUNCTION acct.contact_default_roles();
