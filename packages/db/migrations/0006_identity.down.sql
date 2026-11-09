DELETE FROM public.plan WHERE code = 'business' AND NOT EXISTS (SELECT 1 FROM public.subscription WHERE plan_code = 'business');
ALTER TABLE public.subscription DROP COLUMN trial_ends_at;
ALTER TABLE public.company DROP COLUMN created_by, DROP COLUMN go_live_date, DROP COLUMN modules, DROP COLUMN chart_template, DROP COLUMN setup_done, DROP COLUMN setup_step;
ALTER TABLE public.invite DROP COLUMN declined_at, DROP COLUMN revoked_at, DROP COLUMN access_until, DROP COLUMN invited_by, DROP COLUMN org_role, DROP COLUMN kind;
ALTER TABLE public.company_membership DROP CONSTRAINT company_role_known, DROP COLUMN last_used_at, DROP COLUMN require_2fa, DROP COLUMN expires_at, DROP COLUMN scope, DROP COLUMN permissions;
ALTER TABLE public.org_membership DROP COLUMN expires_at;
ALTER TABLE public.organization DROP COLUMN security_policy;
DROP TABLE public.login_event;
DROP TABLE public.outbox_email;
DROP TABLE public.email_token;
DROP TABLE public.trusted_device;
DROP TABLE public.auth_session;
DROP TABLE public.backup_code;
DROP TABLE public.password_history;
ALTER TABLE public.app_user DROP COLUMN status, DROP COLUMN last_login_at, DROP COLUMN terms_accepted_at, DROP COLUMN marketing_opt_in, DROP COLUMN locale, DROP COLUMN phone_masked,
  DROP COLUMN totp_last_step, DROP COLUMN totp_secret_enc, DROP COLUMN email_verified_at;
