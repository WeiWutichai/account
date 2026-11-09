// การเชื่อมต่อของ spike · แอปต่อผ่าน PgBouncer (transaction mode) เสมอ · setup/ops ต่อตรงด้วย superuser
import pg from 'pg';

export const APP_URL = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:56432/innovera';
export const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/innovera';

export const N_COMPANIES = Number(process.env.SPIKE_COMPANIES ?? 300);
export const N_BIG = 10;
export const J_SMALL = Number(process.env.SPIKE_J_SMALL ?? 2000);
export const J_BIG = Number(process.env.SPIKE_J_BIG ?? 50000);

export interface CompanyRow {
  id: string;
  schema_name: string;
  size_class: 'big' | 'small';
}

export async function loadCompanies(pool: pg.Pool): Promise<CompanyRow[]> {
  const r = await pool.query<CompanyRow>('select id, schema_name, size_class from public.company order by schema_name');
  return r.rows;
}
