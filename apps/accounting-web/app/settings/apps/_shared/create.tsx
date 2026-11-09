'use client';
// ฟอร์มสร้าง API key / ลงทะเบียน MCP client / เพิ่ม webhook — แบบร่าง (ScreenApps.dc.html "+ สร้าง API key" · ScreenMcp.dc.html "+ ลงทะเบียน client ใหม่")
// มีแต่ปุ่ม ไม่มีหน้าฟอร์ม → TODO(Wei): ฟอร์ม/ข้อความในกล่องนี้ไม่มีในแบบร่าง (ใช้หัวคอลัมน์ของแบบร่างเป็นป้ายช่อง)
// คีย์/secret แสดงครั้งเดียวจากคำตอบของ POST · เก็บใน state ของหน้าเท่านั้น (ไม่ลง storage) · ปิดกล่อง = หายถาวร
import { Button, css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ALLOWED_SCOPES, type ApiClient, INPUT, KIND_LABEL, LABEL, send, WEBHOOK_EVENTS } from './hub.ts';

const BOX = 'border: 1px solid #e0e0e0; padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px';
const SECRET = "font-family: 'IBM Plex Mono', monospace; font-size: 14px; background: #f4f4f4; padding: 8px 12px; word-break: break-all";

function OneTime({ label, value, note, onClose }: { label: string; value: string; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" style={css(`${BOX}; border-color: #0f62fe`)}>
      <strong>{label}</strong>
      <span style={css('font-size: 13px; color: #a2191f')}>แสดงครั้งเดียว — คัดลอกเก็บไว้ตอนนี้ ระบบเก็บเฉพาะค่า hash</span>
      <code data-testid="one-time-secret" style={css(SECRET)}>{value}</code>
      {note && <span style={css('font-size: 13px; color: #525252')}>{note}</span>}
      <div style={css('display: flex; gap: 8px')}>
        <Button kind="secondary" size={32} onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</Button>
        <Button kind="ghost" size={32} onClick={onClose}>ปิด</Button>
      </div>
    </div>
  );
}

export function CreateClient({ kinds, defaultScopes, onClose, endpointNote }: { kinds: ApiClient['kind'][]; defaultScopes: string[]; onClose: () => void; endpointNote?: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ApiClient['kind']>(kinds[0] ?? 'custom');
  const [scopes, setScopes] = useState<string[]>(defaultScopes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) { setErr('กรุณาระบุชื่อ'); return; }
    if (!scopes.length) { setErr('เลือกขอบเขตอย่างน้อย 1 รายการ'); return; }
    setBusy(true); setErr(null);
    const r = await send<{ id: string; key: string }>('/api/proxy/api-clients', 'POST', { name: name.trim(), kind, scopes });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setKey(r.data.key);
    router.refresh();
  }
  if (key) return <OneTime label={`API key ของ ${name}`} value={key} {...(endpointNote ? { note: endpointNote } : {})} onClose={() => { setKey(null); onClose(); }} />;
  return (
    <div style={css(BOX)}>
      <div style={css('display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px')}>
        <label style={css(LABEL)}>ชื่อ<input value={name} onChange={(e) => setName(e.target.value)} style={css(INPUT)} /></label>
        <label style={css(LABEL)}>ประเภท<select value={kind} onChange={(e) => setKind(e.target.value as ApiClient['kind'])} style={css(INPUT)}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
      </div>
      <fieldset style={css('border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 16px')}>
        <legend style={css('font-size: 13px; color: #525252; padding: 0; margin-bottom: 4px')}>ขอบเขต (scopes)</legend>
        {ALLOWED_SCOPES.map((s) => (
          <label key={s} style={css("display: flex; gap: 6px; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 13px")}>
            <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />{s}
          </label>
        ))}
      </fieldset>
      {err && <span role="alert" style={css('font-size: 13px; color: #a2191f')}>{err}</span>}
      <div style={css('display: flex; gap: 8px')}>
        <Button kind="primary" size={32} disabled={busy} onClick={() => void create()}>สร้าง API key</Button>
        <Button kind="secondary" size={32} onClick={onClose}>ยกเลิก</Button>
      </div>
    </div>
  );
}

export function CreateWebhook({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([...WEBHOOK_EVENTS]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    const r = await send<{ id: string; secret: string }>('/api/proxy/webhooks', 'POST', { url: url.trim(), events });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setSecret(r.data.secret);
    router.refresh();
  }
  if (secret) return <OneTime label={`Webhook secret ของ ${url}`} value={secret} note={'ใช้ตรวจลายเซ็น x-innovera-signature: sha256=HMAC(secret, "<timestamp>.<body>")'} onClose={() => { setSecret(null); onClose(); }} />;
  return (
    <div style={css(BOX)}>
      <label style={css(LABEL)}>URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" style={css(INPUT)} /></label>
      <fieldset style={css('border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 16px')}>
        <legend style={css('font-size: 13px; color: #525252; padding: 0; margin-bottom: 4px')}>เหตุการณ์</legend>
        {WEBHOOK_EVENTS.map((ev) => (
          <label key={ev} style={css("display: flex; gap: 6px; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 13px")}>
            <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((x) => (e.target.checked ? [...x, ev] : x.filter((y) => y !== ev)))} />{ev}
          </label>
        ))}
      </fieldset>
      {err && <span role="alert" style={css('font-size: 13px; color: #a2191f')}>{err}</span>}
      <div style={css('display: flex; gap: 8px')}>
        <Button kind="primary" size={32} disabled={busy} onClick={() => void create()}>เพิ่ม webhook</Button>
        <Button kind="secondary" size={32} onClick={onClose}>ยกเลิก</Button>
      </div>
    </div>
  );
}
