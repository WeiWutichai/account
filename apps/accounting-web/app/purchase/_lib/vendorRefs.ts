// เลขใบกำกับของผู้ขายที่เคยบันทึกแล้ว (ตรวจซ้ำ · ScreenPurchaseBill.dc.html "ไม่ซ้ำกับบิลเดิมของผู้ขายรายนี้")
// TODO(backend): GET /v1/documents ไม่ส่ง vendor_ref → ต้องเปิดรายละเอียดทีละใบ · ควรมี endpoint ตรวจซ้ำ (contact + vendor_ref)
import { useEffect, useState } from 'react';
import { call } from '../../sales/_lib/client.ts';
import type { PDetail, PRow } from './types.ts';

export interface VendorRef { id: string; docNo: string | null; ref: string; status: string }

export function useVendorRefs(contactId: string | null, types = 'AP'): VendorRef[] | null {
  const [refs, setRefs] = useState<VendorRef[] | null>(null);
  useEffect(() => {
    if (!contactId) { setRefs(null); return; }
    let alive = true;
    void (async () => {
      const list = await call<PRow[]>(`documents?type=${types}&contact=${contactId}`);
      if (!list.ok) return;
      const out: VendorRef[] = [];
      for (const r of list.data.filter((x) => x.status !== 'voided').slice(0, 100)) {
        const d = await call<PDetail>(`documents/${r.id}`);
        if (d.ok && d.data.doc.vendor_ref) out.push({ id: r.id, docNo: r.doc_no, ref: d.data.doc.vendor_ref.trim(), status: r.status });
      }
      if (alive) setRefs(out);
    })();
    return () => { alive = false; };
  }, [contactId, types]);
  return refs;
}
