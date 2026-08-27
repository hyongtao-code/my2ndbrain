#!/usr/bin/env bash
# Thin shim for the **native / direct** (non-Docker) workflow.
# The real script lives at scripts/dev.sh; this shim exists so
# users can run `./start.sh` from the repo root. All arguments are
# forwarded unchanged (the real script supports start / stop /
# status / reset / logs / help).
#
# If the resolved file is the real implementation (we landed on
# scripts/dev.sh because the user invoked the shim from
# scripts/), there's nothing more to do — return success.
#
# For the **Docker compose** workflow, use `./compose-up.sh` and
# `./compose-down.sh` instead.
SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
PARENT_DIR="$(dirname "$SCRIPT_PATH")"
if [ "$(basename "$SCRIPT_PATH")" = "dev.sh" ] && [ "$(basename "$PARENT_DIR")" = "scripts" ]; then
    # Already at the real implementation; nothing to exec.
    exit 0
fi
exec "$PARENT_DIR/scripts/dev.sh" "$@"
