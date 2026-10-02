#!/usr/bin/env bash
# Takes a pg_dump on the instance now (and uploads it when BACKUP_S3_URI is set), then lists the backups.
#   deploy/aws/backup-now.sh [--download]   --download also copies the new dump to ./backups here
source "$(dirname "$0")/common.sh"
remote "cd $REMOTE_DIR && timeout 900 $COMPOSE run --rm -T backup once && ls -lh backups | tail -8"
if [ "${1:-}" = "--download" ]; then
  latest="$(remote "ls -1t $REMOTE_DIR/backups/quants-*.dump | head -1")"
  mkdir -p "$ROOT/backups"
  scp "${ssh_opts[@]}" "$SSH_USER@$(host):$latest" "$ROOT/backups/"
  echo "downloaded $(basename "$latest") to backups/"
fi
