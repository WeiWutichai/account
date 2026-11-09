// เลขใบกำกับของผู้ขายที่เคยบันทึกแล้ว (ตรวจซ้ำ · ScreenPurchaseBill.dc.html "ไม่ซ้ำกับบิลเดิมของผู้ขายรายนี้") — GET /v1/vendor-refs
import { useEffect, useState } from 'react';
import { call } from '../../sales/_lib/client.ts';

export interface VendorRef { id: string; docNo: string | null; ref: string; status: string }
interface Row { id: string; doc_no: string | null; vendor_ref: string; status: string }

export function useVendorRefs(contactId: string | null, types = 'AP'): VendorRef[] | null {
  const [refs, setRefs] = useState<VendorRef[] | null>(null);
  useEffect(() => {
    if (!contactId) { setRefs(null); return; }
    let alive = true;
    void call<Row[]>(`vendor-refs?contact=${encodeURIComponent(contactId)}&type=${encodeURIComponent(types)}`).then((r) => {
      if (alive && r.ok) setRefs(r.data.map((x) => ({ id: x.id, docNo: x.doc_no, ref: x.vendor_ref, status: x.status })));
    });
    return () => { alive = false; };
  }, [contactId, types]);
  return refs;
}
