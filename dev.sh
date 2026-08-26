#!/usr/bin/env bash
# start.sh — bring up MySecondBrain's backend (:8000) + frontend (:5173).
#
# What it does:
#   1. Sanity-check prerequisites.
#   2. Ensure .env exists (copies from .env.example if missing).
#   3. Verify the backend can reach PostgreSQL (or surface a clear error).
#   4. Start FastAPI on :8000 (idempotent — reuses if up).
#   5. Start Vite on :5173 (idempotent — reuses if up).
#   6. Print the URLs.
#
# Stop everything: ./start.sh stop
# reset no longer wipes data (was destructive — see cmd_reset below).
#
# Requirements: bash 4+, python3, node, npm.
# PostgreSQL must already be running with a user/db that matches .env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
LOG_DIR="$SCRIPT_DIR/.run"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PID="$LOG_DIR/frontend.pid"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="5173"

mkdir -p "$LOG_DIR"

if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'
    C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'
else
    C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi

info()  { printf "%s[info]%s  %s\n" "$C_BLUE"   "$C_RESET" "$*"; }
ok()    { printf "%s[ ok ]%s  %s\n" "$C_GREEN"  "$C_RESET" "$*"; }
warn()  { printf "%s[warn]%s  %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
fail()  { printf "%s[fail]%s  %s\n" "$C_RED"    "$C_RESET" "$*" >&2; exit 1; }

CMD="${1:-start}"
shift || true

is_port_listening() {
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${1}$" >/dev/null 2>&1
}

pid_alive() {
    [[ -f "$1" ]] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null
}

stop_pid_file() {
    local pid_file="$1" name="$2"
    if pid_alive "$pid_file"; then
        local pid; pid="$(cat "$pid_file")"
        info "stopping $name (pid=$pid)"
        kill "$pid" 2>/dev/null || true
        for _ in $(seq 1 50); do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.1
        done
        if kill -0 "$pid" 2>/dev/null; then
            warn "$name did not exit gracefully; SIGKILL"
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$pid_file"
    fi
}

port_killer() {
    local port="$1" name="$2"
    local pids=""
    pids="$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $0}' | grep -oE 'pid=[0-9]+' | awk -F= '{print $2}' | sort -u || true)"
    if [[ -z "$pids" ]]; then
        return 0
    fi
    for pid in $pids; do
        [[ -n "$pid" ]] || continue
        warn "$name port $port held by pid=$pid — killing"
        kill -9 "$pid" 2>/dev/null || true
    done
}

wait_for_http() {
    local url="$1" name="$2" tries="${3:-50}" logfile="$4"
    for _ in $(seq 1 "$tries"); do
        if curl -sf "$url" >/dev/null 2>&1; then
            ok "$name is up"
            return 0
        fi
        sleep 0.2
    done
    log_tail=$(tail -20 "$logfile" 2>/dev/null || echo '(no log)')
    fail "$name did not respond at $url. Last log lines: $log_tail"
}

# ============================================================
# Validate .env (does NOT connect to DB; the backend will surface that error)
# ============================================================
ensure_env() {
    if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
        warn ".env missing — copying from .env.example"
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        info "edit $SCRIPT_DIR/.env to set DB_PASSWORD (and other settings), then re-run"
        # We don't auto-inject a demo password here because we can't safely
        # pass it through shell quoting. The user must fill it in.
        fail ".env created. Set DB_PASSWORD in it, then re-run."
    fi
    if ! grep -qE '^DB_PASSWORD=..+' "$SCRIPT_DIR/.env"; then
        fail ".env has empty DB_PASSWORD — set it to your PostgreSQL password"
    fi
}

cmd_start() {
    info "MySecondBrain launcher — repo at $SCRIPT_DIR"

    # 1. prerequisites
    for cmd in python3 node npm ss curl; do
        command -v "$cmd" >/dev/null 2>&1 || fail "missing prerequisite: $cmd"
    done

    # 2. .env
    ensure_env

    # 3. backend (FastAPI on :8000)
    if pid_alive "$BACKEND_PID" && curl -sf "http://$BACKEND_HOST:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
        ok "backend already running (pid=$(cat "$BACKEND_PID"))"
    elif curl -sf "http://$BACKEND_HOST:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
        # Already serving on :8000 but not by us — adopt it.
        local_pid=$(ss -ltnp 2>/dev/null | awk -v p=":$BACKEND_PORT" '$4 ~ p {print $0}' | grep -oE 'pid=[0-9]+' | awk -F= '{print $2}' | head -1)
        if [[ -n "$local_pid" ]]; then
            echo "$local_pid" > "$BACKEND_PID"
            ok "backend already serving on :$BACKEND_PORT (pid=$local_pid) — adopting"
        fi
    else
        rm -f "$BACKEND_PID"
        port_killer "$BACKEND_PORT" "backend"
        info "starting backend on http://$BACKEND_HOST:$BACKEND_PORT"
        (
            cd "$BACKEND_DIR"
            # Strip SOCKS proxies that nohup mangles (socks5 gets rewritten
                # to socks in the spawned process, which httpx 0.28
                # rejects with: ValueError: Unknown scheme for proxy
                # URL). Backend only needs HTTP/HTTPS for LLM API
                # calls, which come from HTTPS_PROXY (kept). The
                # frontend Vite process still has ALL_PROXY intact
                # (browser-side fetches don't go through httpx).
                unset ALL_PROXY all_proxy
                PYTHONPATH=. nohup python3 -m uvicorn app.main:app \
                --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
                --log-level info \
                > "$BACKEND_LOG" 2>&1 &
            echo $! > "$BACKEND_PID"
        )
        wait_for_http "http://$BACKEND_HOST:$BACKEND_PORT/api/health" "backend" 50 "$BACKEND_LOG"
    fi

    # 4. frontend (Vite on :5173)
    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
        warn "node_modules missing — running npm install"
        (cd "$FRONTEND_DIR" && npm install --no-audit --no-fund --silent) \
            || fail "npm install failed"
    fi
    if pid_alive "$FRONTEND_PID" && curl -sf "http://$FRONTEND_HOST:$FRONTEND_PORT/" >/dev/null 2>&1; then
        ok "frontend already running (pid=$(cat "$FRONTEND_PID"))"
    elif curl -sf "http://$FRONTEND_HOST:$FRONTEND_PORT/" >/dev/null 2>&1; then
        # Already serving on :5173 but not by us — adopt it.
        local_pid=$(ss -ltnp 2>/dev/null | awk -v p=":$FRONTEND_PORT" '$4 ~ p {print $0}' | grep -oE 'pid=[0-9]+' | awk -F= '{print $2}' | head -1)
        if [[ -n "$local_pid" ]]; then
            echo "$local_pid" > "$FRONTEND_PID"
            ok "frontend already serving on :$FRONTEND_PORT (pid=$local_pid) — adopting"
        fi
    else
        rm -f "$FRONTEND_PID"
        port_killer "$FRONTEND_PORT" "frontend"
        info "starting frontend on http://$FRONTEND_HOST:$FRONTEND_PORT"
        (
            cd "$FRONTEND_DIR"
            nohup npx vite --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" \
                > "$FRONTEND_LOG" 2>&1 &
            echo $! > "$FRONTEND_PID"
        )
        wait_for_http "http://$FRONTEND_HOST:$FRONTEND_PORT/" "frontend" 75 "$FRONTEND_LOG"
    fi

    echo
    ok "MySecondBrain is up. Open in your browser:"
    printf "    %shttp://%s:%s/%s\n" "$C_GREEN" "$FRONTEND_HOST" "$FRONTEND_PORT" "$C_RESET"
    printf "    Backend API:  %shttp://%s:%s/api/health%s\n" "$C_BLUE" "$BACKEND_HOST" "$BACKEND_PORT" "$C_RESET"
    printf "    Swagger docs: %shttp://%s:%s/docs%s\n"        "$C_BLUE" "$BACKEND_HOST" "$BACKEND_PORT" "$C_RESET"
    printf "    Logs: %s%s | %s%s\n"                          "$C_BLUE" "$BACKEND_LOG" "$FRONTEND_LOG" "$C_RESET"
    printf "    Stop: %s%s stop%s\n"                          "$C_BLUE" "$SCRIPT_DIR/start.sh" "$C_RESET"
}

cmd_stop() {
    info "stopping MySecondBrain"
    stop_pid_file "$FRONTEND_PID" "frontend"
    stop_pid_file "$BACKEND_PID"  "backend"
    port_killer "$FRONTEND_PORT" "frontend"
    port_killer "$BACKEND_PORT"  "backend"
    ok "stopped"
}

cmd_status() {
    local bp fp bs fs
    bp="$(pid_alive "$BACKEND_PID"  && cat "$BACKEND_PID"  || echo '-')"
    fp="$(pid_alive "$FRONTEND_PID" && cat "$FRONTEND_PID" || echo '-')"
    bs="down"; curl -sf "http://$BACKEND_HOST:$BACKEND_PORT/api/health"  >/dev/null 2>&1 && bs="up"
    fs="down"; curl -sf "http://$FRONTEND_HOST:$FRONTEND_PORT/"        >/dev/null 2>&1 && fs="up"
    printf "%sbackend%s:  pid=%s  http://%s:%s/api/health -> %s\n" "$C_BLUE" "$C_RESET" "$bp" "$BACKEND_HOST" "$BACKEND_PORT" "$bs"
    printf "%sfrontend%s: pid=%s  http://%s:%s/         -> %s\n" "$C_BLUE" "$C_RESET" "$fp" "$FRONTEND_HOST" "$FRONTEND_PORT" "$fs"
}

cmd_reset() {
    # NOTE: This used to TRUNCATE knowledge_node/edge/cluster/skill and
    # reseed. That destroys the user's real knowledge graph, which is
    # catastrophic — the whole point of this app is the data. Removed.
    #
    # "reset" now means: just stop the running services and start them
    # again. No data is touched. If you really do want a fresh empty
    # brain, delete rows manually via ./query.sh psql.
    warn "reset no longer truncates the database — it just restarts services"
    info "(the old TRUNCATE + reseed behaviour was removed to protect your real data)"
    cmd_stop
    cmd_start
}

cmd_logs() {
    local which="${1:-all}"
    case "$which" in
        backend)  tail -n 100 -f "$BACKEND_LOG" ;;
        frontend) tail -n 100 -f "$FRONTEND_LOG" ;;
        all|*)    tail -n 50 -f "$BACKEND_LOG" "$FRONTEND_LOG" ;;
    esac
}

case "$CMD" in
    start)  cmd_start ;;
    stop)   cmd_stop ;;
    status) cmd_status ;;
    reset)  cmd_reset ;;  # restart only — does NOT delete data
    logs)   cmd_logs "${1:-all}" ;;
    -h|--help|help)
        cat <<EOF
Usage: $0 <command>

Commands:
  start    Bring up backend + frontend (default).
  stop     Stop backend + frontend.
  status   Show process + HTTP health.
  reset    Restart services (does NOT touch the database — see cmd_reset).
  logs [backend|frontend|all]  Tail the logs (default: all).

Logs:        $LOG_DIR
PID files:   $LOG_DIR/backend.pid, $LOG_DIR/frontend.pid

First run requires:
  1. PostgreSQL 16 running locally with pgvector extension.
  2. A user + database matching DB_USER / DB_NAME in .env.
  3. .env present at repo root (copied from .env.example; DB_PASSWORD set).
EOF
        ;;
    *) fail "unknown command: $CMD (try '$0 help')" ;;
esac