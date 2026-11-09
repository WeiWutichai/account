-- กลุ่ม C: สถานะการยื่นแบบ (ScreenTax · ScreenPeriodClose · Sidebar) · ภาษีซื้อข้ามเดือน ม.82/3 · ขายทรัพย์สิน (ScreenAssets) · ทบทวนค้างรับ–ค้างจ่ายต่องวด
-- ตารางใหม่: company_id + RLS ENABLE/FORCE + policy tenant (แบบ 0010) · index ขึ้นต้นด้วย company_id
CREATE TABLE acct.tax_filing (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  form text NOT NULL CHECK (form IN ('pp30', 'pnd3', 'pnd53')),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- เดือนภาษี (ค.ศ.) YYYY-MM
  seq int NOT NULL DEFAULT 0 CHECK (seq >= 0),                         -- 0 = ยื่นปกติ · 1, 2 … = ยื่นเพิ่มเติม ครั้งที่
  status text NOT NULL DEFAULT 'filed' CHECK (status IN ('draft', 'filed')),
  filed_at date,
  filed_by uuid,
  reference_no text,                                                    -- เลขอ้างอิงการยื่น/ชำระของกรมสรรพากร
  amount numeric(18,2) NOT NULL DEFAULT 0,                              -- ภาษีที่ชำระ (ภ.พ.30 ข้อ 11 · ภ.ง.ด. ยอดภาษี)
  output_vat numeric(18,2),                                             -- ภ.พ.30: ยอดที่ล้างบัญชีในการยื่นครั้งนี้
  input_vat numeric(18,2),
  carried_in numeric(18,2) NOT NULL DEFAULT 0,                          -- ภาษีชำระเกินยกมาที่ใช้ในเดือนนี้ (ข้อ 10)
  carry_forward numeric(18,2) NOT NULL DEFAULT 0,                       -- ภาษีชำระเกินยกไปเดือนถัดไป (ไม่ขอคืน)
  journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, form, month, seq),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id)
);

-- ม.82/3: ใช้สิทธิ์ภาษีซื้อในเดือนอื่นได้ไม่เกิน 6 เดือนนับจากเดือนที่ออกใบกำกับ · ว่าง = เดือนตามบิล
ALTER TABLE acct.document ADD COLUMN vat_claim_month text CHECK (vat_claim_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- ขาย/จำหน่ายทรัพย์สิน (ScreenAssets "ขาย FA-0003")
ALTER TABLE acct.fixed_asset
  ADD COLUMN sale_amount numeric(18,2),
  ADD COLUMN sale_vat numeric(18,2),
  ADD COLUMN disposal_contact_id uuid,
  ADD COLUMN disposal_ref text,
  ADD COLUMN disposal_journal_id uuid,
  ADD CONSTRAINT fixed_asset_disposal_journal_fk FOREIGN KEY (company_id, disposal_journal_id) REFERENCES acct.journal(company_id, id);

-- ScreenPeriodClose "รายการปรับปรุงค้างรับ–ค้างจ่าย (accrual) ทบทวนแล้ว — ยืนยันทบทวนแล้ว"
ALTER TABLE acct.period ADD COLUMN accrual_reviewed_at timestamptz, ADD COLUMN accrual_reviewed_by uuid;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_filing'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
