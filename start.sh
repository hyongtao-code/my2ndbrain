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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/scripts/start.sh" "$@"