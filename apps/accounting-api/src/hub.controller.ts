// หน้าจอ M7 ในระบบ: แอปที่เชื่อมต่อ (G3) · MCP (G6) · Audit log · เพิกถอนสิทธิ์ — ตั้งค่าได้เฉพาะผู้มีสิทธิ์ settings
import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Db } from '@innovera/db';
import { addWebhook, setWebhookActive, auditLog, createApiClient, listApiClients, redeliver, revokeApiClient, verifyAuditChain, webhookStatus, type ApiScope, type WebhookEventName } from '@innovera/db/hub';
import type { Request } from 'express';
import { companyOf, Need, userOf } from './context.js';
import { DB } from './db.js';

@Controller('v1')
export class HubController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Need('settings', 'read') @Get('api-clients')
  clients(@Req() req: Request) { return listApiClients(this.db, companyOf(req)); }
  /** key แสดงครั้งเดียวในคำตอบนี้ */
  @Need('settings', 'write') @Post('api-clients')
  create(@Req() req: Request, @Body() b: { name: string; kind: 'tms' | 'mcp' | 'custom'; scopes: ApiScope[] }) {
    const u = userOf(req).userId;
    return createApiClient(this.db, companyOf(req), u === 'dev' ? null : u, b);
  }
  @Need('settings', 'write') @Delete('api-clients/:id')
  async revoke(@Req() req: Request, @Param('id') id: string, @Body() b?: { reason?: string }) {
    const u = userOf(req).userId;
    await revokeApiClient(this.db, companyOf(req), id, u === 'dev' ? null : u, b?.reason ?? '');
    return { ok: true };
  }
  @Need('settings', 'write') @Post('webhooks/:id/active')
  async active(@Req() req: Request, @Param('id') id: string, @Body() b: { active: boolean }) { await setWebhookActive(this.db, companyOf(req), id, b.active === true); return { ok: true }; }
  @Need('settings', 'read') @Get('webhooks')
  webhooks(@Req() req: Request) { return webhookStatus(this.db, companyOf(req)); }
  @Need('settings', 'write') @Post('webhooks')
  addHook(@Req() req: Request, @Body() b: { url: string; events: WebhookEventName[] }) { return addWebhook(this.db, companyOf(req), b); }
  @Need('settings', 'write') @Post('webhooks/deliveries/:id/redeliver')
  async again(@Req() req: Request, @Param('id') id: string) { await redeliver(this.db, companyOf(req), id); return { ok: true }; }
  @Need('reports', 'read') @Get('audit')
  audit(@Req() req: Request, @Query('entity') entity?: string) { return auditLog(this.db, companyOf(req), entity ? { entity } : {}); }
  @Need('reports', 'read') @Get('audit/verify')
  verify(@Req() req: Request) { return verifyAuditChain(this.db, companyOf(req)); }
}
