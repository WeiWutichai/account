-- public: ข้อมูลกลาง (Innovera ID / องค์กร / บริษัท / สมาชิก / แผน) · ไม่ใช้ RLS (ไม่ใช่ข้อมูลบัญชี) · สิทธิ์ตรวจที่ชั้นแอป (M3)
CREATE TABLE public.organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_hash text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
CREATE TABLE public.company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organization(id),
  name_th text NOT NULL,
  name_en text,
  tax_id text CHECK (tax_id ~ '^[0-9x]{13}$'),
  branch_code text NOT NULL DEFAULT '00000' CHECK (branch_code ~ '^[0-9]{5}$'),
  business_type text NOT NULL DEFAULT 'service',
  vat_registered boolean NOT NULL DEFAULT true,
  service_tax_point text NOT NULL DEFAULT 'on_payment' CHECK (service_tax_point IN ('on_payment', 'on_invoice')),
  wht_recognition text NOT NULL DEFAULT 'on_payment' CHECK (wht_recognition IN ('on_payment', 'on_invoice')),
  fiscal_year_start text NOT NULL DEFAULT '01-01' CHECK (fiscal_year_start ~ '^[0-9]{2}-[0-9]{2}$'),
  db_dsn text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_org ON public.company (org_id);
CREATE TABLE public.org_membership (
  org_id uuid NOT NULL REFERENCES public.organization(id),
  user_id uuid NOT NULL REFERENCES public.app_user(id),
  org_role text NOT NULL CHECK (org_role IN ('owner', 'admin', 'billing_admin', 'member', 'guest')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE public.company_membership (
  company_id uuid NOT NULL REFERENCES public.company(id),
  user_id uuid NOT NULL REFERENCES public.app_user(id),
  company_role text NOT NULL,
  approval_limit numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE TABLE public.invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organization(id),
  company_id uuid REFERENCES public.company(id),
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.plan (
  code text PRIMARY KEY,
  name text NOT NULL,
  limits jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE public.subscription (  -- hook เท่านั้นใน Phase 1
  org_id uuid PRIMARY KEY REFERENCES public.organization(id),
  plan_code text NOT NULL REFERENCES public.plan(code),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  renews_at date,
  company_limit int,
  seat_limit int
);
CREATE TABLE public.entitlement (
  org_id uuid NOT NULL REFERENCES public.organization(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (org_id, key)
);
CREATE TABLE public.audit_console (  -- การกระทำของทีม Innovera ต่อข้อมูลลูกค้า (Console X4 ต้องมี consent)
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  target_company_id uuid REFERENCES public.company(id),
  reason text NOT NULL,
  consent_ref text
);
GRANT USAGE ON SCHEMA public TO app, console_reader;
GRANT SELECT, INSERT, UPDATE ON public.organization, public.app_user, public.company, public.org_membership,
  public.company_membership, public.invite, public.subscription, public.entitlement TO app;
GRANT DELETE ON public.company, public.organization, public.org_membership, public.company_membership, public.invite TO app;
GRANT SELECT ON public.plan TO app;
GRANT SELECT, INSERT ON public.audit_console TO app, console_reader;
GRANT USAGE ON SEQUENCE public.audit_console_id_seq TO app, console_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO console_reader;
