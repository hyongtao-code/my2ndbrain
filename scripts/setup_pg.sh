#!/usr/bin/env bash
# setup_pg.sh — diagnose / verify the PostgreSQL setup that
# MySecondBrain's dev workflow (./start.sh) needs.
#
# What this script does:
#   ./scripts/setup_pg.sh check     -> just verify, exit non-zero on failure
#   ./scripts/setup_pg.sh doctor    -> human-friendly walkthrough
#   ./scripts/setup_pg.sh help      -> show usage
#
# This script is INTENTIONALLY non-destructive. It will never:
#   - install system packages
#   - modify your .env
#   - create / drop users, databases, or roles
#   - change passwords
# It only reads state and tells you the exact command you need to
# run if something is missing. This avoids any "magic" behavior that
# would surprise a developer who's debugging their own setup.
#
# What it verifies (in `check` mode):
#   1. psql + pg_isready are on PATH
#   2. A PostgreSQL server is reachable at $DB_HOST:$DB_PORT
#   3. We can authenticate as $DB_USER against $DB_NAME
#   4. The pgvector extension is available (installable) on this server
#
# Reads DB_HOST / DB_PORT / DB_USER / DB_NAME / DB_PASSWORD from .env
# at the repo root (same file ./start.sh reads).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

# ANSI colors only when stdout is a tty
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_RED=$'\033[1;31m'; C_GREEN=$'\033[1;32m'
    C_YELLOW=$'\033[1;33m'; C_BLUE=$'\033[1;34m'; C_BOLD=$'\033[1m'
else
    C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""
fi

ok()   { printf "%s[ ok ]%s  %s\n" "$C_GREEN"  "$C_RESET" "$*"; }
warn() { printf "%s[warn]%s  %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf "%s[fail]%s  %s\n" "$C_RED"    "$C_RESET" "$*" >&2; }
info() { printf "%s[info]%s  %s\n" "$C_BLUE"   "$C_RESET" "$*"; }

# ---- Load .env (DB_* vars) --------------------------------------------
load_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        err ".env not found at $ENV_FILE"
        info "Run './start.sh' once — it will copy .env.example to .env"
        info "then edit DB_PASSWORD and re-run."
        return 1
    fi
    # Source only DB_* lines; nothing else.
    local line key val
    while IFS= read -r line; do
        # Skip comments and blank lines
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        if [[ "$line" =~ ^DB_(HOST|PORT|USER|NAME|PASSWORD)= ]]; then
            key="${line%%=*}"
            val="${line#*=}"
            # Strip optional surrounding quotes
            val="${val%\"}"; val="${val#\"}"
            val="${val%\'}"; val="${val#\'}"
            export "$key=$val"
        fi
    done < "$ENV_FILE"
    : "${DB_HOST:=127.0.0.1}"
    : "${DB_PORT:=5432}"
    : "${DB_USER:=my2ndbrain}"
    : "${DB_NAME:=my2ndbrain}"
    : "${DB_PASSWORD:=}"
}

