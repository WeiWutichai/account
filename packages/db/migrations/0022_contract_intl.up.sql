-- Phase 2A กลุ่ม SWT (docs/technical-plan-P2A.md "SWT"): สัญญา/รายได้รับล่วงหน้า · ภ.พ.36 / ภ.ง.ด.54 · สินทรัพย์ไม่มีตัวตน
-- ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant · index ขึ้นต้น company_id · ย้อนได้ (0022_contract_intl.down.sql)

ALTER TABLE acct.document_line ADD CONSTRAINT document_line_company_id_id UNIQUE (company_id, id);

-- สัญญาลูกค้า · รอบบิล monthly/quarterly/annual (annual = เก็บล่วงหน้าทั้งปี) · ต่ออายุอัตโนมัติ
CREATE TABLE acct.contract (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  contact_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  auto_renew boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'cancelled', 'ended')),
  cancelled_on date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, contact_id) REFERENCES acct.contact(company_id, id)
);
CREATE INDEX contract_contact ON acct.contract (company_id, contact_id);

-- บรรทัดสัญญา (ภาระที่ต้องปฏิบัติ) · amount = ยอดต่อรอบบิล (subscription/support) หรือยอดรวมครั้งเดียว (license/implementation)
-- usage: unit_price × ปริมาณใช้งานจริง (usage_record) · recognition: point_in_time | ratably | milestone
CREATE TABLE acct.contract_line (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id uuid NOT NULL,
  line_no int NOT NULL CHECK (line_no > 0),
  kind text NOT NULL CHECK (kind IN ('license', 'subscription', 'support', 'implementation', 'usage')),
  recognition text NOT NULL CHECK (recognition IN ('point_in_time', 'ratably', 'milestone')),
  description text NOT NULL,
  product_code text,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  unit_price numeric(18,4),
  usage_unit text,
  vat boolean NOT NULL DEFAULT true,
  revenue_account text,
  start_date date,
  end_date date,
  milestone_done_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'usage' OR unit_price IS NOT NULL),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  UNIQUE (company_id, contract_id, line_no),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, contract_id) REFERENCES acct.contract(company_id, id),
  FOREIGN KEY (company_id, revenue_account) REFERENCES acct.account(company_id, code)
);

-- ใบแจ้งหนี้ที่สร้างจากรอบบิล: สัญญา + วันเริ่มรอบ (1 ใบต่อสัญญาต่อรอบ ไม่นับใบที่ยกเลิก) · บรรทัดผูกบรรทัดสัญญา + ช่วงบริการ
ALTER TABLE acct.document
  ADD COLUMN contract_id uuid,
  ADD COLUMN contract_period_start date,
  ADD CONSTRAINT document_contract FOREIGN KEY (company_id, contract_id) REFERENCES acct.contract(company_id, id);
CREATE UNIQUE INDEX document_contract_period ON acct.document (company_id, contract_id, contract_period_start)
  WHERE contract_id IS NOT NULL AND status <> 'voided';
ALTER TABLE acct.document_line
  ADD COLUMN contract_line_id uuid,
  ADD COLUMN service_from date,
  ADD COLUMN service_to date,
  ADD CONSTRAINT document_line_contract_line FOREIGN KEY (company_id, contract_line_id) REFERENCES acct.contract_line(company_id, id);
CREATE INDEX document_line_contract_line ON acct.document_line (company_id, contract_line_id) WHERE contract_line_id IS NOT NULL;

-- ตารางรับรู้รายได้ (รายเดือน pro-rate ตามวัน) ต่อบรรทัด IV ที่รับรู้ตามช่วงเวลา · journal_id = JV รับรู้ (null = ยังไม่รับรู้)
CREATE TABLE acct.revenue_schedule (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_line_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_line_id uuid NOT NULL,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  days int NOT NULL CHECK (days > 0),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  revenue_account text NOT NULL,
  journal_id uuid,
  voided boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_line_id, period),
  FOREIGN KEY (company_id, contract_line_id) REFERENCES acct.contract_line(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, document_line_id) REFERENCES acct.document_line(company_id, id),
  FOREIGN KEY (company_id, revenue_account) REFERENCES acct.account(company_id, code),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id)
);
CREATE INDEX revenue_schedule_period ON acct.revenue_schedule (company_id, period) WHERE NOT voided;
CREATE INDEX revenue_schedule_document ON acct.revenue_schedule (company_id, document_id);
CREATE INDEX revenue_schedule_journal ON acct.revenue_schedule (company_id, journal_id) WHERE journal_id IS NOT NULL;

