import type { ReactNode } from 'react';

export const metadata = { title: 'AccountSystem' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: "'IBM Plex Sans Thai', system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
