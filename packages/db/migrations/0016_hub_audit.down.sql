-- หมายเหตุ: แถว audit ที่บันทึกหลัง 0016 มี channel ใน hash — ย้อนแล้ว verifyAuditChain แบบเดิมจะตรวจแถวเหล่านั้นไม่ผ่าน
DROP INDEX acct.contact_by_client;
DROP INDEX acct.document_by_client;
ALTER TABLE acct.contact DROP COLUMN created_by_client;
ALTER TABLE acct.document DROP COLUMN created_by_client;
DROP TABLE acct.api_call;
ALTER TABLE public.api_client DROP COLUMN revoke_reason, DROP COLUMN revoked_by, DROP COLUMN suspended_until, DROP COLUMN status;

CREATE OR REPLACE FUNCTION acct.audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.company_id::text));
  SELECT hash INTO prev FROM acct.audit_log WHERE company_id = NEW.company_id AND hash IS NOT NULL ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|', NEW.company_id, NEW.id, to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(NEW.actor_id::text, ''), NEW.action, NEW.entity, NEW.entity_id, coalesce(NEW.before::text, ''), coalesce(NEW.after::text, '')), 'UTF8'));
  RETURN NEW;
END $$;
DROP INDEX acct.audit_log_at;
ALTER TABLE acct.audit_log DROP CONSTRAINT audit_log_channel;
ALTER TABLE acct.audit_log DROP COLUMN api_client_id, DROP COLUMN ip, DROP COLUMN channel;
