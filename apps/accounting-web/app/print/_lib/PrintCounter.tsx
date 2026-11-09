'use client';
// นับการพิมพ์ต้นฉบับ: หลังสั่งพิมพ์จากเบราว์เซอร์ (afterprint) → POST /v1/documents/:id/printed ครั้งเดียวต่อการเปิดหน้า
// เปิดหน้าใหม่หลังพิมพ์แล้ว → แบบพิมพ์แสดง "สำเนา" (badgeOf) · PrintReceiptTax.dc.html "สำเนาที่พิมพ์ซ้ำจะแสดงคำว่า “สำเนา”"
// TODO(Wei): ดาวน์โหลด PDF (/print/<kind>/<id>/pdf) ยังไม่นับเป็นการพิมพ์ต้นฉบับ — รอยืนยันว่าส่ง PDF ให้ลูกค้านับเป็นต้นฉบับหรือไม่
import { useEffect } from 'react';

export function PrintCounter({ id }: { id: string }) {
  useEffect(() => {
    let done = false;
    const mark = () => {
      if (done) return;
      done = true;
      void fetch(`/api/proxy/documents/${encodeURIComponent(id)}/printed`, { method: 'POST' }).catch(() => undefined);
    };
    window.addEventListener('afterprint', mark);
    return () => window.removeEventListener('afterprint', mark);
  }, [id]);
  return null;
}
