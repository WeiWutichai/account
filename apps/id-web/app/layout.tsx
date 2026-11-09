import '@innovera/ui/tokens.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Innovera ID' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap" rel="stylesheet" />
        <style>{'body{margin:0} a{color:#0f62fe} a:hover{color:#0353e9}'}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
