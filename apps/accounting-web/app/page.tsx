// หน้าแรก (Main · คิวงาน) — ทำใน M4 · ตอนนี้พาไปหน้าบัญชีที่ใช้งานได้แล้ว
import { redirect } from 'next/navigation';

export const SERVICE_HOME = 'accounting-web';
export default function Home() {
  redirect('/gl/accounts');
}
