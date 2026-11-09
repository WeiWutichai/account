-- งวด 0 = งวดพิเศษ "ยอดยกมา" (ScreenOpeningBalance: ลงวันก่อนวันเริ่มปีบัญชี ในงวดพิเศษ ปิดแข็งทันที · เลขที่ JV0000-0001)
ALTER TABLE acct.period DROP CONSTRAINT period_period_no_check;
ALTER TABLE acct.period ADD CONSTRAINT period_period_no_check CHECK (period_no BETWEEN 0 AND 13);
