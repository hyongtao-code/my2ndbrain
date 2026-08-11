#!/usr/bin/env bash
# query.sh — minimal CLI for inspecting MySecondBrain's knowledge graph.
#
# Default action: list all node titles (most important first).
#
# Usage:
#   ./query.sh                # list all node titles, sorted by importance
#   ./query.sh --category AI   # filter by category
#   ./query.sh --limit 10     # cap the number of rows (default: unlimited)
#   ./query.sh --all          # include id + category + importance + created_at
#   ./query.sh --ids          # print bare UUIDs only (one per line)
#   ./query.sh psql           # drop into interactive psql
#   ./query.sh --help
#
# Reads DB credentials from .env (DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- read DB creds from .env without printing them ----
get_env_value() {
    local key="$1"
    python3 - "$key" "$SCRIPT_DIR/.env" <<'PYEOF'
import sys
key, env_file = sys.argv[1], sys.argv[2]
for line in open(env_file):
    k, _, v = line.partition("=")
    if k.strip() == key:
        sys.stdout.write(v.rstrip("\n"))
        sys.exit(0)
sys.exit(1)
PYEOF
}

DB_HOST="$(get_env_value DB_HOST)"
DB_PORT="$(get_env_value DB_PORT)"
DB_USER="$(get_env_value DB_USER)"
DB_PASS="$(get_env_value DB_PASSWORD)"
DB_NAME="$(get_env_value DB_NAME)"

# Ensure ~/.pgpass exists so psql authenticates without env-var quoting
# headaches (hermes' redactor mangles PGPASSWORD=*** literally). This is
# idempotent and chmods to 600 per libpq requirements.
PGPASS="$HOME/.pgpass"
need_pgpass=1
if [[ -f "$PGPASS" ]]; then
    if grep -qE "^${DB_HOST}:${DB_PORT}:${DB_USER}:${DB_NAME}:.+" "$PGPASS" \
       || grep -qE "^${DB_HOST}:${DB_PORT}:${DB_USER}:my2ndbrain:.+" "$PGPASS" \
       || grep -qE ":[0-9]+:${DB_USER}:${DB_NAME}:" "$PGPASS"; then
        need_pgpass=0
    fi
fi
if [[ "$need_pgpass" -eq 1 ]]; then
    printf "%s:%s:%s:%s:%s\n" "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_NAME" "$DB_PASS" >> "$PGPASS"
    chmod 600 "$PGPASS"
fi

run_query() {
    # No PGPASSWORD=*** — let psql read ~/.pgpass instead.
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -P "pager=off" -A -F $'\t' -t "$@"
}

# ---- subcommand dispatch ----
if [[ "${1:-}" == "psql" ]]; then
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
    exit $?
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "help" ]]; then
    cat <<USAGE
Usage: ./query.sh [options] [psql]

Options (combinable):
  --category <name>   Filter by exact category name.
  --limit <n>         Cap rows (default: unlimited).
  --all               Include id, category, importance, created_at.
  --ids               Print only UUIDs, one per line.
  --json              Emit JSON lines (id, title, category, importance, created_at).

Special:
  psql                Drop into an interactive psql session.
  -h, --help, help    Show this help.

Default behaviour: print node titles only, sorted by importance DESC.
USAGE
    exit 0
fi

# ---- parse flags ----
CATEGORY=""
LIMIT=""
MODE="titles"   # titles | all | ids | json

while [[ $# -gt 0 ]]; do
    case "$1" in
        --category) CATEGORY="$2"; shift 2 ;;
        --limit)    LIMIT="$2"; shift 2 ;;
        --all)      MODE="all"; shift ;;
        --ids)      MODE="ids"; shift ;;
        --json)     MODE="json"; shift ;;
        *) echo "unknown arg: $1 (try --help)" >&2; exit 2 ;;
    esac
done

# ---- build query ----
where=""
if [[ -n "$CATEGORY" ]]; then
    where="WHERE category = '$CATEGORY'"
fi

limit_clause=""
if [[ -n "$LIMIT" ]]; then
    limit_clause="LIMIT $LIMIT"
fi

case "$MODE" in
    titles)
        sql="SELECT title FROM knowledge_node $where ORDER BY importance DESC, created_at DESC $limit_clause"
        run_query -c "$sql" | sed 's/^[[:space:]]*//' | grep -v '^$'
        ;;
    all)
        sql="SELECT id, title, category, importance, created_at
              FROM knowledge_node $where
              ORDER BY importance DESC, created_at DESC $limit_clause"
        run_query -c "$sql" | column -t -s $'\t'
        ;;
    ids)
        sql="SELECT id FROM knowledge_node $where $limit_clause"
        run_query -c "$sql" | sed 's/^[[:space:]]*//' | grep -v '^$'
        ;;
    json)
        sql="SELECT id, title, category, importance, created_at
              FROM knowledge_node $where
              ORDER BY importance DESC, created_at DESC $limit_clause"
        run_query -c "$sql" -F $'\t' | awk -F'\t' '{
            printf("{\"id\":\"%s\",\"title\":\"%s\",\"category\":\"%s\",\"importance\":%s,\"created_at\":\"%s\"}\n",
                   $1, $2, $3, $4, $5)
        }'
        ;;
esac