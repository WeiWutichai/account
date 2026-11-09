'use client';
// ปุ่ม "พิมพ์" บนหน้าเอกสารสำหรับลูกค้า (ScreenSendDoc.dc.html)
import { Button } from '@innovera/ui';

export function PrintButton() {
  return <Button size={36} onClick={() => window.print()}>พิมพ์</Button>;
}
