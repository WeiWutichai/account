-- กลุ่ม A (hub): ช่องทาง/IP/client ใน audit log · สถิติการเรียก API/MCP · ผูกเอกสาร/คู่ค้ากับ client ที่สร้าง · ระงับ/ลดสิทธิ์/เหตุผลการเพิกถอน client

-- ---------- audit_log: ช่องทาง (web/api/mcp/system) · IP · API client ----------
-- ค่ามาจาก set_config('app.audit_*', …, true) ใน transaction เดียวกัน (withCompany · transaction-local → ใช้กับ PgBouncer transaction mode ได้)
-- เพิ่มคอลัมน์ก่อนแล้วค่อยตั้ง DEFAULT → แถวเดิมเป็น NULL (hash เดิมยังตรวจผ่าน)
ALTER TABLE acct.audit_log ADD COLUMN channel text, ADD COLUMN ip text, ADD COLUMN api_client_id uuid;
ALTER TABLE acct.audit_log ADD CONSTRAINT audit_log_channel CHECK (channel IN ('web', 'api', 'mcp', 'system'));
ALTER TABLE acct.audit_log ALTER COLUMN channel SET DEFAULT coalesce(nullif(current_setting('app.audit_channel', true), ''), 'system');
ALTER TABLE acct.audit_log ALTER COLUMN ip SET DEFAULT nullif(current_setting('app.audit_ip', true), '');
ALTER TABLE acct.audit_log ALTER COLUMN api_client_id SET DEFAULT nullif(current_setting('app.audit_client', true), '')::uuid;
CREATE INDEX audit_log_at ON acct.audit_log (company_id, at DESC);

-- hash chain: ต่อท้ายด้วย channel/ip/client เมื่อมี channel (แถวก่อน 0016 channel = NULL → concat_ws ข้าม → hash เดิมไม่เปลี่ยน)
CREATE OR REPLACE FUNCTION acct.audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.company_id::text));
  SELECT hash INTO prev FROM acct.audit_log WHERE company_id = NEW.company_id AND hash IS NOT NULL ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|', NEW.company_id, NEW.id, to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(NEW.actor_id::text, ''), NEW.action, NEW.entity, NEW.entity_id, coalesce(NEW.before::text, ''), coalesce(NEW.after::text, ''),
    CASE WHEN NEW.channel IS NULL THEN NULL ELSE concat_ws('/', NEW.channel, coalesce(NEW.ip, ''), coalesce(NEW.api_client_id::text, '')) END), 'UTF8'));
  RETURN NEW;
END $$;

-- ---------- API client: ระงับชั่วคราว · ผู้เพิกถอน + เหตุผล ----------
ALTER TABLE public.api_client
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  ADD COLUMN suspended_until timestamptz,
  ADD COLUMN revoked_by uuid REFERENCES public.app_user(id),
  ADD COLUMN revoke_reason text;

-- ---------- สถิติการเรียก API/MCP (ScreenMcp "เรียกใช้ 7 วัน" · ScreenRevoke "กิจกรรม 24 ชม.") ----------
CREATE TABLE acct.api_call (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL,                                   -- public.api_client(id) · ไม่ใส่ FK ข้าม schema (เหมือน webhook_endpoint.api_client_id — ให้ export/import รายบริษัทได้)
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('api', 'mcp')),
  tool text NOT NULL,                                        -- ชื่อเครื่องมือ MCP หรือ "METHOD /path"
  status text NOT NULL CHECK (status IN ('ok', 'denied', 'error')),
  document_id uuid,                                          -- เอกสารที่สร้าง/อ่าน (ถ้ามี)
  detail text
);
CREATE INDEX api_call_client ON acct.api_call (company_id, client_id, at DESC);
CREATE INDEX api_call_at ON acct.api_call (company_id, at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_call'] LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON acct.%I USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company())', t);
    EXECUTE format('GRANT SELECT, INSERT ON acct.%I TO app', t);   -- append-only
    EXECUTE format('GRANT SELECT ON acct.%I TO console_reader', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE acct.api_call_id_seq TO app;

-- ---------- เอกสาร/คู่ค้าที่สร้างโดย API client (ScreenRevoke "สิ่งที่ client นี้สร้างไว้และยังค้างอยู่") ----------
ALTER TABLE acct.document ADD COLUMN created_by_client uuid;
ALTER TABLE acct.contact ADD COLUMN created_by_client uuid;
CREATE INDEX document_by_client ON acct.document (company_id, created_by_client) WHERE created_by_client IS NOT NULL;
CREATE INDEX contact_by_client ON acct.contact (company_id, created_by_client) WHERE created_by_client IS NOT NULL;
