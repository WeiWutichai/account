-- กลุ่ม D: สายอนุมัติจ่าย · กระทบยอดธนาคาร 1 ต่อหลาย + ปิดกระทบยอด · เงินสดย่อยหลายกอง + ตรวจนับ · ปิด PO
-- (ScreenPayment · ScreenBankRecon · ScreenPettyCash · ScreenPurchaseOrder) · ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant

-- จับคู่ statement ↔ journal แบบ 1 ต่อหลาย (เช่น BULK 895,500.00 ↔ PV2611-0031 + 0032 + 0033)
-- matched_journal_id ใน bank_statement_line ยังคงอยู่ (= journal แรก) เพื่อความเข้ากันได้
ALTER TABLE acct.bank_statement_line ADD CONSTRAINT bank_statement_line_company_id_id UNIQUE (company_id, id);
CREATE TABLE acct.bank_match (
  company_id uuid NOT NULL REFERENCES public.company(id),
  statement_line_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, statement_line_id, journal_id),
  FOREIGN KEY (company_id, statement_line_id) REFERENCES acct.bank_statement_line(company_id, id),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id)
);
CREATE INDEX bank_match_journal ON acct.bank_match (company_id, journal_id);
INSERT INTO acct.bank_match (company_id, statement_line_id, journal_id)
  SELECT company_id, id, matched_journal_id FROM acct.bank_statement_line WHERE matched_journal_id IS NOT NULL;

-- ปิดกระทบยอดรายเดือน: ล็อกรายการธนาคารของเดือน (จับคู่/ยกเลิกจับคู่/นำเข้าไม่ได้)
CREATE TABLE acct.bank_recon_close (
  company_id uuid NOT NULL REFERENCES public.company(id),
  bank_account text NOT NULL,
  month date NOT NULL CHECK (extract(day FROM month) = 1),   -- วันแรกของเดือน
  statement_balance numeric(18,2) NOT NULL,
  gl_balance numeric(18,2) NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  PRIMARY KEY (company_id, bank_account, month),
  FOREIGN KEY (company_id, bank_account) REFERENCES acct.account(company_id, code)
);

-- กองเงินสดย่อย (imprest) หลายกอง · กองตั้งต้น (is_default) รับรายการ PC เดิมที่ไม่ระบุกอง
CREATE TABLE acct.petty_cash_fund (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  holder text,
  imprest numeric(18,2) NOT NULL CHECK (imprest > 0),
  gl_account text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, gl_account) REFERENCES acct.account(company_id, code)
);
CREATE UNIQUE INDEX petty_cash_fund_default ON acct.petty_cash_fund (company_id) WHERE is_default;

-- ตรวจนับกอง ("นับเงิน / ตรวจกอง") · ผลต่าง = เงินสดนับได้ + ใบสำคัญจ่าย − วงเงิน
CREATE TABLE acct.petty_cash_count (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id uuid NOT NULL,
  count_date date NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  counted_by uuid,
  counted_by_name text,
  cash_counted numeric(18,2) NOT NULL CHECK (cash_counted >= 0),
  vouchers numeric(18,2) NOT NULL CHECK (vouchers >= 0),
  imprest numeric(18,2) NOT NULL,
  difference numeric(18,2) NOT NULL,
  note text,
  FOREIGN KEY (company_id, fund_id) REFERENCES acct.petty_cash_fund(company_id, id)
);
CREATE INDEX petty_cash_count_fund ON acct.petty_cash_count (company_id, fund_id, counted_at);

-- รายการเงินสดย่อย (PC) ระบุกอง · ว่าง = กองตั้งต้น
-- PO ปิด (รับบิลครบ / กดปิดเอง)
ALTER TABLE acct.document
  ADD COLUMN petty_cash_fund_id uuid,
  ADD COLUMN closed_at timestamptz,
  ADD CONSTRAINT document_petty_cash_fund FOREIGN KEY (company_id, petty_cash_fund_id) REFERENCES acct.petty_cash_fund(company_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_match', 'bank_recon_close', 'petty_cash_fund', 'petty_cash_count'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
-- ยกเลิกจับคู่ (เดือนที่ยังไม่ปิด) = ลบแถวจับคู่
GRANT DELETE ON acct.bank_match TO app;
