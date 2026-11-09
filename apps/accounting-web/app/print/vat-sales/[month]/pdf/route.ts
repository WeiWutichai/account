// PDF ของ /print/vat-sales/[month] (A4 · Chromium ฝั่ง server)
import { monthPdfRoute } from '../../../../tax/_lib/month-pdf';

export const GET = monthPdfRoute('vat-sales');
