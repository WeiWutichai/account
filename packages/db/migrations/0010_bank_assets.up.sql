-- M6 ธนาคาร + ทรัพย์สิน + รูปแบบงบ · ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant
CREATE TABLE acct.bank_statement_line (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_account text NOT NULL,                       -- รหัสบัญชี GL ของบัญชีธนาคาร (1100100 …)
  line_date date NOT NULL,
  description text NOT NULL,
  amount numeric(18,2) NOT NULL,                    -- + เข้า / − ออก
  balance numeric(18,2),
  ref text,
  import_batch text NOT NULL,
  fingerprint text NOT NULL,                        -- กันนำเข้าซ้ำ (วันที่|ยอด|รายละเอียด|ลำดับ)
  matched_journal_id uuid,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'auto', 'manual', 'ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, bank_account, fingerprint),
  FOREIGN KEY (company_id, bank_account) REFERENCES acct.account(company_id, code),
  FOREIGN KEY (company_id, matched_journal_id) REFERENCES acct.journal(company_id, id)
);
CREATE INDEX bank_statement_line_date ON acct.bank_statement_line (company_id, bank_account, line_date);

CREATE TABLE acct.fixed_asset (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  asset_account text NOT NULL,
  accum_account text NOT NULL,
  expense_account text NOT NULL,
  start_date date NOT NULL,
  life_years numeric(5,2) NOT NULL CHECK (life_years > 0),
  cost numeric(18,2) NOT NULL CHECK (cost > 0),
  salvage numeric(18,2) NOT NULL DEFAULT 1,
  opening_accum numeric(18,2) NOT NULL DEFAULT 0,  -- ค่าเสื่อมสะสมยกมา (ทะเบียนจากระบบเดิม)
  opening_accum_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed', 'fully_depreciated')),
  disposed_on date,
  source_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, asset_account) REFERENCES acct.account(company_id, code),
  FOREIGN KEY (company_id, accum_account) REFERENCES acct.account(company_id, code),
  FOREIGN KEY (company_id, expense_account) REFERENCES acct.account(company_id, code)
);

CREATE TABLE acct.depreciation_run (
  company_id uuid NOT NULL REFERENCES public.company(id),
  fiscal_year int NOT NULL,
  period_no int NOT NULL,
  journal_id uuid NOT NULL,
  total numeric(18,2) NOT NULL,
  detail jsonb NOT NULL,                            -- [{asset, amount}]
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, fiscal_year, period_no),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id)
);

CREATE TABLE acct.report_format (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  definition jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_statement_line', 'fixed_asset', 'depreciation_run', 'report_format'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
