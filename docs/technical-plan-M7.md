# Technical Plan — M7 Hub

> สถานะ: **อนุมัติล่วงหน้า** (Wei 2026-11-09/10) · อ้างอิง `PLAN.md` §5, §6 (M7) · แบบร่าง ScreenApps (G3) · ScreenMcp (G6) · ScreenAudit · ScreenRevoke

## Gate
contract tests กับ mock TMS · webhook retry/dead-letter test · MCP ปฏิเสธ post_document

## ทำแล้ว (backend)
- **Audit hash chain**: trigger `acct.audit_chain` (sha256 ต่อบริษัท · advisory lock) + `verifyAuditChain` · append-only เดิม (แก้ไม่ได้แม้เจ้าของตาราง) · migration 0012
- **API client** (`public.api_client`): key `inn_<kind>_…` แสดงครั้งเดียว เก็บ sha256 · scope ตาม PLAN §5 (CHECK ใน DB) — ไม่มี post/pay/periods/users/settings
- **API ภายนอก** `/ext/v1`: `POST documents` (≤ 500 · zod `DocumentDraftCreate` · ร่างเท่านั้น · idempotent `external_source + external_ref`) · `GET documents/:id` · `GET documents?external_ref=` · `GET/PUT contacts` (sync ด้วย tax_id/external_ref) · `GET ledger/balances` · `POST webhooks`
- **Webhooks**: outbox ในธุรกรรมเดียวกับการลงบัญชี (`document.posted`, `document.voided`, `payment.received`, `payment.paid`, `period.closed`) · HMAC-SHA256 (`x-innovera-signature: sha256=HMAC(secret, "<timestamp>.<body>")`) · ส่ง 1 + ลองใหม่ 3 ครั้ง (1 นาที / 5 นาที / 30 นาที) → dead-letter · ส่งใหม่ได้ · worker ใน accounting-api ทุก 30 วินาที
- **MCP** (`POST /ext/v1/mcp`, Streamable HTTP stateless, `@modelcontextprotocol/sdk` 1.32.2): `list_documents` · `get_document` · `trial_balance` · `create_draft_document` · `post_document` → ปฏิเสธเสมอ (ทดสอบผ่าน HTTP จริง)
- Endpoint ภายในสำหรับหน้าจอ: `/v1/api-clients`, `/v1/webhooks`, `/v1/audit`, `/v1/audit/verify`
- Tests `packages/db/test/m7.test.ts` (key/scope · idempotent draft · webhook HMAC · retry → dead-letter · แยกบริษัท · hash chain)

## ต่างจากแผน / ค้าง
- **OAuth 2.1 + PKCE (PLAN: "OAuth connect สำหรับ TMS")** ยังไม่ได้ทำ — v1 ใช้ API key ต่อบริษัทที่ผู้มีสิทธิ์ออกให้ · TODO(Wei): ยืนยันว่า API key พอสำหรับนำร่องหรือต้องทำ OAuth ก่อนเปิด TMS
- contract test กับ mock TMS แบบเต็ม (ตอนนี้ทดสอบระดับ service + smoke HTTP)
- ยอดตามมิติ (project/vehicle/trip) ใน `ledger/balances` · UI 4 หน้า (ScreenApps, ScreenMcp, ScreenAudit, ScreenRevoke)
