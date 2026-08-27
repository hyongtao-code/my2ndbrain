#!/usr/bin/env bash
# start.sh — one-command docker compose bring-up of MySecondBrain.
#
# What it does:
#   1. Runs prereq.sh; aborts on a hard failure
#   2. Loads .env (creates it from .env.example if missing)
#   3. Builds the image if my2ndbrain:latest is not present
#      (or if the user passed --rebuild)
#   4. Runs `docker compose up -d`
#   5. Waits for the container to become healthy
#   6. Prints a one-line summary with the URL and credentials
#
# For the **local / direct** workflow (Vite dev + uvicorn against a
# system-installed postgres), use ./dev.sh instead. dev.sh is the
# pre-existing start.sh we used before docker packaging.
#
# Usage:
#   ./start.sh                # smart (only build if image missing)
#   ./start.sh --rebuild     # force rebuild
#   ./start.sh --pull        # pull base images (e.g. python:3.11)
#                             # before building (saves time on next build)
#   ./start.sh --help

set -euo pipefail

# When this script lives at scripts/<name>.sh, the repo root is
# the parent of this directory. We expose both names — SCRIPT_DIR
# remains for back-compat, and REPO_ROOT is the anchor.
# IMPORTANT: cache $SELF_PATH before any `cd`, so that the --help
# handler below can read the help text from this exact file
# regardless of how the script was invoked.
SELF_PATH="$(realpath "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SELF_PATH")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REBUILD=0
PULL=0
for arg in "$@"; do
    case "$arg" in
        --rebuild) REBUILD=1 ;;
        --pull)    PULL=1 ;;
        -h|--help)
            sed -n '2,25p' "$SELF_PATH" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

# ---- 1. prereq --------------------------------------------------------
echo "==> checking prerequisites"
"$REPO_ROOT/scripts/prereq.sh"

# ---- 2. .env ----------------------------------------------------------
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "==> creating .env from .env.example"
        cp .env.example .env
        echo "  please edit .env to set DB_PASSWORD and any LLM keys,"
        echo "  then re-run ./start.sh"
        echo
        echo "  default: DB_PASSWORD=*** (suitable for local-only use)"
        exit 1
    else
        echo "✗ .env.example not found; cannot create .env" >&2
        exit 1
    fi
fi
echo "==> .env present"

# ---- 3. build (if needed) -------------------------------------------
NEED_BUILD=$REBUILD
if [ "$NEED_BUILD" -eq 0 ]; then
    if ! docker image inspect my2ndbrain:latest >/dev/null 2>&1; then
        NEED_BUILD=1
        echo "==> my2ndbrain:latest image not found locally; will build"
    fi
fi

if [ "$NEED_BUILD" -eq 1 ]; then
    echo "==> building my2ndbrain:latest (first build: 5-10 min, cached: 1-2 min)"
    PULL_FLAG=""
    if [ "$PULL" -eq 1 ]; then
        PULL_FLAG="--pull"
    fi
    # We let compose build, so that the env / args are consistent
    # with what compose knows about.
    docker compose build $PULL_FLAG
fi

# ---- 4. up -------------------------------------------------------------
echo "==> starting container"
docker compose up -d

# ---- 5. wait healthy --------------------------------------------------
echo "==> waiting for /api/health to return 200"
deadline=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    container=$(docker ps --format '{{.Names}}' | grep '^my2ndbrain' | head -1 || true)
    if [ -z "$container" ]; then
        sleep 2
        continue
    fi
    status=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo "starting")
    case "$status" in
        healthy)
            echo "==> container is healthy"
            break
            ;;
        unhealthy)
            echo "✗ container is unhealthy — last 30 log lines:"
            docker logs --tail 30 "$container" || true
            exit 1
            ;;
        *)
            sleep 2
            ;;
    esac
done
if [ "$(date +%s)" -ge "$deadline" ]; then
    container=$(docker ps --format '{{.Names}}' | grep '^my2ndbrain' | head -1 || true)
    if [ -n "$container" ]; then
        echo "⚠ container did not become healthy in 120s — last 30 log lines:"
        docker logs --tail 30 "$container" || true
    fi
    exit 1
fi

# ---- 6. summary -------------------------------------------------------
echo
echo "================================================================"
echo "  MySecondBrain is up (docker compose)."
echo
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$HOST_IP" ]; then
    HOST_IP="localhost"
fi
echo "  Web UI    : http://${HOST_IP}:8000/"
echo "  Health    : http://${HOST_IP}:8000/api/health"
echo "  Swagger   : http://${HOST_IP}:8000/docs"
echo "  Data      : stored in named volume 'my2ndbrain-data'"
echo "             (postgres + pgvector — survives container rebuild)"
echo
echo "  Stop      : ./compose.sh stop"
echo "  Status    : ./status.sh"
echo "  Backup    : ./backup.sh"
echo "  Logs      : docker logs -f my2ndbrain-prod"
echo
echo "  For the local direct dev workflow (Vite + uvicorn against"
echo "  a system postgres), use ./dev.sh instead."
echo "================================================================"
