import type { NextConfig } from 'next';

// devIndicators ปิด: ไม่ให้ปุ่ม Next ทับภาพเทียบแบบร่าง (scripts/screens.mjs)
const config: NextConfig = { reactStrictMode: true, transpilePackages: ['@innovera/ui'], devIndicators: false };
export default config;
