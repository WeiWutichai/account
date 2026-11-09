-- M3 Innovera ID (docs/technical-plan-M3.md §3) · public = ข้อมูลกลาง ไม่ใช่ข้อมูลบัญชี (ไม่ใช้ RLS · สิทธิ์ตรวจที่ id-api)
ALTER TABLE public.app_user
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN totp_secret_enc text,
  ADD COLUMN totp_last_step bigint,
  ADD COLUMN phone_masked text,
  ADD COLUMN locale text NOT NULL DEFAULT 'th' CHECK (locale IN ('th', 'en')),
  ADD COLUMN marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'));

CREATE TABLE public.password_history (
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_history_user ON public.password_history (user_id, created_at DESC);

CREATE TABLE public.backup_code (
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  idx smallint NOT NULL CHECK (idx BETWEEN 0 AND 9),
  code_hash text,              -- null = ใช้แล้ว
  used_at timestamptz,
  PRIMARY KEY (user_id, idx)
);

-- refresh token แบบหมุน: 1 แถว = 1 token · family = 1 การเข้าสู่ระบบ · ใช้ token ที่ถูกหมุนแล้วซ้ำ → เพิกถอนทั้ง family
CREATE TABLE public.auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  amr text[] NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,          -- อายุสูงสุดของ family (นโยบายองค์กร เช่น 12 ชม.)
  rotated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE INDEX auth_session_user ON public.auth_session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_session_family ON public.auth_session (family_id);

CREATE TABLE public.trusted_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX trusted_device_user ON public.trusted_device (user_id);

CREATE TABLE public.email_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX email_token_user ON public.email_token (user_id, purpose) WHERE used_at IS NULL;

-- TODO(M3.5): ตัวส่งอีเมลจริงอ่านคิวนี้
CREATE TABLE public.outbox_email (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- บันทึกการเข้าสู่ระบบ (ScreenOrgMembers แท็บ "บันทึกการเข้าสู่ระบบ") · append-only
CREATE TABLE public.login_event (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
  email text NOT NULL,
  event text NOT NULL CHECK (event IN ('login_ok', 'login_fail', 'mfa_ok', 'mfa_fail', 'locked', 'logout', 'password_reset_requested', 'password_reset', 'refresh_reuse', 'mfa_enabled', 'backup_code_used')),
  ip_hash text,
  user_agent text
);
CREATE INDEX login_event_user ON public.login_event (user_id, at DESC);

ALTER TABLE public.organization
  ADD COLUMN security_policy jsonb NOT NULL DEFAULT '{"require_2fa": true, "session_hours": 12}';
ALTER TABLE public.org_membership
  ADD COLUMN expires_at date;
ALTER TABLE public.company_membership
  ADD COLUMN permissions jsonb,
  ADD COLUMN scope text NOT NULL DEFAULT 'all',
  ADD COLUMN expires_at date,
  ADD COLUMN require_2fa boolean NOT NULL DEFAULT true,
  ADD COLUMN last_used_at timestamptz,
  ADD CONSTRAINT company_role_known CHECK (company_role IN ('owner', 'accounting_manager', 'accountant', 'ar_clerk', 'petty_cash_holder', 'viewer', 'auditor', 'custom'));
ALTER TABLE public.invite
  ADD COLUMN kind text NOT NULL DEFAULT 'member' CHECK (kind IN ('member', 'auditor')),
  ADD COLUMN org_role text NOT NULL DEFAULT 'member' CHECK (org_role IN ('admin', 'billing_admin', 'member', 'guest')),
  ADD COLUMN invited_by uuid REFERENCES public.app_user(id),
  ADD COLUMN access_until date,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN declined_at timestamptz;
ALTER TABLE public.company
  ADD COLUMN setup_step smallint NOT NULL DEFAULT 5 CHECK (setup_step BETWEEN 1 AND 5),  -- 5 = ตั้งค่าเสร็จ (ScreenCompanyPicker "ยังตั้งค่าไม่เสร็จ (ขั้น 3/5)")
  ADD COLUMN setup_done boolean NOT NULL DEFAULT true,
  ADD COLUMN chart_template text NOT NULL DEFAULT 'service' CHECK (chart_template IN ('service', 'trading', 'dbd', 'import')),
  ADD COLUMN modules jsonb NOT NULL DEFAULT '{"core": true, "assets": true, "inventory": false, "payroll": false, "dimensions": true}',
  ADD COLUMN go_live_date date,
  ADD COLUMN created_by uuid REFERENCES public.app_user(id);
ALTER TABLE public.subscription
  ADD COLUMN trial_ends_at date;

-- v1: ทุกองค์กรใหม่ได้ trial แผน Business (ScreenSignup กล่อง Phase 2 · ScreenOrgMembers 3 บริษัท / 10 ที่นั่ง)
INSERT INTO public.plan (code, name, limits) VALUES ('business', 'Business', '{"company_limit": 3, "seat_limit": 10}') ON CONFLICT (code) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_history, public.backup_code, public.auth_session, public.trusted_device, public.email_token TO app;
GRANT SELECT, INSERT, UPDATE ON public.outbox_email TO app;
GRANT SELECT, INSERT ON public.login_event TO app;
GRANT USAGE ON SEQUENCE public.outbox_email_id_seq, public.login_event_id_seq TO app;
GRANT SELECT ON public.password_history, public.backup_code, public.auth_session, public.trusted_device, public.email_token, public.outbox_email, public.login_event TO console_reader;
