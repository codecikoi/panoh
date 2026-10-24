#!/usr/bin/env bash
# Daily database dump on the server, kept for 14 days. Installed by deploy.sh as /usr/local/bin/madat-backup (cron 03:30).
set -euo pipefail
OUT=/var/backups/madat
mkdir -p "$OUT"
chmod 700 "$OUT"
file="$OUT/madat-$(date +%F).sql.gz"
docker compose --env-file /opt/madat/.env -f /opt/madat/deploy/compose.prod.yml exec -T db pg_dump -U madat --no-owner madat | gzip > "$file.tmp"
mv "$file.tmp" "$file"
find "$OUT" -name 'madat-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $file ($(du -h "$file" | cut -f1))"
