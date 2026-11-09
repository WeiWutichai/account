-- ย้อนได้เมื่อยังไม่มี journal ในงวด 0 (ยอดยกมา) — ถ้ามี ต้องย้ายยอดยกมาออกก่อน (ไม่ลบข้อมูลบัญชีให้อัตโนมัติ)
-- migration แตะข้อมูลทุกบริษัท: ปิด FORCE RLS ชั่วคราว (เจ้าของตาราง) แล้วเปิดคืนใน transaction เดียวกัน
ALTER TABLE acct.period NO FORCE ROW LEVEL SECURITY;
ALTER TABLE acct.period DISABLE ROW LEVEL SECURITY;
DELETE FROM acct.period p WHERE p.period_no = 0
  AND NOT EXISTS (SELECT 1 FROM acct.journal j WHERE j.company_id = p.company_id AND j.fiscal_year = p.fiscal_year AND j.period_no = 0);
ALTER TABLE acct.period ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct.period FORCE ROW LEVEL SECURITY;
ALTER TABLE acct.period DROP CONSTRAINT period_period_no_check;
ALTER TABLE acct.period ADD CONSTRAINT period_period_no_check CHECK (period_no BETWEEN 1 AND 13);
