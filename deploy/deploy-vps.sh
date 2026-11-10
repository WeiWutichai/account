#!/usr/bin/env bash
# Deploy Innovera ขึ้น VPS ที่มี JuneFlow รันอยู่ (แบบ 1: ใช้ Caddy ของ JuneFlow ร่วมกัน)
# รันจากเครื่อง dev ที่ root ของ repo:  bash deploy/deploy-vps.sh <ขั้น>
#   prepare  — เพิ่ม swap 4G (ถ้ายังไม่มี) · ส่งโค้ด (git HEAD) + deploy/.env ไป /srv/innovera
#   build    — build image 5 ตัวบน VPS (นาน 20–40 นาที · log ที่ /srv/innovera/build.log)
#   up       — migrate + เปิด container ของ Innovera (ไม่แตะ container ของ JuneFlow)
#   owner <อีเมล> "<ชื่อ>" — สร้างผู้ใช้คนแรก (Owner · admin ของ Console) · คุณพิมพ์รหัสผ่านเอง · ใช้ได้ครั้งเดียวตอนยังไม่มีผู้ใช้
#   proxy    — ตรวจ DNS 4 ชื่อ → สำรอง Caddyfile ของ JuneFlow → เพิ่ม import → validate → reload แบบ graceful
#   status   — ดูสถานะ container + ทดสอบ HTTPS
#   rollback-proxy — คืน Caddyfile ของ JuneFlow จากไฟล์สำรองล่าสุด แล้ว reload
# ค่าการเชื่อมต่ออยู่ใน deploy/.env.vps (VPS_HOST · VPS_PORT · VPS_USER · VPS_SSH_KEY)
set -euo pipefail
cd "$(dirname "$0")/.."
# bash 3.2 ของ macOS ใช้ source <(...) ไม่ได้ → eval บรรทัด VPS_*=ค่า (ตัดคอมเมนต์ท้ายบรรทัด)
eval "$(grep -E '^VPS_[A-Z_]+=' deploy/.env.vps | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')"
KEY="${VPS_SSH_KEY/#\~/$HOME}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -p "${VPS_PORT:-22}" "${VPS_USER}@${VPS_HOST}")
DIR=/srv/innovera
JF_CADDY=/etc/juneflow/caddy
EDGE=juneflow-edge-1
HOSTS=(app id admin api)
DOMAIN=$(grep -E '^DOMAIN=' deploy/.env | cut -d= -f2 | awk '{print $1}')
remote() { "${SSH[@]}" "$@"; }

case "${1:-}" in
prepare)
  test -f deploy/.env || { echo "ไม่มี deploy/.env"; exit 1; }
  remote 'swapon --show | grep -q . && echo "swap: มีแล้ว" || { fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile && (grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab) && echo "swap: เพิ่ม 4G แล้ว"; }'
  remote "mkdir -p $DIR"
  git archive --format=tar HEAD | remote "tar -x -C $DIR"
  git rev-parse --short HEAD | remote "cat > $DIR/DEPLOYED_COMMIT"
  scp -q -i "$KEY" -o IdentitiesOnly=yes -P "${VPS_PORT:-22}" deploy/.env "${VPS_USER}@${VPS_HOST}:$DIR/deploy/.env"
  remote "chmod 600 $DIR/deploy/.env && echo \"โค้ด \$(cat $DIR/DEPLOYED_COMMIT) อยู่ที่ $DIR แล้ว\" && free -h | sed -n 1,3p"
  ;;
build)
  remote "cd $DIR && nohup sh -c 'for a in id-api accounting-api id-web accounting-web console-web; do echo \"== \$a \$(date +%T)\"; docker build -f deploy/Dockerfile --build-arg APP=\$a -t innovera/\$a . || exit 1; done; echo BUILD-OK \$(date +%T)' > build.log 2>&1 &"
  echo "เริ่ม build แล้ว (เบื้องหลังบน VPS) · ดูความคืบหน้า: ${SSH[*]} tail -f $DIR/build.log"
  ;;
