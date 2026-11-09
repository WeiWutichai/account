'use client';
// ตัวเลือกงวด + "ตรวจใหม่ตอนนี้" ของ ScreenReconReport.dc.html (หัวหน้า)
import { buttonStyle, css } from '@innovera/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function ReconControls({ ym, options }: { ym: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <div style={css('display: flex; gap: 8px; align-items: center')}>
      {/* TODO(backend) ScreenReconReport.dc.html: ตัวเลือก "ปีบัญชี 2569 สะสม" — GET /v1/reports/recon รับเฉพาะเดือน (?month=) */}
      <select aria-label="งวด" value={ym} onChange={(e) => router.push(`/tax/recon?month=${e.target.value}`)} style={css('height: 32px; padding: 0 12px; border: 1px solid #8d8d8d; background: #ffffff; font-family: inherit; font-size: 13px')}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={() => start(() => router.refresh())} style={buttonStyle('secondary', 32, busy)}>ตรวจใหม่ตอนนี้</button>
    </div>
  );
}
