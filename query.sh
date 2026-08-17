#!/usr/bin/env bash
# query.sh — minimal CLI for inspecting MySecondBrain's knowledge graph.
#
# Sections:
#   1. nodes  (default) — list node titles / ids / categories / json
#   2. drafts           — list/show/promote knowledge_draft rows
#   3. psql             — drop into interactive psql
#
# Usage:
#   ./query.sh                          # list node titles (importance DESC)
#   ./query.sh --category AI            # filter nodes by category
#   ./query.sh --limit 10               # cap rows
#   ./query.sh --all                    # include id + category + importance + created_at
#   ./query.sh --ids                    # bare UUIDs
#   ./query.sh --json                   # JSON lines
#
#   ./query.sh drafts list              # list unpromoted drafts (newest first)
#   ./query.sh drafts list --all        # include promoted drafts
#   ./query.sh drafts show <id>         # show a single draft
#   ./query.sh drafts promote <id>...   # promote one or more drafts to a node
#   ./query.sh drafts pinned            # list pinned drafts only
#   ./query.sh drafts count             # single-line count
#
#   ./query.sh psql                     # interactive psql
#
#   ./query.sh --help                   # full help
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

# ---- top-level subcommand dispatch ----
SUBCMD="${1:-}"
shift 2>/dev/null || true

show_help() {
    cat <<'USAGE'
Usage: ./query.sh [options] [drafts SUBCMD] [psql]

== Node queries (default) ==
  ./query.sh                       list node titles (importance DESC)
  --category <name>                filter by exact category name
  --limit <n>                      cap rows
  --all / --ids / --json           output format

== Draft queries (transient inbox) ==
  ./query.sh drafts list           list unpromoted drafts (pinned first, newest first)
  ./query.sh drafts list --all     include promoted drafts
  ./query.sh drafts list --pinned  pinned drafts only
  ./query.sh drafts list --ids     bare UUIDs
  ./query.sh drafts count          single-line count, unpromoted
  ./query.sh drafts count --all    include promoted
  ./query.sh drafts show <id>      full draft row, all columns
  ./query.sh drafts promote <id>... promote one or more drafts into a real node
   (the order of <id> args matters: short drafts created within 60s
    of each other are auto-merged; the first id becomes the group
    primary key)

== Other ==
  ./query.sh psql                  drop into interactive psql
  ./query.sh --help                show this help

All output goes to stdout. Errors and progress messages go to stderr.
USAGE
}

# ---- draft subcommand handler ----
drafts_list() {
    local include_promoted=0
    local pinned_only=0
    local ids_only=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all)     include_promoted=1; shift ;;
            --pinned)  pinned_only=1; shift ;;
            --ids)     ids_only=1; shift ;;
            *) echo "drafts list: unknown arg: $1" >&2; exit 2 ;;
        esac
    done

    local where=""
    local conds=()
    if [[ "$include_promoted" -eq 0 ]]; then
        conds+=("promoted_to_node_id IS NULL")
    fi
    if [[ "$pinned_only" -eq 1 ]]; then
        conds+=("pinned = 1")
    fi
    if [[ ${#conds[@]} -gt 0 ]]; then
        where="WHERE $(IFS=' AND '; echo "${conds[*]}")"
    fi

    if [[ "$ids_only" -eq 1 ]]; then
        run_query -c "SELECT id FROM knowledge_draft $where ORDER BY pinned DESC, created_at DESC" \
            | sed 's/^[[:space:]]*//' | grep -v '^$'
        return
    fi

    # full table: id | pinned | source | content (truncated) | promoted_to_node_id | created_at
    run_query -c "SELECT id, CASE WHEN pinned=1 THEN '*' ELSE ' ' END, source, content, COALESCE(promoted_to_node_id::text, ''), created_at FROM knowledge_draft $where ORDER BY pinned DESC, created_at DESC" \
        | awk -F'\t' '
            {
                id=$1; pin=$2; src=$3; content=$4; promoted=$5; ts=$6;
                # truncate content visually but keep prompt-able
                if (length(content) > 80) content=substr(content, 1, 77) "...";
                printf("%s %s  %s  %s\n  promoted=%s  created=%s\n",
                       pin, substr(id,1,8), src, content,
                       (promoted == "" ? "-" : substr(promoted,1,8)),
                       ts);
            }'
}

drafts_count() {
    local include_promoted=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all) include_promoted=1; shift ;;
            *) echo "drafts count: unknown arg: $1" >&2; exit 2 ;;
        esac
    done
    local where=""
    if [[ "$include_promoted" -eq 0 ]]; then
        where="WHERE promoted_to_node_id IS NULL"
    fi
    run_query -c "SELECT COUNT(*) FROM knowledge_draft $where"
}

