// PDF ของแบบพิมพ์ D* (technical-plan-M4 §4): เปิดหน้า HTML /print/<kind>/<id> ด้วย Chromium ฝั่ง server แล้ว page.pdf (A4)
// ส่ง cookie ของผู้ใช้ไปเฉพาะ origin ของเว็บนี้ (ไม่ใช้ extraHTTPHeaders → ไม่รั่วไป Google Fonts) · origin มาจาก env ไม่ใช่ Host header (กัน SSRF)
import 'server-only';
import type { NextRequest } from 'next/server';
import { chromium, type Browser } from 'playwright-core';

const BASE = process.env.PRINT_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3010'}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

let browser: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (browser) {
    const b = await browser.catch(() => null);
    if (b?.isConnected()) return b;
  }
  browser = chromium.launch();
  return browser;
}

export type PrintKind = 'invoice' | 'receipt-tax' | 'credit-note' | 'debit-note' | 'billing' | 'quote' | 'receipt' | 'receipt-voucher'
  | 'wht50' | 'payment-voucher' | 'purchase-order'; // M5 (D4 · D7 · D9)

/** GET /print/<kind>/<id>/pdf → application/pdf (A4) */
export function pdfRoute(kind: PrintKind) {
  return async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params;
    if (!UUID.test(id)) return Response.json({ error: 'ไม่พบเอกสาร' }, { status: 404 });
    const path = `/print/${kind}/${id}`;
    const copy = req.nextUrl.searchParams.get('copy') === '1' ? '?copy=1' : '';
    const b = await getBrowser();
    const ctx = await b.newContext({ viewport: { width: 794, height: 1123 } });
    try {
      const cookies = req.cookies.getAll().map((c) => ({ name: c.name, value: c.value, url: BASE }));
      if (cookies.length) await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      const res = await page.goto(`${BASE}${path}${copy}`, { waitUntil: 'networkidle' });
      const landed = new URL(page.url());
      if (landed.origin !== new URL(BASE).origin || landed.pathname !== path) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
      if (!res?.ok()) return Response.json({ error: res?.status() === 404 ? 'ไม่พบเอกสาร' : 'สร้าง PDF ไม่สำเร็จ' }, { status: res?.status() === 404 ? 404 : 502 });
      await page.evaluate(async () => { await document.fonts.ready; });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      return new Response(new Uint8Array(pdf), {
        headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${kind}-${id}.pdf"`, 'cache-control': 'private, no-store' },
      });
    } finally {
      await ctx.close();
    }
  };
}
