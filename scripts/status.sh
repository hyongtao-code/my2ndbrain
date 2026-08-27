#!/usr/bin/env bash
# status.sh — show the running state of MySecondBrain.
#
# Prints:
#   - container status (Up / Exited / Not created)
#   - port mapping
#   - health
#   - recent log lines
#   - data volume state
#   - disk usage
#
# Pure read-only.

set -euo pipefail

# When this script lives at scripts/<name>.sh, the repo root is
# the parent of this directory. We expose both names — SCRIPT_DIR
# remains for back-compat, and REPO_ROOT is the anchor.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> container"
# Find any container whose name starts with my2ndbrain (handles
# "my2ndbrain" from start.sh and "my2ndbrain-prod" from a manual
# `docker run`).
container=$(docker ps -a --format '{{.Names}}' | grep '^my2ndbrain' | head -1 || true)
if [ -n "$container" ]; then
    docker ps -a --filter name=^"$container"$ \
        --format "  name:      {{.Names}}\n  status:    {{.Status}}\n  ports:     {{.Ports}}\n  image:     {{.Image}}"
    echo "  health:    $(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo 'n/a')"
else
    echo "  (no container starting with 'my2ndbrain' — run ./start.sh)"
fi

echo
echo "==> last 10 log lines"
if [ -n "$container" ]; then
    docker logs --tail 10 "$container" 2>&1 | sed 's/^/  /' || true
else
    echo "  (no container)"
fi

echo
echo "==> data volume (my2ndbrain-data)"
if docker volume inspect my2ndbrain-data >/dev/null 2>&1; then
    mp=$(docker volume inspect --format '{{.Mountpoint}}' my2ndbrain-data)
    echo "  mountpoint: $mp"
    # du may need sudo; we wrap in '|| true' so the script keeps going
    du -sh "$mp" 2>/dev/null | sed 's/^/  size:      /' || \
        echo "  size:      (permission denied — needs sudo)"
else
    echo "  (no volume yet — first run will create it)"
fi

echo
echo "==> to manage"
echo "  start:    ./start.sh"
echo "  stop:     ./stop.sh"
echo "  logs:     docker logs -f my2ndbrain"
echo "  shell:    docker exec -it my2ndbrain bash"
echo "  backup:   ./backup.sh"
