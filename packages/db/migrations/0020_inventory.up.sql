-- Phase 2A กลุ่ม INV สินค้าคงคลัง (docs/technical-plan-P2A.md "INV" · Spec v2 FR-IN-01/02/05/07 · FR-PU-09)
-- โมดูลเปิดต่อบริษัท (public.company.modules.inventory) · ปิด = พฤติกรรม Phase 1 เดิม (ไม่มีแถวในตารางเหล่านี้)
-- ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant · index ขึ้นต้น company_id

-- คลังสินค้า · allow_negative = ยอมให้ติดลบ (FR-IN-01 "เปิดได้ต่อ location") · is_default = คลังตั้งต้นของเอกสารที่ไม่ระบุคลัง
CREATE TABLE acct.warehouse (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  branch_code text NOT NULL DEFAULT '00000' CHECK (branch_code ~ '^[0-9]{5}$'),
  allow_negative boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX warehouse_default ON acct.warehouse (company_id) WHERE is_default;

-- สินค้า: ติดตามสต็อก · บัญชีสินค้าคงเหลือ/ต้นทุนขายต่อสินค้า (ว่าง = บัญชีของโมดูล) · จุดสั่งซื้อ/สูงสุด (FR-IN-05) · บาร์โค้ด (FR-IN-07)
ALTER TABLE acct.product
  ADD COLUMN track_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN inventory_account text,
  ADD COLUMN cogs_account text,
  ADD COLUMN reorder_point numeric(18,4) CHECK (reorder_point >= 0),
  ADD COLUMN max_qty numeric(18,4) CHECK (max_qty >= 0),
  ADD COLUMN barcode text,
  ADD CONSTRAINT product_inventory_account FOREIGN KEY (company_id, inventory_account) REFERENCES acct.account(company_id, code),
  ADD CONSTRAINT product_cogs_account FOREIGN KEY (company_id, cogs_account) REFERENCES acct.account(company_id, code);
CREATE UNIQUE INDEX product_barcode ON acct.product (company_id, barcode) WHERE barcode IS NOT NULL;

-- หน่วยซื้อ/ขายเพิ่มเติม: 1 unit = factor × หน่วยนับหลัก (product.unit) เช่น กล่อง = 10 ชิ้น
CREATE TABLE acct.product_unit (
  company_id uuid NOT NULL REFERENCES public.company(id),
  product_code text NOT NULL,
  unit text NOT NULL,
  factor numeric(18,4) NOT NULL CHECK (factor > 0),
  barcode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, product_code, unit),
  FOREIGN KEY (company_id, product_code) REFERENCES acct.product(company_id, code) ON DELETE CASCADE
);
CREATE UNIQUE INDEX product_unit_barcode ON acct.product_unit (company_id, barcode) WHERE barcode IS NOT NULL;

-- เอกสารสต็อก (GR/GI/TRF/ADJ) และขาย/ซื้อที่ตัด/รับสต็อก: คลังต้นทาง · คลังปลายทาง (TRF)
ALTER TABLE acct.document
  ADD COLUMN warehouse_id uuid,
  ADD COLUMN to_warehouse_id uuid,
  ADD CONSTRAINT document_warehouse FOREIGN KEY (company_id, warehouse_id) REFERENCES acct.warehouse(company_id, id),
  ADD CONSTRAINT document_to_warehouse FOREIGN KEY (company_id, to_warehouse_id) REFERENCES acct.warehouse(company_id, id);
-- unit = หน่วยของบรรทัด (ว่าง = หน่วยนับหลัก) · counted_qty = ยอดนับได้ (ADJ ตรวจนับ) · grir_amount = ยอดที่ล้าง GR/IR ของบิลซื้อที่อ้าง GR
ALTER TABLE acct.document_line
  ADD COLUMN unit text,
  ADD COLUMN counted_qty numeric(18,4) CHECK (counted_qty >= 0),
  ADD COLUMN grir_amount numeric(18,2);

