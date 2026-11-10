// API ภายนอกสำหรับแอป Innovera (TMS) และ MCP — PLAN §5 · ยืนยันด้วย API key (Bearer inn_…) ต่อบริษัท
// สร้างได้แค่ "ร่าง" · scope ไม่มี post/pay/periods/users/settings · ทุก route ตรวจ scope
import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpException, Inject, Injectable, NotFoundException, Param, Post, Put, Query, Req, Res, SetMetadata, UnauthorizedException, UseGuards, UseInterceptors, type CallHandler, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DocumentDraftCreate } from '@innovera/contracts';
import type { Db } from '@innovera/db';
import { addWebhook, recordApiCall, syncContacts, verifyApiKey, type ApiCallInput, type ApiScope, type WebhookEventName } from '@innovera/db/hub';
import { createDraftDocument, trialBalance } from '@innovera/db/ledger';
import { getDocument, listDocuments } from '@innovera/db/sales';
import { recordUsage } from '@innovera/db/contract';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import { z } from 'zod';
import { Public } from './context.js';
import { DB } from './db.js';

type ApiReq = Request & { api?: NonNullable<Awaited<ReturnType<typeof verifyApiKey>>> };
const SCOPE = 'ext-scope';
const Scope = (s: ApiScope) => SetMetadata(SCOPE, s);

