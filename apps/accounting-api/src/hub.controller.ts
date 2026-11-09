// หน้าจอ M7 ในระบบ: แอปที่เชื่อมต่อ (G3) · MCP (G6) · Audit log · เพิกถอนสิทธิ์ — ตั้งค่าได้เฉพาะผู้มีสิทธิ์ settings
import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Db } from '@innovera/db';
import {
  addWebhook, apiClientActivity, auditLog, createApiClient, listApiClients, makeApiClientReadOnly, redeliver, resumeApiClient, revokeApiClient, setWebhookActive, suspendApiClient,
  updateApiClientScopes, verifyAuditChain, webhookStatus, type ApiScope, type WebhookEventName,
} from '@innovera/db/hub';
import type { Request } from 'express';
import { actorIdOf, companyOf, Need } from './context.js';
import { DB } from './db.js';

const int = (v: string | undefined) => (v && /^\d+$/u.test(v) ? Number(v) : undefined);

@Controller('v1')
export class HubController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** ทุก client ของบริษัท + ผู้อนุญาต/ผู้เพิกถอน (ชื่อ) + สถานะระงับ + จำนวนเรียก/ถูกปฏิเสธ 7 วัน + ร่างที่สร้างรอตรวจ */
  @Need('settings', 'read') @Get('api-clients')
  clients(@Req() req: Request) { return listApiClients(this.db, companyOf(req)); }
  /** ScreenMcp "ล่าสุดจาก client" (ทุก client) */
  @Need('settings', 'read') @Get('api-clients/activity')
  activity(@Req() req: Request) { return apiClientActivity(this.db, companyOf(req)); }
  /** ScreenRevoke: กิจกรรม 24 ชม. + เอกสารร่าง/คู่ค้าที่ client นี้สร้าง */
  @Need('settings', 'read') @Get('api-clients/:id/activity')
  clientActivity(@Req() req: Request, @Param('id') id: string) { return apiClientActivity(this.db, companyOf(req), id); }
  /** key แสดงครั้งเดียวในคำตอบนี้ */
  @Need('settings', 'write') @Post('api-clients')
  create(@Req() req: Request, @Body() b: { name: string; kind: 'tms' | 'mcp' | 'custom'; scopes: ApiScope[] }) {
    return createApiClient(this.db, companyOf(req), actorIdOf(req), b);
  }
  /** เพิกถอน (ScreenRevoke): เหตุผลบังคับ · notify = เข้าคิวอีเมลถึง Owner + ผู้อนุญาตเดิม · deleteDraftIds = ร่างของ client นี้ที่ไม่คงไว้ (ลบ)
   *  TODO(Wei/backend): "ต้องยืนยันด้วยรหัส 2FA" — id-api ยังไม่มี endpoint step-up (ยืนยัน TOTP ของผู้ที่เข้าสู่ระบบแล้ว แล้วออก token ที่ accounting-api ตรวจได้) */
  @Need('settings', 'write') @Delete('api-clients/:id')
  async revoke(@Req() req: Request, @Param('id') id: string, @Body() b?: { reason?: string; notify?: boolean; deleteDraftIds?: string[] }) {
    const reason = b?.reason?.trim() ?? '';
    if (!reason) throw new BadRequestException('ต้องระบุเหตุผล');
    const del = Array.isArray(b?.deleteDraftIds) ? b.deleteDraftIds.filter((x): x is string => typeof x === 'string') : [];
    return { ok: true, ...(await revokeApiClient(this.db, companyOf(req), id, actorIdOf(req), reason, { notify: b?.notify === true, deleteDraftIds: del })) };
  }
  /** ระงับชั่วคราว (ค่าตั้งต้น 7 วัน) */
  @Need('settings', 'write') @Post('api-clients/:id/suspend')
  suspend(@Req() req: Request, @Param('id') id: string, @Body() b?: { days?: number; reason?: string }) {
    return suspendApiClient(this.db, companyOf(req), id, actorIdOf(req), { ...(b?.days !== undefined ? { days: b.days } : {}), reason: b?.reason ?? '' });
  }
  @Need('settings', 'write') @Post('api-clients/:id/resume')
  async resume(@Req() req: Request, @Param('id') id: string) { await resumeApiClient(this.db, companyOf(req), id, actorIdOf(req)); return { ok: true }; }
  /** แก้ scopes — เฉพาะ scope ที่อนุญาต (ไม่มี post/pay/periods/users/settings) */
  @Need('settings', 'write') @Put('api-clients/:id/scopes')
  scopes(@Req() req: Request, @Param('id') id: string, @Body() b: { scopes: string[]; reason?: string }) {
    if (!Array.isArray(b?.scopes)) throw new BadRequestException('ระบุ scopes เป็นรายการ');
    return updateApiClientScopes(this.db, companyOf(req), id, actorIdOf(req), b.scopes, b.reason ?? '');
  }
  /** ScreenRevoke "ลดสิทธิ์เป็นอ่านอย่างเดียว" */
  @Need('settings', 'write') @Post('api-clients/:id/read-only')
  readOnly(@Req() req: Request, @Param('id') id: string, @Body() b?: { reason?: string }) { return makeApiClientReadOnly(this.db, companyOf(req), id, actorIdOf(req), b?.reason ?? ''); }
  @Need('settings', 'write') @Post('webhooks/:id/active')
  async active(@Req() req: Request, @Param('id') id: string, @Body() b: { active: boolean }) { await setWebhookActive(this.db, companyOf(req), id, b.active === true); return { ok: true }; }
  @Need('settings', 'read') @Get('webhooks')
  webhooks(@Req() req: Request) { return webhookStatus(this.db, companyOf(req)); }
  @Need('settings', 'write') @Post('webhooks')
  addHook(@Req() req: Request, @Body() b: { url: string; events: WebhookEventName[] }) { return addWebhook(this.db, companyOf(req), b); }
  @Need('settings', 'write') @Post('webhooks/deliveries/:id/redeliver')
  async again(@Req() req: Request, @Param('id') id: string) { await redeliver(this.db, companyOf(req), id); return { ok: true }; }
  /** แบ่งหน้าฝั่ง server: ?limit (≤1000, ค่าตั้งต้น 50) &offset · ตัวกรอง ?category &actor (user id | client:<id> | system) &from &to (YYYY-MM-DD เวลาไทย) &q &important=1 &entity
   *  → { rows, count, limit, offset, actors } */
  @Need('reports', 'read') @Get('audit')
  audit(@Req() req: Request, @Query() q: Record<string, string | undefined>) {
    const limit = int(q.limit);
    const offset = int(q.offset);
    return auditLog(this.db, companyOf(req), {
      ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}), ...(q.entity ? { entity: q.entity } : {}), ...(q.category ? { category: q.category } : {}),
      ...(q.actor ? { actor: q.actor } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), ...(q.q ? { q: q.q } : {}), important: q.important === '1' || q.important === 'true',
    });
  }
  @Need('reports', 'read') @Get('audit/verify')
  verify(@Req() req: Request) { return verifyAuditChain(this.db, companyOf(req)); }
}
