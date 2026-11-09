-- roles (ADR-001 · TP M1 §3)
--   migrator: เจ้าของทุกตาราง · รัน migration (ต่อตรง ไม่ผ่าน PgBouncer)
--   app: DML เท่านั้น ไม่ใช่เจ้าของ → RLS มีผลเสมอ
--   console_reader: อ่านข้ามบริษัทสำหรับ Console (BYPASSRLS) · ใช้เฉพาะ service ที่มี audit
CREATE ROLE migrator LOGIN PASSWORD 'migrator' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE console_reader LOGIN PASSWORD 'console_reader' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT CONNECT ON DATABASE innovera TO app, migrator, console_reader;
GRANT CREATE ON DATABASE innovera TO migrator;
GRANT CREATE, USAGE ON SCHEMA public TO migrator;
-- ฐานข้อมูลสำหรับ test (ล้างได้ทุกรอบ)
CREATE DATABASE innovera_test OWNER postgres;
\c innovera_test
GRANT CONNECT ON DATABASE innovera_test TO app, migrator, console_reader;
GRANT CREATE ON DATABASE innovera_test TO migrator;
GRANT CREATE, USAGE ON SCHEMA public TO migrator;
-- ฐานข้อมูล test ของ id-api (แยกจาก innovera_test เพราะ turbo รัน test หลาย package พร้อมกัน)
\c postgres
CREATE DATABASE innovera_test_id OWNER postgres;
\c innovera_test_id
GRANT CONNECT ON DATABASE innovera_test_id TO app, migrator, console_reader;
GRANT CREATE ON DATABASE innovera_test_id TO migrator;
GRANT CREATE, USAGE ON SCHEMA public TO migrator;
-- ฐานข้อมูลปลายทางของ test กู้คืนรายบริษัท (packages/db/test/transfer.test.ts · ต่อตรงด้วย migrator ไม่ผ่าน PgBouncer)
\c postgres
CREATE DATABASE innovera_test_restore OWNER postgres;
\c innovera_test_restore
GRANT CONNECT ON DATABASE innovera_test_restore TO app, migrator, console_reader;
GRANT CREATE ON DATABASE innovera_test_restore TO migrator;
GRANT CREATE, USAGE ON SCHEMA public TO migrator;
