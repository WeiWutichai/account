// PDF ของแบบพิมพ์รายเดือน D12–D15 (/print/<kind>/<YYYY-MM>/pdf) — วิธีเดียวกับ print/_lib/pdf.ts (M4) แต่พารามิเตอร์เป็นเดือน ไม่ใช่ UUID
// TODO(M4 owner): pdfRoute() ใน print/_lib/pdf.ts รับเฉพาะ UUID — ถ้ารวมให้รับ YYYY-MM ได้ ไฟล์นี้ลบได้
// ส่ง cookie ของผู้ใช้ไปเฉพาะ origin ของเว็บนี้ · origin มาจาก env ไม่ใช่ Host header (กัน SSRF)
import 'server-only';
import type { NextRequest } from 'next/server';
import { chromium, type Browser } from 'playwright-core';

const BASE = process.env.PRINT_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3010'}`;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/u;

let browser: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (browser) {
    const b = await browser.catch(() => null);
    if (b?.isConnected()) return b;
  }
  browser = chromium.launch();
  return browser;
}

export type MonthPrintKind = 'vat-sales' | 'vat-purchase' | 'pnd3' | 'pnd53';

/** GET /print/<kind>/<YYYY-MM>/pdf → application/pdf (A4) */
export function monthPdfRoute(kind: MonthPrintKind) {
  return async function GET(req: NextRequest, { params }: { params: Promise<{ month: string }> }): Promise<Response> {
    const { month } = await params;
    if (!YM.test(month)) return Response.json({ error: 'ระบุเดือนเป็น YYYY-MM' }, { status: 404 });
    const path = `/print/${kind}/${month}`;
    const b = await getBrowser();
    const ctx = await b.newContext({ viewport: { width: 794, height: 1123 } });
    try {
      const cookies = req.cookies.getAll().map((c) => ({ name: c.name, value: c.value, url: BASE }));
      if (cookies.length) await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      const landed = new URL(page.url());
      if (landed.origin !== new URL(BASE).origin || landed.pathname !== path) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
      if (!res?.ok()) return Response.json({ error: 'สร้าง PDF ไม่สำเร็จ' }, { status: 502 });
      await page.evaluate(async () => { await document.fonts.ready; });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      return new Response(new Uint8Array(pdf), {
        headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${kind}-${month}.pdf"`, 'cache-control': 'private, no-store' },
      });
    } finally {
      await ctx.close();
    }
  };
}
