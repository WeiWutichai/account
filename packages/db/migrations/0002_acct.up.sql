-- acct: ตารางบัญชีรวมทุกบริษัท · ทุกตารางมี company_id + RLS (ENABLE + FORCE) · ADR-001 ทาง ค
CREATE SCHEMA acct;
GRANT USAGE ON SCHEMA acct TO app, console_reader;

-- บริษัทใน context ของ transaction (ตั้งโดย withCompany ผ่าน set_config แบบ LOCAL) · ว่าง = NULL = ไม่เห็นอะไร
CREATE FUNCTION acct.current_company() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE TABLE acct.account (
  company_id uuid NOT NULL REFERENCES public.company(id),
  code text NOT NULL CHECK (code ~ '^[0-9]{7}$'),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'contra_asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'expense')),
  parent_code text,
  is_control boolean NOT NULL DEFAULT false,
  control_kind text CHECK (control_kind IN ('ar', 'ap', 'deposit_in', 'deposit_out')),
  requires_contact boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, code)
);

CREATE TABLE acct.period (
  company_id uuid NOT NULL REFERENCES public.company(id),
  fiscal_year int NOT NULL CHECK (fiscal_year BETWEEN 2500 AND 2700),   -- ปี พ.ศ.
  period_no smallint NOT NULL CHECK (period_no BETWEEN 1 AND 13),       -- 13 = ปรับปรุงปิดปี
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'soft_closed', 'hard_closed')),
  closed_at timestamptz,
  closed_by uuid,
  PRIMARY KEY (company_id, fiscal_year, period_no)
);

CREATE TABLE acct.contact (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('customer', 'vendor', 'both', 'contractor', 'employee')),
  tax_id text,
  branch_code text,
  external_source text,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  UNIQUE (company_id, external_source, external_ref)
);

CREATE TABLE acct.product (
  company_id uuid NOT NULL REFERENCES public.company(id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'service' CHECK (kind IN ('service', 'goods', 'expense', 'kit')),
  unit text,
  price numeric(18,4),
  price_2 numeric(18,4),
  vat boolean NOT NULL DEFAULT true,
  revenue_account text,
  expense_account text,
  PRIMARY KEY (company_id, code),
  FOREIGN KEY (company_id, revenue_account) REFERENCES acct.account(company_id, code),
  FOREIGN KEY (company_id, expense_account) REFERENCES acct.account(company_id, code)
);

CREATE TABLE acct.number_series (
  company_id uuid NOT NULL REFERENCES public.company(id),
  doc_type text NOT NULL,
  pattern text NOT NULL,          -- เช่น {PREFIX}{YY}{MM}-{SEQ:4}
  prefix text NOT NULL,
  period_key text NOT NULL,       -- เช่น 2611 (รีเซ็ตรายเดือน)
  next_no int NOT NULL DEFAULT 1 CHECK (next_no > 0),
  PRIMARY KEY (company_id, doc_type, period_key)
);

CREATE TABLE acct.document (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_type text NOT NULL,
  doc_no text,                    -- กำหนดตอนอนุมัติ/ผ่านรายการ
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'posted', 'voided')),
  issue_date date NOT NULL,
  due_date date,
  contact_id uuid,
  currency char(3) NOT NULL DEFAULT 'THB',
  price_incl_vat boolean NOT NULL DEFAULT false,
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount numeric(18,2) NOT NULL DEFAULT 0,
  vat numeric(18,2) NOT NULL DEFAULT 0,
  wht numeric(18,2) NOT NULL DEFAULT 0,
  grand_total numeric(18,2) NOT NULL DEFAULT 0,
  branch_code text NOT NULL DEFAULT '00000',
  external_source text,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, external_source, external_ref),
  FOREIGN KEY (company_id, contact_id) REFERENCES acct.contact(company_id, id)
);
CREATE UNIQUE INDEX document_no ON acct.document (company_id, doc_type, doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX document_status_date ON acct.document (company_id, status, issue_date DESC);

CREATE TABLE acct.document_line (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL,
  line_no int NOT NULL,
  line_type text NOT NULL DEFAULT 'item' CHECK (line_type IN ('item', 'heading', 'note')),
  product_code text,
  description text NOT NULL,
  qty numeric(18,4),
  unit_price numeric(18,4),
  discount numeric(18,2) NOT NULL DEFAULT 0,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  vat_rate numeric(7,4),
  account_code text,
  UNIQUE (company_id, document_id, line_no),
  FOREIGN KEY (company_id, document_id) REFERENCES acct.document(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, account_code) REFERENCES acct.account(company_id, code)
);

CREATE TABLE acct.posting_rule (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,             -- เช่น Service[IV]
  doc_type text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE TABLE acct.posting_rule_version (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id uuid NOT NULL,
  version int NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,      -- immutable · แก้ = version ใหม่ (ADR-002)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, rule_id, version),
  FOREIGN KEY (company_id, rule_id) REFERENCES acct.posting_rule(company_id, id)
);

CREATE TABLE acct.journal (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_no text NOT NULL,
  journal_date date NOT NULL,
  fiscal_year int NOT NULL,
  period_no smallint NOT NULL,
  book text NOT NULL DEFAULT 'GJ',   -- SJ/PJ/RJ/PV/GJ
  description text,
  source_document_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'voided')),
  reversal_of uuid,
  rule_version_id uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, journal_no),
  FOREIGN KEY (company_id, fiscal_year, period_no) REFERENCES acct.period(company_id, fiscal_year, period_no),
  FOREIGN KEY (company_id, source_document_id) REFERENCES acct.document(company_id, id),
  FOREIGN KEY (company_id, reversal_of) REFERENCES acct.journal(company_id, id),
  FOREIGN KEY (company_id, rule_version_id) REFERENCES acct.posting_rule_version(company_id, id)
);
CREATE INDEX journal_period ON acct.journal (company_id, fiscal_year, period_no);

