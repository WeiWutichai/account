// API โมดูลสินค้าคงคลัง (Phase 2A INV · docs/technical-plan-P2A.md) — logic อยู่ใน @innovera/db/inventory
// Backend เท่านั้น: ยังไม่มีแบบร่าง .dc.html ของหน้าจอสต็อก · สิทธิ์ใช้พื้นที่เดิม: เอกสารสต็อก = ซื้อ (purchase) · ข้อมูลหลัก = journal (เหมือนหน้าสินค้า) · ยกเลิก = void · รายงาน = reports · ปิดงวด = period · ค่าตั้ง = settings
import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Db } from '@innovera/db';
import {
  disableInventory, enableInventory, findByBarcode, getStockDocument, inventoryStatus, listProductUnits, listStockDocuments, listWarehouses, postStockDocument, reorderReport, runInventoryPeriodEnd, saveStockDraft, saveWarehouse,
  section87Report, setInventorySetting, STOCK_TYPES, setProductStock, stockBalances, stockCard, stockValuation, voidStockDocument,
  type ProductStockInput, type StockDocInput, type WarehouseInput,
} from '@innovera/db/inventory';
import type { Request } from 'express';
import { companyOf, Need, roleOf, userOf } from './context.js';
import { DB } from './db.js';

const actor = (req: Request) => ({ userId: userOf(req).userId === 'dev' ? null : userOf(req).userId, role: roleOf(req) });
const today = () => process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10);

@Controller('v1/inventory')
export class InventoryController {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------- โมดูล + ค่าตั้ง [ผู้สอบบัญชี] ----------
  @Need('purchase', 'read') @Get('status')
  status(@Req() req: Request) { return inventoryStatus(this.db, companyOf(req)); }
  /** เปิดโมดูล: บัญชีของโมดูล (ไม่ทับชื่อเดิม) + คลังตั้งต้น */
  @Need('settings', 'write') @Post('enable')
  enable(@Req() req: Request, @Body() b?: { warehouseCode?: string; warehouseName?: string }) { return enableInventory(this.db, companyOf(req), b ?? {}); }
  @Need('settings', 'write') @Post('disable')
  disable(@Req() req: Request) { return disableInventory(this.db, companyOf(req)); }
  /** inventory.method / inventory.costing / inventory.writedown_nrv — รอผู้สอบบัญชี */
  @Need('settings', 'write') @Put('settings/:key')
  setting(@Req() req: Request, @Param('key') key: string, @Body() b: { value: unknown }) { return setInventorySetting(this.db, companyOf(req), key, b.value); }

  // ---------- คลัง / ข้อมูลสต็อกของสินค้า ----------
  @Need('purchase', 'read') @Get('warehouses')
  warehouses(@Req() req: Request) { return listWarehouses(this.db, companyOf(req)); }
  @Need('journal', 'write') @Post('warehouses')
  async addWarehouse(@Req() req: Request, @Body() b: WarehouseInput) { return { id: await saveWarehouse(this.db, companyOf(req), b) }; }
  @Need('journal', 'write') @Put('warehouses/:id')
  async editWarehouse(@Req() req: Request, @Param('id') id: string, @Body() b: WarehouseInput) { return { id: await saveWarehouse(this.db, companyOf(req), b, id) }; }
  @Need('journal', 'write') @Put('products/:code')
  product(@Req() req: Request, @Param('code') code: string, @Body() b: ProductStockInput) { return setProductStock(this.db, companyOf(req), code, b); }
  /** หน่วยนับเพิ่มเติมของทุกสินค้า (หน้าตั้งค่าสต็อกของสินค้า) */
  @Need('purchase', 'read') @Get('product-units')
  units(@Req() req: Request) { return listProductUnits(this.db, companyOf(req)); }
  @Need('purchase', 'read') @Get('barcode/:barcode')
  barcode(@Req() req: Request, @Param('barcode') barcode: string) { return findByBarcode(this.db, companyOf(req), barcode); }

  // ---------- เอกสาร GR / GI / TRF / ADJ ----------
  /** รายการเอกสารสต็อก · ?type=GR|GI|TRF|ADJ · ?status= */
  @Need('purchase', 'read') @Get('documents')
  list(@Req() req: Request, @Query() q: { type?: string; status?: string }) {
    const t = STOCK_TYPES.find((x) => x === q.type);
    return listStockDocuments(this.db, companyOf(req), { ...(t ? { docType: t } : {}), ...(q.status ? { status: q.status } : {}) });
  }
  @Need('purchase', 'write') @Post('documents')
  async create(@Req() req: Request, @Body() b: StockDocInput) { return { id: await saveStockDraft(this.db, companyOf(req), actor(req), b) }; }
  @Need('purchase', 'write') @Put('documents/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() b: StockDocInput) { return { id: await saveStockDraft(this.db, companyOf(req), actor(req), b, id) }; }
  @Need('purchase', 'read') @Get('documents/:id')
  get(@Req() req: Request, @Param('id') id: string) { return getStockDocument(this.db, companyOf(req), id); }
  @Need('purchase', 'post') @Post('documents/:id/post')
  postDoc(@Req() req: Request, @Param('id') id: string, @Body() b?: { lots?: Record<number, { lot?: string; serial?: string }> }) {
    return postStockDocument(this.db, companyOf(req), actor(req), id, { ...(b?.lots ? { lots: b.lots } : {}) });
  }
  @Need('void', 'post') @Post('documents/:id/void')
  voidDoc(@Req() req: Request, @Param('id') id: string, @Body() b: { reason: string; date?: string }) { return voidStockDocument(this.db, companyOf(req), actor(req), id, b); }

  // ---------- ปรับสินค้าปลายงวด (periodic) ----------
  @Need('period', 'post') @Post('period-end/:year/:no')
  periodEnd(@Req() req: Request, @Param('year') year: string, @Param('no') no: string) {
    return runInventoryPeriodEnd(this.db, companyOf(req), actor(req), { fiscalYear: Number(year), periodNo: Number(no) });
  }

  // ---------- รายงาน ----------
  @Need('reports', 'read') @Get('balances')
  balances(@Req() req: Request, @Query() q: { product?: string; warehouse?: string }) {
    return stockBalances(this.db, companyOf(req), { ...(q.product ? { productCode: q.product } : {}), ...(q.warehouse ? { warehouseId: q.warehouse } : {}) });
  }
  @Need('reports', 'read') @Get('valuation')
  valuation(@Req() req: Request, @Query() q: { asOf?: string; warehouse?: string }) { return stockValuation(this.db, companyOf(req), q.asOf ?? today(), { warehouseId: q.warehouse ?? null }); }
  @Need('reports', 'read') @Get('stock-card/:code')
  card(@Req() req: Request, @Param('code') code: string, @Query() q: { from?: string; to?: string; warehouse?: string }) {
    return stockCard(this.db, companyOf(req), { productCode: code, warehouseId: q.warehouse ?? null, from: q.from ?? `${today().slice(0, 7)}-01`, to: q.to ?? today() });
  }
  @Need('reports', 'read') @Get('reorder')
  reorder(@Req() req: Request) { return reorderReport(this.db, companyOf(req)); }
  /** รายงานสินค้าและวัตถุดิบ ม.87(3) — โครง (รูปแบบทางการรอยืนยัน) */
  @Need('reports', 'read') @Get('section87/:month')
  section87(@Req() req: Request, @Param('month') month: string, @Query('warehouse') warehouse?: string) { return section87Report(this.db, companyOf(req), month, { warehouseId: warehouse ?? null }); }
}