-- ความเคลื่อนไหวสินค้า (ledger ของสต็อก) · qty มีเครื่องหมาย (+ เข้า / − ออก · 0 = ปรับมูลค่าอย่างเดียว) · value มีเครื่องหมาย
-- cost_mode: fixed = มูลค่าคงที่ (รับ/ซื้อ/ผลต่างราคา) · avg = ตามต้นทุนถัวเฉลี่ย ณ จุดนั้น · pair = เท่ากับมูลค่าที่โอนออก (pair_move_id) · reverse = กลับรายการ (reversal_of)
-- gl_account = บัญชีคู่ที่ลง GL แล้ว (perpetual) — ต้นทุนเปลี่ยนจากการคำนวณย้อนหลัง → JV ปรับระหว่างบัญชีนี้กับบัญชีสินค้า
-- journal_value = มูลค่าใน journal ของเอกสารตอนผ่านรายการ (ใช้ตอนยกเลิก) · ไม่มี FK อ้างตัวเอง (ให้ export/import รายบริษัทเรียงตารางได้)
CREATE TABLE acct.stock_move (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seq bigserial NOT NULL,
  move_date date NOT NULL,
  product_code text NOT NULL,
  warehouse_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt', 'purchase', 'sale', 'issue', 'transfer_out', 'transfer_in', 'adjust', 'price_variance')),
  qty numeric(18,4) NOT NULL,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  value numeric(18,2) NOT NULL DEFAULT 0,
  cost_mode text NOT NULL CHECK (cost_mode IN ('fixed', 'avg', 'pair', 'reverse')),
  document_id uuid,
  document_line_id uuid,
  journal_id uuid,
  gl_account text,
  journal_value numeric(18,2),
  pair_move_id uuid,
  reversal_of uuid,
  lot text,
  serial text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, product_code) REFERENCES acct.product(company_id, code),
  FOREIGN KEY (company_id, warehouse_id) REFERENCES acct.warehouse(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id),
  FOREIGN KEY (company_id, gl_account) REFERENCES acct.account(company_id, code)
);
CREATE INDEX stock_move_product ON acct.stock_move (company_id, product_code, move_date, seq);
CREATE INDEX stock_move_warehouse ON acct.stock_move (company_id, warehouse_id, product_code, move_date);
CREATE INDEX stock_move_document ON acct.stock_move (company_id, document_id);
CREATE UNIQUE INDEX stock_move_reversal ON acct.stock_move (company_id, reversal_of) WHERE reversal_of IS NOT NULL;

-- ยอดคงเหลือ สินค้า × คลัง (ปรับใน transaction เดียวกับ stock_move · ล็อกแถว FOR UPDATE)
CREATE TABLE acct.stock_balance (
  company_id uuid NOT NULL REFERENCES public.company(id),
  product_code text NOT NULL,
  warehouse_id uuid NOT NULL,
  qty numeric(18,4) NOT NULL DEFAULT 0,
  avg_cost numeric(18,4) NOT NULL DEFAULT 0,
  value numeric(18,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, product_code, warehouse_id),
  FOREIGN KEY (company_id, product_code) REFERENCES acct.product(company_id, code),
  FOREIGN KEY (company_id, warehouse_id) REFERENCES acct.warehouse(company_id, id)
);
CREATE INDEX stock_balance_warehouse ON acct.stock_balance (company_id, warehouse_id);

-- JV ระบบของโมดูลสต็อก (ไม่ใช่คีย์มือ): ปรับต้นทุนย้อนหลัง (recost) · ปรับตอนยกเลิก (void_adjust) · ปรับสินค้าปลายงวด periodic (period_end ครั้งเดียวต่องวด)
CREATE TABLE acct.inventory_journal (
  company_id uuid NOT NULL REFERENCES public.company(id),
  journal_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('recost', 'void_adjust', 'period_end')),
  document_id uuid,
  fiscal_year int NOT NULL,
  period_no smallint NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, journal_id),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id)
);
CREATE UNIQUE INDEX inventory_journal_period_end ON acct.inventory_journal (company_id, fiscal_year, period_no) WHERE kind = 'period_end';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['warehouse', 'product_unit', 'stock_move', 'stock_balance', 'inventory_journal'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
-- หน่วยนับเพิ่มเติมลบได้ (ข้อมูลหลัก ไม่ใช่รายการบัญชี)
GRANT DELETE ON acct.product_unit TO app;
GRANT USAGE ON SEQUENCE acct.stock_move_seq_seq TO app;
