#!/usr/bin/env bash
# restore.sh — load a pg_dump .sql into the MySecondBrain data
# volume. Runs against the same my2ndbrain container that
# start.sh / docker compose up -d would have created.
#
# Usage:
#   ./restore.sh                                 # picks latest .sql in ./backups/
#   ./restore.sh /path/to/some.sql               # explicit file
#   ./restore.sh backups/my2ndbrain-20260826.sql
#
# DESTRUCTIVE: this wipes the existing my2ndbrain database before
# loading the dump. Use ./backup.sh first if you want a safety net.

set -euo pipefail

# When this script lives at scripts/<name>.sh, the repo root is
# the parent of this directory. We expose both names — SCRIPT_DIR
# remains for back-compat, and REPO_ROOT is the anchor.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ "$#" -gt 1 ]; then
    echo "usage: $0 [path-to-dump.sql]" >&2
    exit 2
fi

if [ -n "$1" ]; then
    in="$1"
else
    # Pick the newest .sql under ./backups/
    in=$(ls -1t backups/*.sql 2>/dev/null | head -1 || true)
    if [ -z "$in" ]; then
        echo "✗ no dump file given and ./backups/ is empty" >&2
        echo "  usage: $0 /path/to/dump.sql" >&2
        exit 1
    fi
    echo "==> no file specified; using newest: $in"
fi

if [ ! -f "$in" ]; then
    echo "✗ file not found: $in" >&2
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^my2ndbrain'; then
    echo "✗ my2ndbrain container is not running" >&2
    echo "  start it with ./start.sh first" >&2
    exit 1
fi

# Confirm with the user — this is destructive.
echo
echo "This will REPLACE the contents of the my2ndbrain database with"
echo "the contents of:"
echo "  $in"
echo
echo "Existing data will be DESTROYED. Continue? [y/N]"
read -r ans
case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "aborted."; exit 1 ;;
esac

echo "==> dropping and recreating public schema"
docker exec $(docker ps --format '{{.Names}}' | grep ^my2ndbrain | head -1) su - postgres -c "psql -d my2ndbrain -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO my2ndbrain; CREATE EXTENSION vector;'"

echo "==> loading dump"
docker exec -i $(docker ps --format '{{.Names}}' | grep ^my2ndbrain | head -1) su - postgres -c "psql my2ndbrain" < "$in"

echo "==> done"
echo "  verify: curl http://localhost:8000/api/nodes?limit=200 | python3 -m json.tool"
