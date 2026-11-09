# Button

ปุ่มตาม Carbon: หลัก / รอง / ghost / อันตราย มุมเหลี่ยม สูง 40 px (48 px ในแถบล่างของฟอร์ม)

- ปุ่มหลัก (`btn-primary`) 1 ปุ่มต่อหน้า วางขวาสุดของแถบ action
- ปุ่มรอง (`btn-secondary`) อยู่ซ้ายปุ่มหลักทันที ไม่มีช่องว่าง (Carbon button set)
- ghost สำหรับ action ย่อยในตาราง; อันตราย (`btn-danger`) สำหรับยกเลิก/ลบ/ปิดงวด และต้องมี dialog ยืนยันบอกผลกระทบ
- padding ซ้าย 16 px ขวา 64 px ตาม Carbon เมื่อมีพื้นที่; ในตารางใช้ขนาด sm 32 px
- focus: กรอบ `border-focus` 2 px + ช่องว่างขาว 1 px ข้างใน
- ผู้ใช้ส่ง: `kind`, `size`, `icon`, `disabled`, `loading`
