#!/bin/sh
# backup.sh once: dump now. backup.sh loop: dump daily at BACKUP_HOUR_UTC.
set -eu
# empty keys from compose would hide the instance role
[ -n "${AWS_ACCESS_KEY_ID:-}" ] || unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

dump() {
  f="/backups/quants-$(date -u +%Y%m%dT%H%M%SZ).dump"
  pg_dump -Fc -f "$f.tmp"
  mv "$f.tmp" "$f"
  echo "wrote $f ($(du -h "$f" | cut -f1))"
  find /backups -name 'quants-*.dump' -mtime "+$((${BACKUP_RETENTION_DAYS:-7} - 1))" -print -delete
  if [ -n "${BACKUP_S3_URI:-}" ]; then
    timeout 600 aws s3 cp --only-show-errors "$f" "${BACKUP_S3_URI%/}/"
    echo "uploaded to ${BACKUP_S3_URI%/}/$(basename "$f")"
  fi
}

case "${1:-loop}" in
  once) dump ;;
  loop)
    while true; do
      now=$(date -u +%s)
      next=$(date -u -d "today ${BACKUP_HOUR_UTC:-3}:00" +%s)
      [ "$next" -gt "$now" ] || next=$((next + 86400))
      echo "next backup at $(date -u -d "@$next")"
      sleep $((next - now))
      dump || echo "backup failed"
    done ;;
  *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
