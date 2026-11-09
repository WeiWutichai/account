-- M7 Hub: audit hash chain · API client (TMS/MCP) · webhooks (outbox + retry + dead-letter)

-- ---------- audit_log hash chain (ต่อบริษัท) ----------
-- hash = sha256(prev_hash || company_id || id || at || actor || action || entity || entity_id || before || after) · ล็อกต่อบริษัทกันลำดับสลับ
CREATE FUNCTION acct.audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.company_id::text));
  SELECT hash INTO prev FROM acct.audit_log WHERE company_id = NEW.company_id AND hash IS NOT NULL ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|', NEW.company_id, NEW.id, to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(NEW.actor_id::text, ''), NEW.action, NEW.entity, NEW.entity_id, coalesce(NEW.before::text, ''), coalesce(NEW.after::text, '')), 'UTF8'));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON acct.audit_log FOR EACH ROW EXECUTE FUNCTION acct.audit_chain();

-- ---------- API client ของแอปภายนอก (TMS / MCP) ต่อบริษัท ----------
-- เก็บเฉพาะ hash ของ key · scope ไม่มี post/pay/periods/users/settings (PLAN §5)
CREATE TABLE public.api_client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tms', 'mcp', 'custom')),
  key_prefix text NOT NULL,                                   -- แสดงในหน้าจอ (เช่น inn_live_ab12…)
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['documents:read','documents:draft','contacts:read','contacts:draft','ledger:read','reports:read','tax:read','schema:read','webhooks:manage']::text[]),
  created_by uuid REFERENCES public.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_client_company ON public.api_client (company_id);
GRANT SELECT, INSERT, UPDATE ON public.api_client TO app;
GRANT SELECT ON public.api_client TO console_reader;

-- ---------- webhooks ----------
CREATE TABLE acct.webhook_endpoint (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url text NOT NULL CHECK (url ~ '^https://' OR url ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/'),
  secret text NOT NULL,                                       -- ใช้ลงนาม HMAC (ส่งให้ผู้รับครั้งเดียวตอนสร้าง)
  events text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  api_client_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX webhook_endpoint_uq ON acct.webhook_endpoint (company_id, id);
CREATE TABLE acct.webhook_delivery (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id uuid NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  FOREIGN KEY (company_id, endpoint_id) REFERENCES acct.webhook_endpoint(company_id, id) ON DELETE CASCADE
);
CREATE INDEX webhook_delivery_due ON acct.webhook_delivery (company_id, status, next_attempt_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhook_endpoint', 'webhook_delivery'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON acct.%I TO app', t);
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
