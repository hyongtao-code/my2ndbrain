#!/usr/bin/env bash
# prereq.sh — check that the host can run MySecondBrain.
#
# What it verifies:
#   1. docker is installed and the daemon is reachable
#   2. docker compose (v2 plugin) is available
#   3. port 8000 is free (the app's main port)
#   4. enough free disk space for the image (~1GB) and the
#      postgres data volume (~1GB plus growth over time)
#   5. enough free RAM for postgres + the embedding model
#      (sentence-transformers loads ~400MB; postgres uses ~50MB)
#
# Exits non-zero on the first failure with a clear message so the
# user knows what to install / free up before re-running start.sh.
#
# Pure read-only — does not modify anything on the host.

set -euo pipefail

ok=0
warn=0

# ---- 1. docker ---------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "✗ docker not found"
    echo "  Install: https://docs.docker.com/engine/install/"
    exit 1
fi
echo "✓ docker found: $(docker --version)"

if ! docker info >/dev/null 2>&1; then
    echo "✗ docker daemon not reachable"
    echo "  Try: sudo systemctl start docker"
    echo "  Or add yourself to the docker group and re-login:"
    echo "       sudo usermod -aG docker \$USER"
    exit 1
fi
echo "✓ docker daemon reachable"

# ---- 2. docker compose -------------------------------------------------
if docker compose version >/dev/null 2>&1; then
    echo "✓ docker compose (v2) found: $(docker compose version --short)"
elif command -v docker-compose >/dev/null 2>&1; then
    echo "⚠ docker-compose (v1) found — this script uses 'docker compose'"
    echo "  (v2 syntax). Please upgrade to the compose v2 plugin:"
    echo "  https://docs.docker.com/compose/install/"
    warn=1
else
    echo "✗ docker compose not found"
    echo "  Install: https://docs.docker.com/compose/install/"
    exit 1
fi

# ---- 3. port 8000 -------------------------------------------------------
if command -v ss >/dev/null 2>&1; then
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -E ':(8000|5173)$' >/dev/null; then
        echo "✗ port 8000 is in use"
        ss -tlnp 2>/dev/null | grep -E ':(8000|5173)' | sed 's/^/    /'
        echo "  Free port 8000 before starting (or change the port mapping in"
        echo "  docker-compose.yml)."
        exit 1
    fi
    echo "✓ port 8000 is free"
else
    echo "  (ss not found, skipping port check)"
    warn=1
fi

# ---- 4. disk space -----------------------------------------------------
free_kb=$(df -Pk "$(dirname "$0")" 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$free_kb" ]; then
    free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 2 ]; then
        echo "✗ only ${free_gb}GB free disk space; need ≥ 2GB"
        echo "  (image ~1GB + postgres data volume ~1GB)"
        exit 1
    fi
    echo "✓ ${free_gb}GB free disk space"
else
    echo "  (df not parseable, skipping disk check)"
    warn=1
fi

# ---- 5. RAM ------------------------------------------------------------
if [ -f /proc/meminfo ]; then
    avail_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
    if [ -n "$avail_kb" ]; then
        avail_gb=$((avail_kb / 1024 / 1024))
        if [ "$avail_gb" -lt 2 ]; then
            echo "⚠ only ${avail_gb}GB RAM available; recommend ≥ 2GB"
            echo "  (postgres uses ~50MB; sentence-transformers model ~400MB)"
            warn=1
        else
            echo "✓ ${avail_gb}GB RAM available"
        fi
    fi
else
    echo "  (/proc/meminfo not available, skipping RAM check)"
    warn=1
fi

# ---- summary -----------------------------------------------------------
echo
if [ "$warn" -eq 0 ]; then
    echo "All prerequisites met. You can run ./start.sh now."
    exit 0
else
    echo "Prerequisites met with warnings (see above). You can still"
    echo "run ./start.sh but the app may not behave as expected."
    exit 0
fi
