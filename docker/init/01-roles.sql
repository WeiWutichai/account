-- role ของแอป (ไม่ใช่ superuser) + role สำหรับ migration
CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE migrator LOGIN PASSWORD 'migrator' NOSUPERUSER CREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE innovera TO app, migrator;
GRANT CREATE ON DATABASE innovera TO migrator;
