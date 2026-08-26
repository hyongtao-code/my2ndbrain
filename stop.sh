#!/usr/bin/env bash
# stop.sh — stop (and optionally remove) the MySecondBrain container.
#
# What it does:
#   1. Stops the container if it is running
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
            sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

# Detect compose project name (default: directory name)
PROJECT_NAME=$(basename "$PWD")

if docker ps --format '{{.Names}}' | grep -q '^my2ndbrain$'; then
    echo "==> stopping my2ndbrain"
    docker compose stop my2ndbrain
fi

if [ "$DO_RM" -eq 1 ]; then
    echo "==> removing container (data volume 'my2ndbrain-data' is preserved)"
    docker compose down --remove-orphans
else
    echo "  (use --rm to also remove the container; data volume is preserved either way)"
fi

echo "==> done"
echo "  to start again:  ./start.sh"
echo "  to wipe data:     docker volume rm my2ndbrain-data"
