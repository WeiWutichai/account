-- M4 ขาย + รับเงิน (docs/technical-plan-M4.md §2) · ตารางใหม่ทุกตาราง: company_id + RLS ENABLE/FORCE + policy tenant
ALTER TABLE acct.document
  ADD COLUMN rule_code text,
  ADD COLUMN tax_mode text CHECK (tax_mode IN ('on_payment', 'immediate')),
  ADD COLUMN ref_document_id uuid,
  ADD COLUMN address text,
  ADD COLUMN notes text,
  ADD COLUMN reference text,
  ADD COLUMN journal_id uuid,
  ADD COLUMN created_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text,
  ADD COLUMN void_journal_id uuid,
  ADD COLUMN receive_account text,
  ADD COLUMN fee numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN fee_account text,
  ADD COLUMN wht_cert_no text,
  ADD COLUMN wht_rate numeric(7,4),
  ADD COLUMN bill_discount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN credit_days int,
  ADD COLUMN sent_at timestamptz,
  ADD CONSTRAINT document_ref FOREIGN KEY (company_id, ref_document_id) REFERENCES acct.document(company_id, id),
  ADD CONSTRAINT document_journal FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id);
CREATE INDEX document_ref_idx ON acct.document (company_id, ref_document_id) WHERE ref_document_id IS NOT NULL;
CREATE INDEX document_contact_idx ON acct.document (company_id, contact_id, doc_type, status);

-- RV ↔ IV/DN · ยอดตัด ภาษีถูกหัก (ตาม 50 ทวิ) ภาษีขายที่โอนเมื่อรับเงิน (ม.78/1)
CREATE TABLE acct.settlement (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id uuid NOT NULL,
  document_id uuid NOT NULL,
  applied numeric(18,2) NOT NULL CHECK (applied >= 0),     -- ตัดยอดครั้งนี้ (เงินที่จ่ายจริงของใบนี้)
  wht numeric(18,2) NOT NULL DEFAULT 0 CHECK (wht >= 0),
  wht_base numeric(18,2),
  vat_due numeric(18,2) NOT NULL DEFAULT 0,
  voided boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payment_id, document_id),
  FOREIGN KEY (company_id, payment_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id)
);
CREATE INDEX settlement_doc ON acct.settlement (company_id, document_id) WHERE NOT voided;

CREATE TABLE acct.billing_item (
  company_id uuid NOT NULL REFERENCES public.company(id),
  billing_id uuid NOT NULL,
  document_id uuid NOT NULL,
  line_no int NOT NULL,
  PRIMARY KEY (company_id, billing_id, document_id),
  FOREIGN KEY (company_id, billing_id) REFERENCES acct.document(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id)
);

CREATE TABLE acct.cheque (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('received', 'issued')),
  cheque_no text NOT NULL,
  bank text NOT NULL,
  branch text,
  cheque_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'on_hand' CHECK (status IN ('on_hand', 'deposited', 'cleared', 'bounced', 'cancelled', 'issued', 'presented')),
  document_id uuid,
  contact_id uuid,
  deposited_on date,
  cleared_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, contact_id) REFERENCES acct.contact(company_id, id)
);
CREATE INDEX cheque_status ON acct.cheque (company_id, direction, status, cheque_date);

CREATE TABLE acct.document_event (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id bigserial PRIMARY KEY,
  document_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  event text NOT NULL CHECK (event IN ('created', 'edited', 'submitted', 'approved', 'rejected', 'posted', 'voided', 'reference_edited', 'sent', 'converted')),
  detail jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id) ON DELETE CASCADE
);
CREATE INDEX document_event_doc ON acct.document_event (company_id, document_id, at);

CREATE TABLE acct.doc_setting (
  company_id uuid NOT NULL REFERENCES public.company(id),
  doc_type text NOT NULL,
  prefix text NOT NULL,
  pattern text NOT NULL DEFAULT '{PREFIX}{YY}{MM}-{SEQ:4}',
  reset text NOT NULL DEFAULT 'monthly' CHECK (reset IN ('monthly', 'yearly', 'never')),
  settings jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, doc_type)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settlement', 'billing_item', 'cheque', 'document_event', 'doc_setting'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
GRANT DELETE ON acct.billing_item TO app;
GRANT USAGE ON SEQUENCE acct.document_event_id_seq TO app;

-- S6 หน้าเอกสารสำหรับลูกค้า: ลิงก์สาธารณะ token → บริษัท + เอกสาร (อยู่ใน public เพราะยังไม่รู้บริษัทตอนเปิดลิงก์ · อ่านเอกสารจริงผ่าน withCompany)
CREATE TABLE public.doc_share (
  token_hash text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.company(id),
  document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX doc_share_doc ON public.doc_share (company_id, document_id);
GRANT SELECT, INSERT, UPDATE ON public.doc_share TO app;
GRANT SELECT ON public.doc_share TO console_reader;
