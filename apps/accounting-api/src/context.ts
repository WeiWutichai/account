// context ของ request · M2: บริษัท/บทบาทมาจาก header (ใช้ใน dev เท่านั้น)
// TODO(M3): แทนด้วย session ของ Innovera ID + ตรวจ membership/role ของบริษัททุก route (PLAN §2) — ห้ามเปิด production ก่อน M3
import { BadRequestException } from '@nestjs/common';
import type { CompanyRole } from '@innovera/ledger';
import type { Request } from 'express';

const ROLES: readonly CompanyRole[] = ['owner', 'accounting_manager', 'accountant', 'ar_clerk', 'ap_clerk', 'viewer', 'auditor'];

export function companyOf(req: Request): string {
  const id = req.header('x-company-id') ?? process.env.DEV_COMPANY_ID;
  if (!id) throw new BadRequestException('ต้องระบุบริษัท (x-company-id)');
  return id;
}
export function roleOf(req: Request): CompanyRole {
  const r = (req.header('x-role') ?? 'accountant') as CompanyRole;
  if (!ROLES.includes(r)) throw new BadRequestException(`บทบาทไม่ถูกต้อง: ${r}`);
  return r;
}
