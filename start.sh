#!/usr/bin/env bash
# Thin shim for ./scripts/start.sh.
#
# The real script lives at scripts/start.sh; this shim exists so
# users can run `./start.sh` from the repo root (which is what
# every part of the README / Docker entrypoint / makefile-style
# docs expects). All arguments are forwarded unchanged.
#
# Note: scripts/docker-entrypoint.sh stays at the repo root —
# Dockerfile hardcodes that path, so it cannot be moved.

set -euo pipefail

# Resolve the real script location regardless of where the user
# invokes it from. We use realpath so that:
#   - ./start.sh from repo root      →  repo_root/scripts/start.sh ✓
#   - cd scripts && ./start.sh      →  repo_root/scripts/start.sh ✓
#   - /abs/path/start.sh anywhere   →  that file, if it is the shim
#
# If the resolved file is the real implementation (we landed on
# scripts/start.sh because the user invoked the shim from
# scripts/), there's nothing more to do — return success.
SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
PARENT_DIR="$(dirname "$SCRIPT_PATH")"
GRANDPARENT_DIR="$(dirname "$PARENT_DIR")"
if [ "$(basename "$SCRIPT_PATH")" = "start.sh" ] && [ "$(basename "$PARENT_DIR")" = "scripts" ]; then
    # Already at the real implementation; nothing to exec.
    exit 0
fi
exec "$PARENT_DIR/scripts/start.sh" "$@"
