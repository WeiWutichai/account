# DataTable

ตารางรายการเอกสารและรายงาน ต่อจาก Carbon DataTable

- สองความสูง: `row-default` 40 px สำหรับรายการเอกสาร/บรรทัด, `row-compact` 32 px สำหรับรายงานและแยกประเภท
- หัวตารางติดด้านบนเมื่อเลื่อน พื้น `bg-layer-1` ตัวอักษร `label` สี `text-secondary`
- แถวคั่นด้วย `border-subtle` 1 px, hover `bg-hover`, เลือก `bg-selected`
- เลขเอกสารเป็นลิงก์ (`doc-number`), สถานะเป็น `StatusTag`, เงินเป็น `AmountCell`
- แถวยอดรวมติดด้านล่าง, pagination ใต้ตารางเสมอ
- เลือกหลายแถว → แถบ batch action แทนที่ toolbar; toolbar มี action ไม่เกิน 5 ที่เหลือในเมนู
- กว้างเกินจอ: เลื่อนแนวนอนในกล่อง คอลัมน์เลขที่ตรึงซ้าย
- ผู้ใช้ส่ง: `columns`, `rows`, `density`, `selectable`, `stickyTotal`
