-- M5 ซื้อ + จ่ายเงิน · ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant
ALTER TABLE acct.document_line ADD COLUMN wht_type text;            -- ประเภทเงินได้ (fixtures wht_rates) · หักตอนจ่ายจริง
ALTER TABLE acct.document
  ADD COLUMN vendor_ref text,                                        -- เลขที่ใบกำกับ/ใบแจ้งหนี้ของผู้ขาย
  ADD COLUMN pay_now boolean NOT NULL DEFAULT false,                 -- EXP จ่ายทันที
  ADD COLUMN batch_ref text,                                         -- รอบจ่าย (PAYRUN-…)
  ADD COLUMN approval_level smallint NOT NULL DEFAULT 0;             -- ระดับที่อนุมัติแล้ว (สายอนุมัติจ่าย)
CREATE INDEX document_batch ON acct.document (company_id, batch_ref) WHERE batch_ref IS NOT NULL;

-- หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ที่บริษัทออก · เข้า ภ.ง.ด.3/53 เดือนที่จ่าย
CREATE TABLE acct.wht_certificate (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cert_no text NOT NULL,
  payment_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  pnd text NOT NULL CHECK (pnd IN ('3', '53')),
  income_type text NOT NULL,
  income_section text,
  pay_date date NOT NULL,
  base numeric(18,2) NOT NULL,
  rate numeric(7,4) NOT NULL,
  amount numeric(18,2) NOT NULL,
  pending_auditor boolean NOT NULL DEFAULT false,                   -- ใช้ค่าตั้งต้นชั่วคราว "รอยืนยัน" (CLAUDE.md)
  voided boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cert_no),
  FOREIGN KEY (company_id, payment_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, contact_id) REFERENCES acct.contact(company_id, id)
);
CREATE INDEX wht_certificate_month ON acct.wht_certificate (company_id, pay_date, pnd);

-- ค่าตั้งของบริษัท (key → jsonb) เช่น tax.wht.freelance_software_dev, tax.filing.online_extension (รอผู้สอบบัญชี — ทำเป็น config)
CREATE TABLE acct.company_setting (
  company_id uuid NOT NULL REFERENCES public.company(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wht_certificate', 'company_setting'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
