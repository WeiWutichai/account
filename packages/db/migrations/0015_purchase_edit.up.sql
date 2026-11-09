-- ScreenDocEdit (ตัวอย่างบิลซื้อ AP): ข้อมูลอ้างอิงที่แก้ได้หลังผ่านรายการ
-- party_tax_id = เลขผู้เสียภาษีของคู่ค้าบนเอกสาร (ว่าง = ตามทะเบียนคู่ค้า) · vendor_invoice_date = วันที่ในใบกำกับของผู้ขาย · project_code = มิติ/โครงการ (ไม่กระทบ GL)
ALTER TABLE acct.document
  ADD COLUMN party_tax_id text CHECK (party_tax_id ~ '^[0-9]{13}$'),
  ADD COLUMN vendor_invoice_date date,
  ADD COLUMN project_code text;