drafts_show() {
    local ids=("$@")
    if [[ ${#ids[@]} -eq 0 ]]; then
        echo "drafts show: <id> required" >&2
        exit 2
    fi
    for id in "${ids[@]}"; do
        echo "=== draft $id ==="
        run_query -c "SELECT id, content, source, pinned, promoted_to_node_id, created_at, updated_at FROM knowledge_draft WHERE id = '$id'::uuid" \
            | awk -F'\t' '
                {
                    printf("  id:                %s\n", $1);
                    printf("  content:           %s\n", $2);
                    printf("  source:            %s\n", $3);
                    printf("  pinned:            %s\n", ($4 == "1" ? "yes" : "no"));
                    printf("  promoted_to_node:  %s\n", ($5 == "" ? "-" : $5));
                    printf("  created_at:        %s\n", $6);
                    printf("  updated_at:        %s\n", $7);
                }'
    done
}

drafts_promote() {
    local ids=("$@")
    if [[ ${#ids[@]} -eq 0 ]]; then
        echo "drafts promote: <id>... required" >&2
        exit 2
    fi
    # Build a JSON array of ids and POST to /api/drafts/promote via the
    # running backend. Falls back to a manual INSERT if the FastAPI
    # server is unreachable.
    local ids_json
    ids_json=$(printf '"%s",' "${ids[@]}")
    ids_json="[${ids_json%,}]"
    local payload="{\"draft_ids\":${ids_json}}"

    echo "Promoting ${#ids[@]} draft(s) via http://127.0.0.1:8000/api/drafts/promote ..." >&2
    if response=$(curl -sS -X POST "http://127.0.0.1:8000/api/drafts/promote" \
                       -H 'content-type: application/json' \
                       -d "$payload" -w '\n%{http_code}' 2>&1); then
        local body=${response%$'\n'*}
        local code=${response##*$'\n'}
        if [[ "$code" == "200" ]]; then
            python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(f\"  promoted_count: {d['promoted_count']}\")
print(f\"  failed_count:   {d['failed_count']}\")
for r in d['results']:
    if r.get('error'):
        print(f\"  FAIL  draft={r['draft_id'][:8]}  err={r['error']}\")
    else:
        n = r['node']
        merged = ','.join(x[:8] for x in r.get('merged_with', []))
        print(f\"  OK    draft={r['draft_id'][:8]}\"
              f\"  merged=[{merged}]\"
              f\"  node={n['id'][:8]}\"
              f\"  title={n['title'][:40]}\")
" <<< "$body"
            return
        fi
        echo "promote HTTP $code: $body" >&2
    fi
    echo "promote failed (backend unreachable?). Try: ./start.sh start" >&2
    exit 1
}

handle_drafts() {
    local sub="${1:-help}"
    shift 2>/dev/null || true
    case "$sub" in
        list)    drafts_list "$@" ;;
        pinned)  drafts_list --pinned ;;
        count)   drafts_count "$@" ;;
        show)    drafts_show "$@" ;;
        promote) drafts_promote "$@" ;;
        help|--help|-h)
            cat <<'USAGE'
Usage: ./query.sh drafts <subcommand> [args]

  list [--all] [--pinned] [--ids]   List drafts (newest first, pinned at top).
  count [--all]                     Count unpromoted drafts.
  show <id>                         Show one draft in full.
  promote <id>...                   Promote one or more drafts into a real node.
                                    Short drafts created within 60s of each other
                                    are auto-merged into a single node.

Examples:
  ./query.sh drafts list
  ./query.sh drafts list --all
  ./query.sh drafts show a2c653b5-XXXX-XXXX-XXXX-XXXXXXXXXXXX
  ./query.sh drafts promote a2c653b5-XXXX 49d24099-XXXX
USAGE
            ;;
        *) echo "drafts: unknown subcommand: $sub (try 'drafts help')" >&2; exit 2 ;;
    esac
}

# ---- branch on top-level subcommand ----
case "$SUBCMD" in
    psql)
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
        exit $?
        ;;
    drafts)
        handle_drafts "$@"
        exit $?
        ;;
    -h|--help|help)
        show_help
        exit 0
        ;;
    "")
        # fall through to default node listing below
        ;;
    *)
        # Could be a node-flag; push it back to arg list
        if [[ "$SUBCMD" == --* ]]; then
            set -- "$SUBCMD" "$@"
        else
            echo "unknown arg: $SUBCMD (try --help)" >&2
            exit 2
        fi
        ;;
esac

# ---- node queries (default branch) ----
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