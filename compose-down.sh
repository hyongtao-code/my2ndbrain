#!/usr/bin/env bash
# Thin shim for stopping a Docker compose deployment of
# MySecondBrain. Forwards to scripts/stop.sh, which stops and
# optionally removes the container (but never the data volume).
#
# For the **native / direct** (non-Docker) workflow, use
# `./start.sh stop` instead.

set -euo pipefail

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
PARENT_DIR="$(dirname "$SCRIPT_PATH")"
if [ "$(basename "$SCRIPT_PATH")" = "stop.sh" ] && [ "$(basename "$PARENT_DIR")" = "scripts" ]; then
    exit 0
fi
exec "$PARENT_DIR/scripts/stop.sh" "$@"