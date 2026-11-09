-- M8 Innovera Console (admin.*) · ทีม Innovera · ticket · คำขอเข้าดูข้อมูลลูกค้า (consent) · feature flags
-- หลัก (ConsoleSupport): ลูกค้าเป็นเจ้าของข้อมูล · เข้าดูได้เฉพาะเมื่อมี ticket + consent ของ Owner + เวลาจำกัด + บันทึกทุกอย่าง
CREATE TABLE public.innovera_staff (
  user_id uuid PRIMARY KEY REFERENCES public.app_user(id),
  role text NOT NULL CHECK (role IN ('support', 'engineer', 'billing', 'ops', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.support_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number serial UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organization(id),
  company_id uuid REFERENCES public.company(id),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_consent', 'waiting_billing', 'closed')),
  assignee uuid REFERENCES public.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE TABLE public.support_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_ticket(id),
  company_id uuid NOT NULL REFERENCES public.company(id),
  requested_by uuid NOT NULL REFERENCES public.app_user(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  scope text NOT NULL,
  minutes int NOT NULL CHECK (minutes IN (30, 60)),
  write_access boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'active', 'ended', 'cancelled')),
  decided_by uuid REFERENCES public.app_user(id),
  decided_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_access_company ON public.support_access (company_id, status);
CREATE TABLE public.feature_flag (
  key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global', 'org', 'company')),
  target_id uuid,                                    -- null เมื่อ global
  value jsonb NOT NULL,
  updated_by uuid REFERENCES public.app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (key, scope, target_id)
);
GRANT SELECT, INSERT, UPDATE ON public.innovera_staff, public.support_ticket, public.support_access, public.feature_flag TO app;
GRANT USAGE ON SEQUENCE public.support_ticket_number_seq TO app;
GRANT SELECT ON public.innovera_staff, public.support_ticket, public.support_access, public.feature_flag TO console_reader;
ALTER TABLE public.audit_console ADD COLUMN actor_user uuid REFERENCES public.app_user(id), ADD COLUMN access_id uuid REFERENCES public.support_access(id);
