#!/usr/bin/env bash
# Thin shim for the **Docker compose** deployment of MySecondBrain.
#
# Subcommands:
#   start   — bring the container up (build image if missing)
#   stop    — stop the container (data volume is preserved)
#   --help  — show the docker compose help banner
#
# For the **native / direct** (non-Docker) workflow, use
# `./start.sh start` / `./start.sh stop` instead.

set -euo pipefail

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
PARENT_DIR="$(dirname "$SCRIPT_PATH")"

# Build the argv we will forward to the real scripts/<name>.sh.
# We do this by mapping the user-facing command to either
# `scripts/start.sh` (the docker compose up + build + wait flow)
# or `scripts/stop.sh` (stop, optionally remove). Any extra
# arguments (--rebuild, --pull, --rm, --help, ...) are forwarded
# verbatim.
#
# Detection: if we were invoked via `./compose.sh` from any
# location, the first arg decides. If we were invoked from inside
# scripts/ via a path that resolved to scripts/start.sh or
# scripts/stop.sh, just forward all args to that script.
ARGS=("$@")

case "$(basename "$SCRIPT_PATH")" in
    start.sh)
        exec "$SCRIPT_PATH" "${ARGS[@]}"
        ;;
    stop.sh)
        exec "$SCRIPT_PATH" "${ARGS[@]}"
        ;;
    compose.sh|*)
        # Normal root invocation: dispatch on the first argument.
        case "${1:-}" in
            start)
                shift
                exec "$PARENT_DIR/scripts/start.sh" "$@"
                ;;
            stop)
                shift
                exec "$PARENT_DIR/scripts/stop.sh" "$@"
                ;;
            -h|--help)
                # No subcommand given; show the docker compose up
                # shim's --help banner so `./compose.sh --help`
                # matches `./compose.sh start --help`.
                exec "$PARENT_DIR/scripts/start.sh" --help
                ;;
            "")
                echo "Usage: $0 {start|stop} [--rebuild|--pull|--rm|--help]" >&2
                echo "  For the native (non-Docker) workflow, use ./start.sh instead." >&2
                exit 2
                ;;
            *)
                echo "Unknown subcommand: $1" >&2
                echo "Usage: $0 {start|stop} [--rebuild|--pull|--rm|--help]" >&2
                exit 2
                ;;
        esac
        ;;
esac