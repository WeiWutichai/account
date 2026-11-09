// Gate M4: QO → IV → BN → RV → PDF ผ่าน accounting-web (proxy + session จริงของ Innovera ID)
// รัน: pnpm dev:session (root) แล้ว cd apps/accounting-web && npx playwright test -c e2e/playwright.config.ts
import { expect, test } from '@playwright/test';

test('QO → IV → BN → RV → PDF', async ({ request, page }) => {
  const api = async <T>(method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> => {
    const r = method === 'GET' ? await request.get(`/api/proxy/${path}`) : await request.post(`/api/proxy/${path}`, { data });
    expect(r.ok(), `${method} ${path}: ${await r.text()}`).toBeTruthy();
    return (await r.json()) as T;
  };
  const contacts = await api<{ id: string; code: string }[]>('GET', 'contacts');
  const c = contacts.find((x) => x.code === 'C0063')!;
  // ใบเสนอราคา → อนุมัติ → แปลงเป็นใบแจ้งหนี้ → อนุมัติลงบัญชี
  const qo = await api<{ id: string }>('POST', 'documents', { docType: 'QO', contactId: c.id, issueDate: '2026-11-30', lines: [{ description: 'บริการตามใบเสนอราคา', qty: '2', unitPrice: '5000.00', vat: true }] });
  const qoNo = await api<{ docNo: string }>('POST', `documents/${qo.id}/approve`);
  expect(qoNo.docNo).toMatch(/^QO2611-/u);
  const iv = await api<{ id: string }>('POST', `documents/${qo.id}/convert`, { to: 'IV', issueDate: '2026-11-30' });
  const ivNo = await api<{ docNo: string; journalNo: string }>('POST', `documents/${iv.id}/approve`);
  expect(ivNo.docNo).toMatch(/^IV2611-00(6\d|[7-9]\d)$/u); // ต่อจากเลขที่มีอยู่ ไม่ย้อน
  const ivDoc = await api<{ doc: { grand_total: string }; outstanding: string }>('GET', `documents/${iv.id}`);
  expect(ivDoc.doc.grand_total).toBe('10700.00');
  // ใบวางบิล → รับชำระ (หัก ณ ที่จ่าย 3% ตาม 50 ทวิ)
  const bn = await api<{ id: string; total: string }>('POST', 'billings', { contactId: c.id, date: '2026-11-30', documentIds: [iv.id] });
  expect(bn.total).toBe('10700.00');
  const rv = await api<{ id: string; docNo: string; totals: { cashIn: string; vatDue: string } }>('POST', 'receipts', {
    contactId: c.id, date: '2026-11-30', receiveAccount: '1100100', billingId: bn.id, whtRate: '0.03', whtCertNo: 'E2E/2569',
    applications: [{ documentId: iv.id, applied: '10400.00', wht: '300.00', whtBase: '10000.00' }] });
  expect(rv.totals).toMatchObject({ cashIn: '10400.00', vatDue: '700.00' });
  expect((await api<{ outstanding: string }>('GET', `documents/${iv.id}`)).outstanding).toBe('0.00');
  // แบบพิมพ์ใบเสร็จรับเงิน/ใบกำกับภาษี (D2) เป็น PDF A4
  const pdf = await request.get(`/print/receipt-tax/${rv.id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // หน้าจอแสดงใบเสร็จที่ลงบัญชีแล้ว
  await page.goto(`/finance/receipts/${rv.id}`);
  await expect(page.getByText(rv.docNo).first()).toBeVisible();
});
