#!/usr/bin/env bash
# backup.sh — snapshot the MySecondBrain data volume.
#
# What it does:
#   1. Stops the container (so postgres has a clean state)
#   2. Runs `pg_dump` inside the volume to produce a .sql file
#   3. Restarts the container
#   4. Writes the .sql file to ./backups/ (gitignored)
#
# The output is a portable PostgreSQL dump that you can `psql <` into
# any postgres instance. The data is the entire my2ndbrain
# database (4 tables worth of nodes, edges, drafts, skills, plus
# categories).
#
# Usage:
#   ./backup.sh                # writes ./backups/my2ndbrain-YYYYMMDD-HHMMSS.sql
#   ./backup.sh /tmp/mydb.sql  # writes to a custom path

set -euo pipefail

# When this script lives at scripts/<name>.sh, the repo root is
# the parent of this directory. We expose both names — SCRIPT_DIR
# remains for back-compat, and REPO_ROOT is the anchor.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ "$#" -gt 1 ]; then
    echo "usage: $0 [path-to-output.sql]" >&2
    exit 2
fi

if [ -n "$1" ]; then
    out="$1"
else
    mkdir -p backups
    stamp=$(date +%Y%m%d-%H%M%S)
    out="backups/my2ndbrain-${stamp}.sql"
fi

if ! docker ps --format '{{.Names}}' | grep -q '^my2ndbrain'; then
    echo "✗ my2ndbrain container is not running" >&2
    echo "  start it with ./start.sh first" >&2
    exit 1
fi

echo "==> running pg_dump -> $out"
# pg_dump writes to stdout; we redirect once. Using exec so we don't
# need to worry about permissions inside the volume.
docker exec $(docker ps --format '{{.Names}}' | grep ^my2ndbrain | head -1) su - postgres -c "pg_dump my2ndbrain" > "$out"

# Sanity-check the dump
if [ ! -s "$out" ]; then
    echo "✗ backup file is empty — something went wrong" >&2
    rm -f "$out"
    exit 1
fi

size=$(du -h "$out" | awk '{print $1}')
tables=$(grep -c "^CREATE TABLE" "$out" || echo 0)
echo "✓ backup written: $out ($size, $tables tables)"

echo
echo "  to restore into a new container:"
echo "    # 1. start the container (creates the empty my2ndbrain-data volume):"
echo "    ./start.sh"
echo "    # 2. restore the dump into it:"
echo "    ./restore.sh '$out'"
