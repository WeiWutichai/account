-- กลุ่ม B: ข้อมูลคู่ค้า/สินค้า/เอกสารในฟอร์ม + ทะเบียนบัญชีธนาคารของบริษัท + แบบพิมพ์
-- contact.default_wht = ประเภทเงินได้ตั้งต้นของผู้ขาย (คีย์ WHT_TYPES ใน @innovera/tax-th · ScreenPurchaseBill "WHT ตั้งต้น")
ALTER TABLE acct.contact ADD COLUMN default_wht text;

-- product.est_cost = ต้นทุนประมาณต่อหน่วย (ScreenQuote "ต้นทุนประมาณ / กำไรขั้นต้น") · vat_exempt_reason = เหตุยกเว้น VAT ใต้รายการ (PrintReceiptNoVat)
ALTER TABLE acct.product
  ADD COLUMN est_cost numeric(18,4) CHECK (est_cost >= 0),
  ADD COLUMN vat_exempt_reason text;

-- ใบเสนอราคา: พนักงานขาย · เงื่อนไขชำระ · ระดับราคา (project_code มีแล้วใน 0015)
-- print_count = จำนวนครั้งที่พิมพ์ต้นฉบับแล้ว (ครั้งถัดไปเป็นสำเนา)
ALTER TABLE acct.document
  ADD COLUMN salesperson text,
  ADD COLUMN payment_terms text,
  ADD COLUMN price_level smallint CHECK (price_level BETWEEN 1 AND 5),
  ADD COLUMN print_count integer NOT NULL DEFAULT 0 CHECK (print_count >= 0);

-- ต้นทุนประมาณรวมของบรรทัด (บรรทัดที่ไม่มีรหัสสินค้า เช่น ของแถม ก็มีต้นทุนได้ — fixtures QO2611-0014)
ALTER TABLE acct.document_line ADD COLUMN est_cost numeric(18,2) CHECK (est_cost >= 0);

-- ทะเบียนบัญชีธนาคารของบริษัท (ผูกกับบัญชี GL) — แบบพิมพ์ "โอนเข้าบัญชี [ธนาคาร A] เลขที่ … ชื่อบัญชี …"
CREATE TABLE acct.bank_account (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gl_account text NOT NULL,
  bank_name text NOT NULL,
  branch text,
  account_no text NOT NULL,
  account_name text,                                -- ว่าง = ชื่อบริษัท
  is_default_receive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, gl_account),
  FOREIGN KEY (company_id, gl_account) REFERENCES acct.account(company_id, code)
);
-- บัญชีรับโอนตั้งต้นได้บัญชีเดียวต่อบริษัท
CREATE UNIQUE INDEX bank_account_default_receive ON acct.bank_account (company_id) WHERE is_default_receive;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_account'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
