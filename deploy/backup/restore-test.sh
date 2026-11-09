#!/bin/sh
# ทดสอบกู้คืน (Gate M3.5): restore backup ล่าสุดลงฐานชั่วคราว → ตรวจทุกบริษัทว่า journal ที่ผ่านรายการดุล Dr = Cr → ลบฐานชั่วคราว
# ใช้: docker compose -f deploy/compose.prod.yaml exec backup sh /backup/restore-test.sh
set -eu
export PGPASSWORD="${POSTGRES_PASSWORD}"
f=$(ls -1t /backups/innovera-*.dump | head -1)
echo "restore $(basename "$f")"
psql -h postgres -U postgres -qc "DROP DATABASE IF EXISTS innovera_restore_check" -c "CREATE DATABASE innovera_restore_check"
pg_restore -h postgres -U postgres -d innovera_restore_check --no-owner "$f"
psql -h postgres -U postgres -d innovera_restore_check -At -F' ' -c "
  select c.id, count(distinct j.id) journals, sum(l.debit) dr, sum(l.credit) cr, sum(l.debit) = sum(l.credit) balanced
  from public.company c left join acct.journal j on j.company_id = c.id and j.status <> 'draft'
  left join acct.journal_line l on l.journal_id = j.id and l.company_id = c.id group by c.id"
bad=$(psql -h postgres -U postgres -d innovera_restore_check -At -c "
  select count(*) from (select j.company_id from acct.journal j join acct.journal_line l on l.journal_id = j.id and l.company_id = j.company_id
  where j.status <> 'draft' group by j.company_id having sum(l.debit) <> sum(l.credit)) x")
psql -h postgres -U postgres -qc "DROP DATABASE innovera_restore_check"
[ "$bad" = "0" ] && echo "restore test ผ่าน" || { echo "restore test ไม่ผ่าน: $bad บริษัทไม่ดุล"; exit 1; }