CREATE TABLE acct.journal_line (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_id uuid NOT NULL,
  line_no int NOT NULL,
  account_code text NOT NULL,
  contact_id uuid,
  debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  branch_code text NOT NULL DEFAULT '00000',
  project_code text,
  memo text,
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0),
  UNIQUE (company_id, journal_id, line_no),
  FOREIGN KEY (company_id, journal_id) REFERENCES acct.journal(company_id, id),
  FOREIGN KEY (company_id, account_code) REFERENCES acct.account(company_id, code),
  FOREIGN KEY (company_id, contact_id) REFERENCES acct.contact(company_id, id)
);
-- covering index สำหรับงบทดลอง (ผล spike M0)
CREATE INDEX journal_line_tb ON acct.journal_line (company_id, account_code) INCLUDE (debit, credit);
CREATE INDEX journal_line_journal ON acct.journal_line (company_id, journal_id);

CREATE TABLE acct.audit_log (     -- append-only · hash chain เติมใน M7
  company_id uuid NOT NULL REFERENCES public.company(id),
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  prev_hash bytea,
  hash bytea
);
CREATE INDEX audit_log_entity ON acct.audit_log (company_id, entity, entity_id);

-- ---------- Dr = Cr ชั้นที่ 2 (ADR-002): ตรวจตอน commit ----------
CREATE FUNCTION acct.check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  jid uuid := coalesce(NEW.journal_id, OLD.journal_id);
  cid uuid := coalesce(NEW.company_id, OLD.company_id);
  dr numeric; cr numeric; n int;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO dr, cr, n
    FROM acct.journal_line WHERE company_id = cid AND journal_id = jid;
  IF n > 0 AND dr <> cr THEN
    RAISE EXCEPTION 'journal % ไม่ดุล: Dr % ≠ Cr %', jid, dr, cr USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT OR UPDATE OR DELETE ON acct.journal_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acct.check_journal_balanced();

-- journal ที่ผ่านรายการต้องมีบรรทัด (ตรวจตอน commit)
CREATE FUNCTION acct.check_posted_has_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'posted' AND NOT EXISTS (SELECT 1 FROM acct.journal_line WHERE company_id = NEW.company_id AND journal_id = NEW.id) THEN
    RAISE EXCEPTION 'journal % ผ่านรายการโดยไม่มีบรรทัด', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_posted_has_lines AFTER INSERT OR UPDATE ON acct.journal
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acct.check_posted_has_lines();

-- ---------- journal ที่ผ่านรายการแล้วแก้/ลบไม่ได้ (void + reversal เท่านั้น) ----------
CREATE FUNCTION acct.guard_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'ลบ journal ที่ผ่านรายการแล้วไม่ได้ (%)', OLD.journal_no USING ERRCODE = 'restrict_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    -- อนุญาตเฉพาะเปลี่ยนสถานะ posted → voided โดยข้อมูลอื่นเหมือนเดิม
    IF NEW.status = 'voided' AND (NEW.journal_no, NEW.journal_date, NEW.fiscal_year, NEW.period_no) IS NOT DISTINCT FROM (OLD.journal_no, OLD.journal_date, OLD.fiscal_year, OLD.period_no) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'แก้ journal ที่ผ่านรายการแล้วไม่ได้ (%) — ใช้ void + reversal', OLD.journal_no USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'voided' THEN RAISE EXCEPTION 'journal % ถูกยกเลิกแล้ว', OLD.journal_no USING ERRCODE = 'restrict_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE UPDATE OR DELETE ON acct.journal FOR EACH ROW EXECUTE FUNCTION acct.guard_posted_journal();

CREATE FUNCTION acct.guard_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM acct.journal WHERE company_id = coalesce(NEW.company_id, OLD.company_id) AND id = coalesce(NEW.journal_id, OLD.journal_id);
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'แก้บรรทัดของ journal ที่ไม่ใช่ร่างไม่ได้' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON acct.journal_line FOR EACH ROW EXECUTE FUNCTION acct.guard_posted_journal_line();

-- ---------- งวดที่ปิดแข็ง: ห้ามลง/แก้ journal ----------
CREATE FUNCTION acct.guard_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM acct.period WHERE company_id = NEW.company_id AND fiscal_year = NEW.fiscal_year AND period_no = NEW.period_no;
  IF st = 'hard_closed' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    RAISE EXCEPTION 'งวด %/% ปิดแข็งแล้ว ลงรายการไม่ได้', NEW.period_no, NEW.fiscal_year USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_period_guard BEFORE INSERT OR UPDATE ON acct.journal FOR EACH ROW EXECUTE FUNCTION acct.guard_period();

-- ---------- audit_log append-only ----------
CREATE FUNCTION acct.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log แก้/ลบไม่ได้' USING ERRCODE = 'restrict_violation'; END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON acct.audit_log FOR EACH ROW EXECUTE FUNCTION acct.audit_append_only();

-- ---------- RLS ทุกตาราง ----------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'acct' LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
    IF t = 'audit_log' THEN
      EXECUTE format('GRANT SELECT, INSERT ON acct.%I TO app', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON acct.%I TO app', t);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE acct.audit_log_id_seq TO app;
