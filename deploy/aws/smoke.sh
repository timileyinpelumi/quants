#!/usr/bin/env bash
# Runs on the instance after a deploy: migrate finished, web serves / and /explore, indexer and keeper each logged a pass.
#   bash /opt/quants/deploy/aws/smoke.sh [/opt/quants]
set -uo pipefail
cd "${1:-/opt/quants}" || exit 1
compose=(docker compose -f docker-compose.prod.yml --env-file .env.production)
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }
warn() { echo "warn  $*"; }

id="$("${compose[@]}" ps -aq migrate)"
code="$([ -n "$id" ] && docker inspect -f '{{.State.ExitCode}} {{.State.Status}}' "$id")"
[ "$code" = "0 exited" ] && ok "migrate exited 0" || bad "migrate: ${code:-no container}"

for path in / /explore; do
  status="$(timeout 60 "${compose[@]}" exec -T web bun -e "const r = await fetch('http://127.0.0.1:3000$path', { signal: AbortSignal.timeout(45000) }); console.log(r.status)" 2>/dev/null | tail -1)"
  [ "$status" = 200 ] && ok "web $path 200" || bad "web $path ${status:-no response}"
done

site_host="$(grep -E '^SITE_HOST=' .env.production | cut -d= -f2- | tr -d "\"'")"
public=""
for _ in $(seq 1 12); do
  public="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$site_host/")"
  [ "$public" = 200 ] && break
  sleep 10
done
[ "$public" = 200 ] && ok "https://$site_host/ 200" || bad "https://$site_host/ ${public:-no response} (Let's Encrypt issues only once $site_host resolves here; see: docker compose logs caddy)"

# wait up to 3 minutes for the first indexer pass and keeper run
indexer=""; keeper=""
for _ in $(seq 1 36); do
  indexer="$("${compose[@]}" logs --no-log-prefix indexer 2>/dev/null)"
  keeper="$("${compose[@]}" logs --no-log-prefix keeper 2>/dev/null)"
  grep -q '"checked"' <<<"$indexer" && grep -qE '"runId"|no settings saved|"fatal"' <<<"$keeper" && break
  sleep 5
done

if grep -q '"checked"' <<<"$indexer"; then ok "indexer pass: $(grep '"checked"' <<<"$indexer" | head -1)"
else bad "indexer logged no pass; last lines:"; tail -5 <<<"$indexer"; fi
grep -qE '"error"|"fatal"' <<<"$indexer" && bad "indexer logged errors: $(grep -E '"error"|"fatal"' <<<"$indexer" | tail -1)"

if grep -q '"runId"' <<<"$keeper"; then ok "keeper run: $(grep '"runId"' <<<"$keeper" | tail -1 | cut -c1-300)"
elif grep -q 'no settings saved' <<<"$keeper"; then warn "keeper reached the chain and database but no settings are saved yet; save them on /admin"
else bad "keeper logged no run; last lines:"; tail -5 <<<"$keeper"; fi
grep '"fatal"' <<<"$keeper" | grep -v 'no settings saved' | tail -1 | grep -q . && bad "keeper fatal: $(grep '"fatal"' <<<"$keeper" | grep -v 'no settings saved' | tail -1)"

for svc in web indexer keeper; do
  restarts="$(docker inspect -f '{{.RestartCount}}' "$("${compose[@]}" ps -q "$svc")" 2>/dev/null)"
  [ "${restarts:-x}" = 0 ] && ok "$svc running, no restarts" || bad "$svc restarts: ${restarts:-not running}"
done

exit "$fail"
