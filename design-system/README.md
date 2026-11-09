# design-system/ — AccountSystem · Carbon TH (ตัวจริง, Wei ยืนยัน 2026-11-09)

สำเนาออฟไลน์จาก https://claude.ai/artifact/UdMQo46L3WYvyRHCLGYuaa (version id `1794203704-c66a`) · อ่านอย่างเดียว · sha256 ใน `MANIFEST.json`
- `project/tokens.json` → สร้าง CSS vars ใน `packages/ui` (สี ตัวอักษร ระยะ ขนาด เงา)
- `project/components/*` → สเปก AmountCell, Button, DataTable, JournalPreview, StatusTag
- ห้ามใช้ตัว "v2" `LwCHLbTjkSWvJvgd94fW29`

## จุดที่แบบร่างต่างจากระบบออกแบบ — ใช้ตามแบบร่าง (`design/`) + CLAUDE.md
แบบร่าง 76 หน้าทำปุ่มเป็นมาตรฐานเดียวกันแล้ว และ CLAUDE.md ล็อกกติกาปุ่มตามนั้น จึง override token ปุ่มดังนี้:

| เรื่อง | ระบบออกแบบ (tokens/Button) | ใช้จริง (แบบร่าง + CLAUDE.md) |
|---|---|---|
| มุมปุ่ม | `radius-none` 0 px | 4 px |
| ปุ่มรอง | ทึบ `#393939` ตัวขาว | พื้นขาว ขอบ `#8d8d8d` ตัว `#161616` |
| ปุ่มอันตราย | ทึบ `#da1e28` ตัวขาว | พื้นขาว ขอบและตัว `#da1e28` |
| ชื่อปุ่ม | ชิดซ้าย padding ขวา 64 px | กึ่งกลาง padding 16 px (32 px: 12 px) |
| ความสูงปุ่มแถบล่าง | 48 px (`control-lg`) | 40 px · ขนาดอื่น 36/32 px |

เรื่องอื่น (สี สถานะ ตัวอักษร ระยะ ตาราง sidebar `#f4f4f4`) ตรงกัน ใช้ token ได้ตรงๆ · ถ้าเจอจุดต่างอื่นอีก ให้ยึดแบบร่างแล้วแจ้ง Wei