# ---- Subcommand: check (silent-ish, exit code is the answer) ----------
cmd_check() {
    load_env || return 1

    if [[ -z "$DB_PASSWORD" ]]; then
        err "DB_PASSWORD is empty in .env — set it and re-run"
        return 1
    fi

    # 1. client tools
    local missing=0
    for cmd in psql pg_isready; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            err "missing client tool: $cmd"
            missing=1
        fi
    done
    if [[ "$missing" -ne 0 ]]; then
        info "install postgresql-client (Ubuntu/Debian):"
        info "    sudo apt-get install -y postgresql-client"
        info "install postgresql (server, Ubuntu/Debian):"
        info "    sudo apt-get install -y postgresql-16 postgresql-16-pgvector"
        return 1
    fi

    # 2. server reachable
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
        err "cannot reach PostgreSQL at $DB_HOST:$DB_PORT"
        info "if you don't have a local PG, the easiest path is Docker:"
        info "    docker run -d --name my2ndbrain-pg -p 5432:5432 \\"
        info "      -e POSTGRES_USER=my2ndbrain \\"
        info "      -e POSTGRES_PASSWORD=change-me \\"
        info "      -e POSTGRES_DB=my2ndbrain \\"
        info "      pgvector/pgvector:pg16"
        info "if PG is installed but not running:"
        info "    sudo systemctl start postgresql        # systemd"
        info "    sudo pg_ctlcluster 16 main start       # older Ubuntu"
        info "    brew services start postgresql@16     # macOS Homebrew"
        return 1
    fi

    # 3. auth check. NOTE: PGPASSWORD= must be passed as an env-var
    # assignment in front of the command — quoting matters because
    # some passwords contain special characters. We use the array
    # form via `env` to keep the quoting clean.
    if ! env PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" \
            -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" \
            >/dev/null 2>&1; then
        err "cannot authenticate as '$DB_USER' against '$DB_NAME' on $DB_HOST:$DB_PORT"
        info "common causes + fixes:"
        info "  (a) wrong password in .env  ->  edit DB_PASSWORD in .env"
        info "  (b) user doesn't exist      ->  sudo -u postgres createuser -s my2ndbrain"
        info "  (c) database doesn't exist  ->  sudo -u postgres createdb -O my2ndbrain my2ndbrain"
        info "  (d) pg_hba.conf uses 'peer' for local  ->  change to 'md5' or 'scram-sha-256'"
        info "  (e) using .pgpass?  ->  check ~/.pgpass or %APPDATA%\\postgresql\\pgpass.conf"
        return 1
    fi

    # 4. pgvector extension — try to install (idempotent) and verify it's loaded
    if ! env PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" \
            -U "$DB_USER" -d "$DB_NAME" -c \
            "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1; then
        err "pgvector extension is not installable on this server"
        info "install pgvector for your PG version:"
        info "    Ubuntu/Debian: sudo apt-get install -y postgresql-16-pgvector"
        info "    Fedora/RHEL:   sudo dnf install -y pgvector_16"
        info "    macOS Homebrew: brew install pgvector"
        info "    Docker:         use the pgvector/pgvector:pg16 image (not postgres:16)"
        return 1
    fi
    # Verify it's actually present (CREATE EXTENSION IF NOT EXISTS is silent
    # if the extension package isn't installed server-side)
    if ! env PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" \
            -U "$DB_USER" -d "$DB_NAME" -tA -c \
            "SELECT extname FROM pg_extension WHERE extname='vector';" \
            2>/dev/null | grep -q '^vector$'; then
        err "pgvector extension not loaded — server is missing the .so / package"
        info "see the apt/dnf/brew commands in the message above"
        return 1
    fi

    ok "PostgreSQL $DB_HOST:$DB_PORT is ready, user=$DB_USER db=$DB_NAME, pgvector loaded"
    return 0
}

# ---- Subcommand: doctor (verbose walkthrough) ------------------------
cmd_doctor() {
    echo "${C_BOLD}=== MySecondBrain PostgreSQL doctor ===${C_RESET}"
    echo
    load_env || return 1
    echo "  .env:          $ENV_FILE"
    echo "  DB_HOST:       $DB_HOST"
    echo "  DB_PORT:       $DB_PORT"
    echo "  DB_USER:       $DB_USER"
    echo "  DB_NAME:       $DB_NAME"
    echo "  DB_PASSWORD:   ${DB_PASSWORD:+***set***}${DB_PASSWORD:-(empty)}"
    echo
    if cmd_check; then
        echo
        ok "all green — ./start.sh should work"
    else
        echo
        warn "setup incomplete — see the [fail] lines above for the exact fix"
        return 1
    fi
}

# ---- Subcommand: help -------------------------------------------------
cmd_help() {
    cat <<EOF
Usage: $0 <command>

Commands:
  check    Verify DB connectivity + pgvector. Silent on success, prints
           actionable fix on failure. Used by ./start.sh as a gate.
           Exits 0 on success, non-zero on any failure.
  doctor   Same checks as \`check\` but with verbose setup info. Read this
           if \`check\` is failing and you want to understand why.
  help     Show this message.

What \`check\` verifies:
  1. psql + pg_isready are on PATH
  2. A PostgreSQL server is reachable at \$DB_HOST:\$DB_PORT
  3. We can authenticate as \$DB_USER against \$DB_NAME
  4. The pgvector extension is available on this server

This script is read-only — it never modifies your system, .env, users,
or databases. If something is missing, it tells you the exact command
to run yourself.
EOF
}

case "${1:-check}" in
    check)  cmd_check ;;
    doctor) cmd_doctor ;;
    help|-h|--help) cmd_help ;;
    *) err "unknown command: $1 (try '$0 help')"; exit 2 ;;
esac
