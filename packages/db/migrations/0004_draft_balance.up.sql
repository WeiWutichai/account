-- ร่าง journal ยังไม่ต้องดุล (ผู้ใช้กรอกไม่เสร็จ) · ดุลบังคับเมื่อสถานะไม่ใช่ร่าง (ตรวจตอน commit ทั้งตอนแก้บรรทัดและตอนเปลี่ยนสถานะ)
CREATE OR REPLACE FUNCTION acct.check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  jid uuid := coalesce(NEW.journal_id, OLD.journal_id);
  cid uuid := coalesce(NEW.company_id, OLD.company_id);
  st text; dr numeric; cr numeric; n int;
BEGIN
  SELECT status INTO st FROM acct.journal WHERE company_id = cid AND id = jid;
  IF st IS NULL OR st = 'draft' THEN RETURN NULL; END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO dr, cr, n
    FROM acct.journal_line WHERE company_id = cid AND journal_id = jid;
  IF n > 0 AND dr <> cr THEN
    RAISE EXCEPTION 'journal % ไม่ดุล: Dr % ≠ Cr %', jid, dr, cr USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION acct.check_posted_has_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dr numeric; cr numeric; n int;
BEGIN
  IF NEW.status = 'draft' THEN RETURN NULL; END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO dr, cr, n
    FROM acct.journal_line WHERE company_id = NEW.company_id AND journal_id = NEW.id;
  IF n = 0 THEN RAISE EXCEPTION 'journal % ผ่านรายการโดยไม่มีบรรทัด', NEW.id USING ERRCODE = 'check_violation'; END IF;
  IF dr <> cr THEN RAISE EXCEPTION 'journal % ไม่ดุล: Dr % ≠ Cr %', NEW.journal_no, dr, cr USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
