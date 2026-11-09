# AmountCell

เซลล์จำนวนเงินในตารางและยอดรวม ใช้ทุกที่ที่แสดงเงิน

- ชิดขวา, `font-variant-numeric: tabular-nums`, ทศนิยม 2 ตำแหน่ง, คอมมาคั่นหลักพัน
- ค่าศูนย์ในคอลัมน์ Dr/Cr แสดงเป็นช่องว่าง (prop `blankZero`)
- ติดลบ: หน้าจอทำงาน `−1,200.00` สี `amount-negative`; รายงานงบ `(1,200.00)` (prop `format="statement"`)
- ยอดรวมใช้ style `amount-total` 16 px/600 มีเส้นบน `border-strong`
- หัวคอลัมน์ของคอลัมน์เงินชิดขวาด้วย
- ผู้ใช้ส่ง: `value` (decimal string), `format`, `blankZero`, `currency` (แสดงที่หัวคอลัมน์ ไม่ใช่ในเซลล์)
