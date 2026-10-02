#!/usr/bin/env bash
# Sends the repo, .env.production and secrets/ to the instance, builds the image there and starts the stack.
#   deploy/aws/deploy.sh            HOST defaults to the IP provision.sh saved in deploy/aws/.host
source "$(dirname "$0")/common.sh"
cd "$ROOT"

for f in .env.production secrets/keeper.json secrets/spill.json; do
  [ -f "$f" ] || { echo "missing $f (see the AWS section of docs/runbook.md)" >&2; exit 1; }
done
chmod 600 .env.production secrets/keeper.json secrets/spill.json

# Catch a keypair file that does not match its address, or a required value left empty, before anything is sent.
bun -e '
  const { Keypair } = require("@solana/web3.js");
  const env = Object.fromEntries((await Bun.file(".env.production").text()).split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^(["\x27])(.*)\1$/, "$2")]));
  for (const [file, name] of [["keeper", "KEEPER_ADDRESS"], ["spill", "SPILL_ADDRESS"]]) {
    const pub = Keypair.fromSecretKey(Uint8Array.from(await Bun.file(`secrets/${file}.json`).json())).publicKey.toBase58();
    if (pub !== env[name]) { console.error(`secrets/${file}.json is ${pub} but ${name} is ${env[name] || "unset"}`); process.exit(1); }
  }
  for (const k of ["SITE_HOST", "SITE_URL", "POSTGRES_PASSWORD", "ADMIN_SESSION_SECRET", "ADMIN_CODE_HASH", "PLATFORM_ADDRESSES", "NEXT_PUBLIC_RPC_URL", "RPC_URL", "JUPITER_API_KEY", "TREASURY_ADDRESS", "DAMM_V2_MIGRATION_CONFIG", "CLOUDINARY_URL"]) {
    if (!env[k]) { console.error(`${k} is empty in .env.production`); process.exit(1); }
  }
  const roles = JSON.parse(env.PLATFORM_ADDRESSES);
  for (const [role, name] of [["keeper", "KEEPER_ADDRESS"], ["spill", "SPILL_ADDRESS"], ["treasury", "TREASURY_ADDRESS"]]) {
    if (roles[role] !== env[name]) { console.error(`PLATFORM_ADDRESSES ${role} is ${roles[role] || "unset"} but ${name} is ${env[name] || "unset"}`); process.exit(1); }
  }
'

tag="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
[ -z "$(git status --porcelain 2>/dev/null)" ] || tag="$tag-dirty"
h="$(host)"
echo "deploying $tag to $h"

# Only files tracked in git, plus the env file and keypairs; local tool folders never leave this machine.
list="$(mktemp)"; trap 'rm -f "$list"' EXIT
{ git ls-files; printf '%s\n' .env.production secrets/keeper.json secrets/spill.json; } > "$list"
rsync -az --timeout=120 --files-from="$list" -e "ssh ${ssh_opts[*]}" ./ "$SSH_USER@$h:$REMOTE_DIR/"

remote bash -s -- "$tag" "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
tag="$1"; cd "$2"
chmod 600 .env.production secrets/*.json
mkdir -p backups
export IMAGE_TAG="$tag"
compose=(docker compose -f docker-compose.prod.yml --env-file .env.production)
timeout 1800 "${compose[@]}" build migrate backup
timeout 600 "${compose[@]}" up -d --remove-orphans
docker tag "quants-app:$tag" quants-app:latest
# keep the last five builds for rollback
docker images quants-app --format '{{.Tag}}' | grep -v '^latest$' | tail -n +6 | xargs -r -I{} docker rmi "quants-app:{}" >/dev/null || true
docker builder prune -f --filter until=168h >/dev/null || true

for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q web)" 2>/dev/null)" = healthy ] && break
  sleep 5
done
"${compose[@]}" ps
REMOTE

remote bash "$REMOTE_DIR/deploy/aws/smoke.sh" "$REMOTE_DIR"
site="$(grep -E '^SITE_URL=' .env.production | cut -d= -f2- | tr -d "\"'")"
echo "deployed $tag: $site"
