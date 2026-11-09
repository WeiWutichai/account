// แปลง error ทางบัญชีเป็น 422 พร้อมข้อความภาษาไทย (ไม่หลุด stack ให้ผู้ใช้)
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { LedgerError } from '@innovera/db/ledger';
import { PostingError, UnbalancedJournalError } from '@innovera/ledger';
import type { Response } from 'express';

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) return res.status(e.getStatus()).json({ error: e.message });
    if (e instanceof LedgerError || e instanceof PostingError || e instanceof UnbalancedJournalError) return res.status(422).json({ error: e.message });
    const msg = (e as Error).message ?? '';
    if (/ไม่ดุล|ปิดแข็ง|row-level security|ไม่ใช่ร่าง|violates|ตัดยอดเกิน/u.test(msg)) return res.status(422).json({ error: msg.split('\n')[0] });
    console.error(e);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
  }
}