up)
  remote "grep -q BUILD-OK $DIR/build.log" || { echo "build ยังไม่เสร็จ (ไม่พบ BUILD-OK ใน build.log)"; exit 1; }
  remote "cd $DIR && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env ps --format 'table {{.Service}}\t{{.Status}}'"
  remote "docker logs innovera-migrate-1 2>&1 | tail -5"
  ;;
owner)
  [ -n "${2:-}" ] && [ -n "${3:-}" ] || { echo 'ใช้: bash deploy/deploy-vps.sh owner <อีเมล> "<ชื่อ>"'; exit 1; }
  ssh -t -i "$KEY" -o IdentitiesOnly=yes -p "${VPS_PORT:-22}" "${VPS_USER}@${VPS_HOST}" \
    "cd $DIR && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env run --rm -it id-api ./node_modules/.bin/tsx src/bootstrap-owner.ts --email '$2' --name '$3' --console-admin"
  ;;
proxy)
  ip="$VPS_HOST"
  for h in "${HOSTS[@]}"; do
    got=$(dig +short "$h.$DOMAIN" A | tail -1)
    [ "$got" = "$ip" ] || { echo "DNS ยังไม่พร้อม: $h.$DOMAIN → '${got:-ไม่มี}' (ต้องเป็น $ip) — หยุด ไม่แก้ Caddy"; exit 1; }
    echo "DNS ok: $h.$DOMAIN → $got"
  done
  scp -q -i "$KEY" -o IdentitiesOnly=yes -P "${VPS_PORT:-22}" deploy/caddy/innovera.caddy "${VPS_USER}@${VPS_HOST}:$JF_CADDY/innovera.caddy.new"
  remote "set -e
    ts=\$(date +%Y%m%d-%H%M%S)
    cp -p $JF_CADDY/Caddyfile $JF_CADDY/Caddyfile.bak-\$ts
    mv $JF_CADDY/innovera.caddy.new $JF_CADDY/innovera.caddy
    grep -q 'import /etc/caddy/innovera.caddy' $JF_CADDY/Caddyfile || printf '\n# Innovera (เพิ่ม %s · ไฟล์สำรอง Caddyfile.bak-%s)\nimport /etc/caddy/innovera.caddy\n' \"\$ts\" \"\$ts\" >> $JF_CADDY/Caddyfile
    if docker exec $EDGE caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
      docker exec $EDGE caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && echo 'reload Caddy แล้ว (สำรองไว้ที่ Caddyfile.bak-'\$ts')'
    else
      cp -p $JF_CADDY/Caddyfile.bak-\$ts $JF_CADDY/Caddyfile; echo 'config ไม่ผ่าน validate — คืนไฟล์เดิมแล้ว ไม่ได้ reload'; exit 1
    fi"
  ;;
rollback-proxy)
  remote "set -e; b=\$(ls -t $JF_CADDY/Caddyfile.bak-* | head -1); cp -p \"\$b\" $JF_CADDY/Caddyfile; docker exec $EDGE caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; echo \"คืน \$b แล้ว\""
  ;;
status)
  remote "cd $DIR && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env ps --format 'table {{.Service}}\t{{.Status}}'; tail -3 build.log 2>/dev/null"
  for h in "${HOSTS[@]}"; do printf '%-28s ' "https://$h.$DOMAIN"; curl -s -o /dev/null -m 15 -w '%{http_code}\n' "https://$h.$DOMAIN/" || echo "เชื่อมต่อไม่ได้"; done
  printf '%-28s ' "juneflow.app"; curl -s -o /dev/null -m 15 -w '%{http_code}\n' https://juneflow.app/ || echo "เชื่อมต่อไม่ได้"
  ;;
*) sed -n 2,12p "$0"; exit 1 ;;
esac
