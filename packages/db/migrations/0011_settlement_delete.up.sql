-- แก้ร่างเอกสารที่หักมัดจำ: ลบ settlement ของร่างแล้วสร้างใหม่ (saveSalesDraft) · settlement ที่ลงบัญชีแล้วไม่ถูกลบ (ใช้ voided)
GRANT DELETE ON acct.settlement TO app;