class ScopeDenied extends Error {}
/** บันทึกสถิติการเรียก (acct.api_call) — ล้มเหลวไม่ทำให้คำขอล้ม */
function track(db: Db, companyId: string, row: ApiCallInput) {
  void recordApiCall(db, companyId, row).catch((e: Error) => console.error(`[api_call] ${e.message}`));
}
const routeOf = (req: Request) => `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db, @Inject(Reflector) private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ApiReq>();
    const key = req.header('authorization')?.match(/^Bearer (inn_\S+)$/u)?.[1];
    if (!key) throw new UnauthorizedException('ต้องใช้ API key (Authorization: Bearer inn_…)');
    const c = await verifyApiKey(this.db, key);
    if (!c) throw new UnauthorizedException('API key ไม่ถูกต้อง ถูกเพิกถอน หรือถูกระงับชั่วคราว');
    const need = this.reflector.get<ApiScope | undefined>(SCOPE, ctx.getHandler());
    if (need && !c.scopes.includes(need)) {
      track(this.db, c.companyId, { clientId: c.id, kind: 'api', tool: routeOf(req), status: 'denied', detail: `ไม่มี scope ${need}` });
      throw new ForbiddenException(`ต้องมี scope ${need}`);
    }
    req.api = c;
    return true;
  }
}

/** สถิติการเรียก REST (/ext/v1/* ยกเว้น mcp ซึ่งบันทึกรายเครื่องมือ) */
@Injectable()
export class ApiCallInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<ApiReq>();
    const api = req.api;
    if (!api || req.path.startsWith('/ext/v1/mcp')) return next.handle();
    const tool = routeOf(req);
    return next.handle().pipe(tap({
      next: (v: unknown) => {
        const id = v && typeof v === 'object' && !Array.isArray(v) && 'id' in v && typeof v.id === 'string' && /^[0-9a-f-]{36}$/u.test(v.id) ? v.id : null;
        track(this.db, api.companyId, { clientId: api.id, kind: 'api', tool, status: 'ok', documentId: tool.includes('documents') ? id : null });
      },
      error: (e: unknown) => track(this.db, api.companyId, { clientId: api.id, kind: 'api', tool, status: e instanceof ForbiddenException ? 'denied' : 'error',
        detail: e instanceof HttpException || e instanceof Error ? e.message : null }),
    }));
  }
}

const UsageBody = z.object({
  contract_code: z.string().min(1), line_no: z.number().int().positive(), usage_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), qty: z.string().regex(/^\d+(\.\d{1,4})?$/u),
  external_source: z.string().min(1), external_ref: z.string().min(1),
});

const shape = (d: NonNullable<Awaited<ReturnType<typeof getDocument>>>) => ({
  id: d.doc.id, doc_type: d.doc.doc_type, doc_no: d.doc.doc_no, status: d.doc.status, issue_date: d.doc.issue_date, due_date: d.doc.due_date,
  external_source: d.doc.external_source, external_ref: d.doc.external_ref, subtotal: d.doc.subtotal, vat: d.doc.vat, grand_total: d.doc.grand_total, outstanding: d.outstanding,
  contact: d.contact ? { code: d.contact.code, name: d.contact.name, tax_id: d.contact.tax_id } : null,
  lines: d.lines.map((l) => ({ line_no: l.line_no, description: l.description, qty: l.qty, unit_price: l.unit_price, amount: l.amount })),
});

@Public()
@UseGuards(ApiKeyGuard)
@UseInterceptors(ApiCallInterceptor)
@Controller('ext/v1')
export class ExtController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Scope('documents:draft') @Post('documents')
  async create(@Req() req: ApiReq, @Body() body: unknown) {
    const items = Array.isArray(body) ? body : [body];
    if (items.length > 500) throw new BadRequestException('ส่งได้ครั้งละไม่เกิน 500 เอกสาร');
    const parsed = items.map((x, i) => { const r = DocumentDraftCreate.safeParse(x); if (!r.success) throw new BadRequestException(`เอกสารที่ ${i + 1}: ${r.error.issues.map((e) => `${e.path.join('.')} ${e.message}`).join('; ')}`); return r.data; });
    const out = [];
    for (const d of parsed) out.push(await createDraftDocument(this.db, req.api!.companyId, d as never, req.api!.id));
    return Array.isArray(body) ? out : out[0];
  }
  /**
   * ยอดใช้งานของสัญญาแบบคิดตามการใช้งาน (Phase 2A SWT) — ข้อมูลร่าง ไม่ลงบัญชี (ออกเป็นบรรทัดใน IV ร่างของรอบบิลถัดไป · ผู้ใช้อนุมัติเอง)
   * ใช้ scope documents:draft (ไม่เพิ่ม scope ใหม่) · idempotent ด้วย external_source + external_ref
   */
  @Scope('documents:draft') @Post('usage')
  async usage(@Req() req: ApiReq, @Body() body: unknown) {
    const items = Array.isArray(body) ? body : [body];
    if (items.length > 500) throw new BadRequestException('ส่งได้ครั้งละไม่เกิน 500 รายการ');
    const out = [];
    for (const [i, x] of items.entries()) {
      const r = UsageBody.safeParse(x);
      if (!r.success) throw new BadRequestException(`รายการที่ ${i + 1}: ${r.error.issues.map((e) => `${e.path.join('.')} ${e.message}`).join('; ')}`);
      out.push(await recordUsage(this.db, req.api!.companyId, { contractCode: r.data.contract_code, lineNo: r.data.line_no, usageDate: r.data.usage_date, qty: r.data.qty,
        externalSource: r.data.external_source, externalRef: r.data.external_ref }, req.api!.id));
    }
    return Array.isArray(body) ? out : out[0];
  }
  @Scope('documents:read') @Get('documents/:id')
  async get(@Req() req: ApiReq, @Param('id') id: string) {
    const d = await getDocument(this.db, req.api!.companyId, id);
    if (!d) throw new NotFoundException('ไม่พบเอกสาร');
    return shape(d);
  }
  @Scope('documents:read') @Get('documents')
  async find(@Req() req: ApiReq, @Query('external_ref') ref?: string, @Query('external_source') src?: string) {
    if (!ref) throw new BadRequestException('ระบุ external_ref');
    const ids = await this.db.withCompany(req.api!.companyId, (tx) => {
      let q = tx.selectFrom('acct.document').select('id').where('external_ref', '=', ref);
      if (src) q = q.where('external_source', '=', src);
      return q.execute();
    });
    const out = [];
    for (const { id } of ids) { const d = await getDocument(this.db, req.api!.companyId, id); if (d) out.push(shape(d)); }
    return out;
  }
  @Scope('contacts:read') @Get('contacts')
  contacts(@Req() req: ApiReq) {
    return this.db.withCompany(req.api!.companyId, (tx) => tx.selectFrom('acct.contact').select(['id', 'code', 'name', 'kind', 'tax_id', 'branch_code', 'external_source', 'external_ref']).orderBy('code').execute());
  }
  @Scope('contacts:draft') @Put('contacts')
  sync(@Req() req: ApiReq, @Body() body: Parameters<typeof syncContacts>[2]) {
    if (!Array.isArray(body) || body.length > 500) throw new BadRequestException('ส่งเป็นรายการ ไม่เกิน 500');
    return syncContacts(this.db, req.api!.companyId, body, req.api!.id);
  }
  @Scope('ledger:read') @Get('ledger/balances')
  balances(@Req() req: Request & ApiReq, @Query('year') year: string, @Query('period') period?: string) {
    // TODO(M7): แยกตามมิติ (dimension=project/vehicle/trip) — journal_line ยังมีแค่ project_code
    return trialBalance(this.db, req.api!.companyId, { fiscalYear: Number(year), ...(period ? { upToPeriod: Number(period) } : {}) });
  }
  @Scope('webhooks:manage') @Post('webhooks')
  webhook(@Req() req: ApiReq, @Body() b: { url: string; events: WebhookEventName[] }) { return addWebhook(this.db, req.api!.companyId, { ...b, apiClientId: req.api!.id }); }

  /** MCP (Streamable HTTP, stateless) — เครื่องมืออ่าน + สร้างร่างเท่านั้น · post_document ถูกปฏิเสธเสมอ */
  @Post('mcp')
  async mcp(@Req() req: ApiReq, @Res() res: Response) {
    const api = req.api!;
    const server = new McpServer({ name: 'innovera-accounting', version: '1.0.0' });
    const can = (s: ApiScope) => { if (!api.scopes.includes(s)) throw new ScopeDenied(`ต้องมี scope ${s}`); };
    const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
    /** ห่อเครื่องมือ: บันทึก acct.api_call (ok / denied เมื่อไม่มี scope / error) */
    type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
    const tool = <A,>(name: string, fn: (a: A) => Promise<ToolResult & { documentId?: string | null }>) => async (a: A): Promise<ToolResult> => {
      try {
        const { documentId, ...r } = await fn(a);
        track(this.db, api.companyId, { clientId: api.id, kind: 'mcp', tool: name, status: r.isError ? 'error' : 'ok', documentId: documentId ?? null });
        return r;
      } catch (e) {
        track(this.db, api.companyId, { clientId: api.id, kind: 'mcp', tool: name, status: e instanceof ScopeDenied ? 'denied' : 'error', detail: (e as Error).message });
        throw e;
      }
    };
    server.registerTool('list_documents', { description: 'รายการเอกสาร (กรองประเภท/สถานะ/ช่วงวันที่)', inputSchema: { type: z.string().optional(), status: z.string().optional(), from: z.string().optional(), to: z.string().optional() } },
      tool('list_documents', async (a: { type?: string | undefined; status?: string | undefined; from?: string | undefined; to?: string | undefined }) => { can('documents:read'); return text(await listDocuments(this.db, api.companyId, { ...(a.type ? { docType: a.type.split(',') } : {}), ...(a.status ? { status: a.status } : {}), ...(a.from ? { from: a.from } : {}), ...(a.to ? { to: a.to } : {}), limit: 100 })); }));
    server.registerTool('get_document', { description: 'รายละเอียดเอกสาร', inputSchema: { id: z.string().uuid() } },
      tool('get_document', async (a: { id: string }) => { can('documents:read'); const d = await getDocument(this.db, api.companyId, a.id); return d ? { ...text(shape(d)), documentId: d.doc.id } : { content: [{ type: 'text' as const, text: 'ไม่พบเอกสาร' }], isError: true }; }));
    server.registerTool('trial_balance', { description: 'งบทดลองของปีบัญชี (พ.ศ.)', inputSchema: { fiscal_year: z.number().int(), up_to_period: z.number().int().min(0).max(13).optional() } },
      tool('trial_balance', async (a: { fiscal_year: number; up_to_period?: number | undefined }) => { can('ledger:read'); return text(await trialBalance(this.db, api.companyId, { fiscalYear: a.fiscal_year, ...(a.up_to_period !== undefined ? { upToPeriod: a.up_to_period } : {}) })); }));
    server.registerTool('create_draft_document', { description: 'สร้างเอกสาร "ร่าง" (ผู้ใช้ต้องตรวจและอนุมัติในระบบเอง)', inputSchema: { document: z.record(z.string(), z.unknown()) } },
      tool('create_draft_document', async (a: { document: Record<string, unknown> }) => { can('documents:draft'); const d = DocumentDraftCreate.parse(a.document); const r = await createDraftDocument(this.db, api.companyId, d as never, api.id); return { ...text(r), documentId: r.id }; }));
    // ปฏิเสธเสมอ → บันทึกเป็น denied (ScreenMcp "post_document(…) ปฏิเสธ · ไม่มี scope")
    server.registerTool('post_document', { description: 'ไม่อนุญาต — การลงบัญชีทำได้เฉพาะผู้ใช้ในระบบ' },
      async () => {
        track(this.db, api.companyId, { clientId: api.id, kind: 'mcp', tool: 'post_document', status: 'denied', detail: 'ไม่มี scope documents:post' });
        return { content: [{ type: 'text' as const, text: 'ปฏิเสธ: API/MCP สร้างได้แค่เอกสารร่าง การลงบัญชี/จ่ายเงิน/ปิดงวดต้องทำโดยผู้ใช้ในระบบ (PLAN §5)' }], isError: true };
      });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