-- รันรับรู้รายได้รายงวด (เหมือน depreciation_run · ครั้งเดียวต่องวด · ยกเลิกได้ด้วย reversal)
CREATE TABLE acct.revenue_recognition_run (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fiscal_year int NOT NULL,
  period_no int NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  journal_id uuid NOT NULL,
  total numeric(18,2) NOT NULL,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id)
);
CREATE UNIQUE INDEX revenue_recognition_run_once ON acct.revenue_recognition_run (company_id, fiscal_year, period_no) WHERE voided_at IS NULL;

-- ยอดใช้งาน (usage-based) · รับผ่าน API ภายนอกเป็นข้อมูลร่าง (idempotent ด้วย external_source + external_ref)
CREATE TABLE acct.usage_record (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_line_id uuid NOT NULL,
  usage_date date NOT NULL,
  qty numeric(18,4) NOT NULL CHECK (qty >= 0),
  external_source text,
  external_ref text,
  document_id uuid,
  created_by_client uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, contract_line_id) REFERENCES acct.contract_line(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id)
);
CREATE UNIQUE INDEX usage_record_external ON acct.usage_record (company_id, external_source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX usage_record_line ON acct.usage_record (company_id, contract_line_id, usage_date);

-- ภ.พ.36: VAT ที่นำส่งแทนผู้ให้บริการต่างประเทศ ณ วันที่จ่าย (1 แถวต่อบิลต่อการจ่าย) · filing_id = ยื่นแล้ว
CREATE TABLE acct.pp36_entry (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  pay_date date NOT NULL,
  base numeric(18,2) NOT NULL CHECK (base >= 0),
  rate numeric(7,4) NOT NULL,
  vat numeric(18,2) NOT NULL CHECK (vat >= 0),
  filing_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, payment_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, bill_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, contact_id) REFERENCES acct.contact(company_id, id)
);
CREATE INDEX pp36_entry_month ON acct.pp36_entry (company_id, pay_date);
CREATE INDEX pp36_entry_payment ON acct.pp36_entry (company_id, payment_id);

-- ภ.ง.ด.54: ประเทศของผู้รับเงิน (ISO 3166-1 alpha-2) สำหรับอัตราตามอนุสัญญา · 50 ทวิ แบบ 54 + อนุสัญญา/ออกภาษีแทน
ALTER TABLE acct.contact ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE acct.wht_certificate DROP CONSTRAINT wht_certificate_pnd_check,
  ADD CONSTRAINT wht_certificate_pnd_check CHECK (pnd IN ('3', '53', '54')),
  ADD COLUMN country text,
  ADD COLUMN treaty boolean NOT NULL DEFAULT false,
  ADD COLUMN gross_up boolean NOT NULL DEFAULT false;
ALTER TABLE acct.tax_filing DROP CONSTRAINT tax_filing_form_check,
  ADD CONSTRAINT tax_filing_form_check CHECK (form IN ('pp30', 'pnd3', 'pnd53', 'pp36', 'pnd54'));
ALTER TABLE acct.pp36_entry ADD CONSTRAINT pp36_entry_filing FOREIGN KEY (filing_id) REFERENCES acct.tax_filing(id);

-- สินทรัพย์ไม่มีตัวตน (ตัดจำหน่ายด้วย runDepreciation เดิม) · origin: ซื้อมา / พัฒนาเอง (asset.intangible.capitalize_dev)
ALTER TABLE acct.fixed_asset
  ADD COLUMN kind text NOT NULL DEFAULT 'tangible' CHECK (kind IN ('tangible', 'intangible')),
  ADD COLUMN intangible_origin text CHECK (intangible_origin IN ('purchased', 'internal_dev'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract', 'contract_line', 'revenue_schedule', 'revenue_recognition_run', 'usage_record', 'pp36_entry'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
-- บรรทัดสัญญาที่ยังไม่ถูกออกใบแจ้งหนี้แก้/ลบได้
GRANT DELETE ON acct.contract_line TO app;
