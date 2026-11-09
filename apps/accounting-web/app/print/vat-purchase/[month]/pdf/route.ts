// PDF ของ /print/vat-purchase/[month] (A4 · Chromium ฝั่ง server)
import { monthPdfRoute } from '../../../../tax/_lib/month-pdf';

export const GET = monthPdfRoute('vat-purchase');
