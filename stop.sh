#!/usr/bin/env bash
# stop.sh — stop (and optionally remove) the MySecondBrain container.
#
# What it does:
#   1. Stops any container starting with 'my2ndbrain' (handles both
#      the default `my2ndbrain` from start.sh and a manually-named
#      container like `my2ndbrain-prod`)
#   2. Removes the container if --rm is passed
#   3. **Does not** touch the my2ndbrain-data volume, so the
#      postgres data is preserved across stop / start cycles.
#      Use `docker volume rm my2ndbrain-data` to wipe the data.
#
# Usage:
#   ./stop.sh         # stop the container (data preserved)
#   ./stop.sh --rm    # stop AND remove the container (data preserved)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DO_RM=0
for arg in "$@"; do
    case "$arg" in
        --rm) DO_RM=1 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

# Find any container whose name starts with my2ndbrain (e.g.
# `my2ndbrain` from start.sh, or `my2ndbrain-prod` from a manual
# `docker run`).
containers=$(docker ps -a --format '{{.Names}}' | grep '^my2ndbrain' || true)

if [ -z "$containers" ]; then
    echo "==> no my2ndbrain container running"
    exit 0
fi

for container in $containers; do
    echo "==> stopping $container"
    if [ "$DO_RM" -eq 1 ]; then
        # `docker compose down` only works when run from the same
        # directory as docker-compose.yml. We use `docker rm -f`
        # instead so this script works regardless of cwd.
        docker rm -f "$container" >/dev/null
    else
        docker stop "$container" >/dev/null
    fi
done

if [ "$DO_RM" -eq 1 ]; then
    echo "==> removed container(s) (data volume 'my2ndbrain-data' is preserved)"
else
    echo "  (use --rm to also remove the container; data volume is preserved either way)"
fi

echo "==> done"
echo "  to start again:  ./start.sh        # docker compose"
echo "  to start local:  ./dev.sh           # direct (vite + uvicorn)"
echo "  to wipe data:     docker volume rm my2ndbrain-data"
