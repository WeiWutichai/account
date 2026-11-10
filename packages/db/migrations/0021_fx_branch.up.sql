-- Phase 2A กลุ่ม FXB: หลายสกุลเงิน + สาขา (docs/technical-plan-P2A.md "FXB")
-- ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant · index ขึ้นต้น company_id · ย้อนได้ (0021_fx_branch.down.sql)
-- คอลัมน์ใหม่บนตารางเดิมเป็น NULL ได้ทั้งหมด → บริษัทที่ใช้บาทอย่างเดียว/ปิดโมดูล = ข้อมูลเดิมไม่เปลี่ยน (Phase 1)

-- สกุลเงินที่บริษัทใช้ (THB = สกุลหลัก ไม่ต้องมีแถว)
CREATE TABLE acct.currency (
  company_id uuid NOT NULL REFERENCES public.company(id),
  code char(3) NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
  name text NOT NULL,
  decimals smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, code)
);

-- อัตราแลกเปลี่ยนรายวัน (บาทต่อ 1 หน่วยสกุลต่างประเทศ) · กรอกเอง (ไม่ดึงจากภายนอก) · แหล่ง = อัตราของ ธปท. ที่กรอก
CREATE TABLE acct.exchange_rate (
  company_id uuid NOT NULL REFERENCES public.company(id),
  currency char(3) NOT NULL,
  rate_date date NOT NULL,
  source text NOT NULL DEFAULT 'bot_mid' CHECK (source IN ('bot_mid', 'bot_buy', 'bot_sell')),
  rate numeric(18,6) NOT NULL CHECK (rate > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (company_id, currency, rate_date, source),
  FOREIGN KEY (company_id, currency) REFERENCES acct.currency(company_id, code)
);

-- ทะเบียนสาขา (รหัส 5 หลักตามกรมสรรพากร · 00000 = สำนักงานใหญ่)
CREATE TABLE acct.branch (
  company_id uuid NOT NULL REFERENCES public.company(id),
  code text NOT NULL CHECK (code ~ '^[0-9]{5}$'),
  name text NOT NULL,
  address text,
  tax_id text,                                    -- เลขผู้เสียภาษีที่ใช้ในแบบของสาขา (ปกติ = เลขของบริษัท)
  files_separately boolean NOT NULL DEFAULT true, -- ยื่น ภ.พ.30 แยกสาขานี้ (ใช้เมื่อ branch.vat_filing = separate)
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, code)
);

-- ปรับมูลค่าลูกหนี้/เจ้าหนี้สกุลต่างประเทศสิ้นงวด (ยังไม่เกิดขึ้นจริง) — รันได้ครั้งเดียวต่องวด · กลับรายการวันแรกของงวดถัดไป
CREATE TABLE acct.fx_revaluation (
  company_id uuid NOT NULL REFERENCES public.company(id),
  fiscal_year int NOT NULL,
  period_no smallint NOT NULL,
  rate_date date NOT NULL,
  journal_id uuid,
  reversal_journal_id uuid,
  total numeric(18,2) NOT NULL DEFAULT 0,        -- กำไร (+) / ขาดทุน (−) สุทธิ
  detail jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (company_id, fiscal_year, period_no),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id),
  FOREIGN KEY (company_id, reversal_journal_id) REFERENCES acct.journal(company_id, id)
);

-- เอกสาร: ยอดเก็บเป็นสกุลเอกสาร (currency มีแล้ว) · fx_rate = บาทต่อหน่วย (NULL = บาท)
-- ยอดบาทที่ลงบัญชีจริง (NULL = เอกสารบาท ใช้ยอดเดิม): grand_total_thb = ลูกหนี้/เจ้าหนี้/เงินสด · vat_thb · base_thb = ฐานภาษีในรายงานภาษี
ALTER TABLE acct.document
  ADD COLUMN fx_rate numeric(18,6) CHECK (fx_rate > 0),
  ADD COLUMN grand_total_thb numeric(18,2),
  ADD COLUMN vat_thb numeric(18,2),
  ADD COLUMN base_thb numeric(18,2);

-- บรรทัดเอกสาร: อัตราภาษี 0 (ส่งออก ม.80/1) ใช้ vat_rate = 0 ได้อยู่แล้ว (NULL = ยกเว้น)

-- ตัดชำระสกุลต่างประเทศ: ยอดบาทตามอัตราเดิมของเอกสารที่ถูกตัด (ลูกหนี้/เจ้าหนี้ที่ล้าง) + ภาษีขายที่โอน (บาท)
ALTER TABLE acct.settlement
  ADD COLUMN settled_thb numeric(18,2),
  ADD COLUMN vat_due_thb numeric(18,2);

-- บรรทัด journal: ยอดสกุลเดิม (debit/credit = บาทเสมอ)
ALTER TABLE acct.journal_line
  ADD COLUMN currency char(3),
  ADD COLUMN amount_fx numeric(18,2) CHECK (amount_fx >= 0),
  ADD CONSTRAINT journal_line_fx_pair CHECK ((currency IS NULL) = (amount_fx IS NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['currency', 'exchange_rate', 'branch', 'fx_revaluation'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
-- ลบอัตราที่กรอกผิดได้ (อัตราไม่ใช่เอกสารบัญชี · เอกสารเก็บ fx_rate ของตัวเองแล้ว)
GRANT DELETE ON acct.exchange_rate TO app;
