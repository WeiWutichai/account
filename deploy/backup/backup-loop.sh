#!/bin/sh
# สำรองรายวัน 02:00 (เวลาไทย) · pg_dump -Fc ทั้งฐาน · เก็บ BACKUP_RETENTION_DAYS วัน · log ไม่มีข้อมูลส่วนบุคคล
# TODO(Wei): คัดลอกออกนอกเครื่องไปที่ BACKUP_OFFSITE_TARGET (ต้องเลือกผู้ให้บริการ/ที่ตั้งในไทย)
set -eu
export PGPASSWORD="${POSTGRES_PASSWORD}"
while true; do
  now=$(TZ=Asia/Bangkok date +%H%M)
  if [ "$now" = "0200" ]; then
    f="/backups/innovera-$(TZ=Asia/Bangkok date +%Y%m%d-%H%M).dump"
    pg_dump -h postgres -U postgres -Fc -f "$f.tmp" innovera && mv "$f.tmp" "$f" && echo "backup ok $(basename "$f") $(stat -c %s "$f") bytes"
    find /backups -name 'innovera-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
    sleep 61
  fi
  sleep 30
done
