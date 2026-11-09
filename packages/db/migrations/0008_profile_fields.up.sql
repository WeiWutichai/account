-- ข้อมูลที่แบบพิมพ์ D1–D11 ต้องใช้ (หัวเอกสาร/ลูกค้า) · ScreenSettings / ทะเบียนคู่ค้าจะแก้ค่าเหล่านี้
ALTER TABLE public.company ADD COLUMN address text, ADD COLUMN phone text, ADD COLUMN email text;
ALTER TABLE acct.contact ADD COLUMN address text, ADD COLUMN contact_person text, ADD COLUMN phone text, ADD COLUMN email text,
  ADD COLUMN credit_days int, ADD COLUMN credit_limit numeric(18,2);
