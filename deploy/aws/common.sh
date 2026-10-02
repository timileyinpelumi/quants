# shellcheck shell=bash
# Sourced by the other scripts in deploy/aws.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGION="${REGION:-us-east-1}"
NAME="${NAME:-quants}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/quants-deploy.pem}"
HOST_FILE="$ROOT/deploy/aws/.host"
REMOTE_DIR="${REMOTE_DIR:-/opt/quants}"
SSH_USER="${SSH_USER:-ubuntu}"
# shellcheck disable=SC2034
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

host() {
  if [ -n "${HOST:-}" ]; then echo "$HOST"; return; fi
  [ -f "$HOST_FILE" ] || { echo "no host: set HOST or run provision.sh first" >&2; exit 1; }
  cat "$HOST_FILE"
}

ssh_opts=(-i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

remote() {
  ssh "${ssh_opts[@]}" "$SSH_USER@$(host)" "$@"
}
