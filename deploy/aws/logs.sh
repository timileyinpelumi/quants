#!/usr/bin/env bash
# Recent logs from the instance.
#   deploy/aws/logs.sh [service...]        last 200 lines (TAIL=n to change)
#   FOLLOW=1 deploy/aws/logs.sh keeper     follow until Ctrl-C
source "$(dirname "$0")/common.sh"
follow=""
[ "${FOLLOW:-0}" = 1 ] && follow="--follow"
remote "cd $REMOTE_DIR && $COMPOSE logs --tail=${TAIL:-200} $follow $*"
