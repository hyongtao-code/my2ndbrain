#!/usr/bin/env bash
# Thin shim for the **Docker compose** bring-up of MySecondBrain.
#
# The real script lives at scripts/start.sh (Docker compose: build
# image if missing, run `docker compose up -d`, wait for the
# container to become healthy, print URL). All arguments are
# forwarded unchanged (the real script supports --rebuild,
# --pull, --help).
#
# For the **native / direct** (non-Docker) workflow, use
# `./start.sh` instead, which runs uvicorn + vite dev against a
# system-installed postgres.

set -euo pipefail

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
PARENT_DIR="$(dirname "$SCRIPT_PATH")"
if [ "$(basename "$SCRIPT_PATH")" = "start.sh" ] && [ "$(basename "$PARENT_DIR")" = "scripts" ]; then
    # Already at the real implementation; nothing to exec.
    exit 0
fi
exec "$PARENT_DIR/scripts/start.sh" "$@"