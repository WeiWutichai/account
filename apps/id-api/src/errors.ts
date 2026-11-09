// แปลง IdError → HTTP · error อื่นไม่หลุด stack
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { IdError } from './identity.ts';

@Catch()
export class IdErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof IdError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    if (e instanceof HttpException) return res.status(e.getStatus()).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
  }
}
