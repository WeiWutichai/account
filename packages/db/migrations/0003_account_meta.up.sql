-- ข้อมูลประกอบผังบัญชีตาม ScreenCOA: หมวดย่อย + ข้อความ "คุม / ผูกกับ" · journal ร่างที่ยังไม่มีเลขที่
ALTER TABLE acct.account ADD COLUMN category text;
ALTER TABLE acct.account ADD COLUMN binding text;
ALTER TABLE acct.journal ADD COLUMN auto_reverse boolean NOT NULL DEFAULT false;
ALTER TABLE acct.journal ADD COLUMN recurring text CHECK (recurring IN ('monthly_last_day'));
ALTER TABLE acct.journal ADD COLUMN created_by uuid;

CREATE TABLE acct.journal_template (
  company_id uuid NOT NULL REFERENCES public.company(id),
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  book text NOT NULL DEFAULT 'GJ',
  description text,
  lines jsonb NOT NULL,     -- [{account_code, memo, side, amount?}]
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE acct.journal_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct.journal_template FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON acct.journal_template USING (company_id = acct.current_company()) WITH CHECK (company_id = acct.current_company());
GRANT SELECT, INSERT, UPDATE, DELETE ON acct.journal_template TO app;
GRANT SELECT ON acct.journal_template TO console_reader;
