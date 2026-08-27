#!/usr/bin/env bash
# Thin shim for ./scripts/dev.sh.

set -euo pipefail

# Same detection logic as ./start.sh shim: if this shim is invoked
# from inside scripts/ via `./dev.sh`, the resolved path is
# already the real impl. Detect and return rather than double-exec.
SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
PARENT_DIR="$(dirname "$SCRIPT_PATH")"
GRANDPARENT_DIR="$(dirname "$PARENT_DIR")"
if [ "$(basename "$SCRIPT_PATH")" = "dev.sh" ] && [ "$(basename "$PARENT_DIR")" = "scripts" ]; then
    exit 0
fi
exec "$PARENT_DIR/scripts/dev.sh" "$@"
