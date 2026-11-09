CREATE OR REPLACE FUNCTION acct.check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION acct.check_posted_has_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'posted' AND NOT EXISTS (SELECT 1 FROM acct.journal_line WHERE company_id = NEW.company_id AND journal_id = NEW.id) THEN
    RAISE EXCEPTION 'journal % ผ่านรายการโดยไม่มีบรรทัด', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
