#!/bin/bash
# docker-entrypoint.sh — runs inside the MySecondBrain container.
#
# Responsibility: bring up postgres, create the role + database the
# backend expects, install the pgvector extension, then exec uvicorn
# as the CMD (or whatever the user passed in `docker run ... my2ndbrain
# bash`, etc.).
#
# Layout:
#   /var/lib/postgresql/data   PGDATA, persisted via the -v volume
#   /var/run/postgresql        unix socket dir
#   /app                       the backend code (uvicorn venv + app/)
#   /app/frontend-dist         the Vite-built React assets
#
# Env that this script honours (set via `docker run -e ...` or via
# the Dockerfile's ENV defaults):
#   DB_USER     default my2ndbrain
#   DB_PASSWORD default *********
#   DB_NAME     default my2ndbrain
#   DB_PORT     default 5432 (postgres-internal, not exposed)
#   DB_HOST     default 127.0.0.1 (postgres-internal, not exposed)
#   POSTGRES_PORT (alias)  5432
#   LLM_PROVIDER heuristic by default

set -euo pipefail

PG_BIN=/usr/lib/postgresql/16/bin
PGDATA=/var/lib/postgresql/data
PGCONF=/etc/postgresql/16/main
PG_RUN=/var/run/postgresql
PGSOCK=${PG_RUN}/.s.PGSQL.${DB_PORT:-5432}

log() { echo "[entrypoint] $*" >&2; }

# ---------------------------------------------------------------------------
# 1. Initialise PGDATA if empty (i.e. first run or fresh volume).
# ---------------------------------------------------------------------------
if [ ! -s "${PGDATA}/PG_VERSION" ]; then
    log "PGDATA empty at ${PGDATA} — running initdb as postgres user"
    # initdb must run as the postgres OS user, not root.
    # Ensure the log file directory exists (/var/log may not be
    # present in the slim base image) and capture initdb output for
    # debugging. We also stream a tiny marker to the foreground so
    # the user sees something happen during first-run init.
    mkdir -p /var/log
    log "first-run initdb — this takes 5-10 seconds"
    gosu postgres "${PG_BIN}/initdb" \
        --pgdata="${PGDATA}" \
        --username=postgres \
        --auth-local=trust \
        --auth-host=trust \
        --encoding=UTF8 \
        --locale=C.UTF-8 \
        >/var/log/initdb.log 2>&1
    log "initdb ok"
fi

# ---------------------------------------------------------------------------
# 2. Configure pg_hba.conf to trust localhost (so we can run psql
#    as the postgres OS user without a password during entrypoint).
#    In-container only; the unix socket and 127.0.0.1 are the only
#    paths in, so this is safe.
# ---------------------------------------------------------------------------
HBA="${PGDATA}/pg_hba.conf"
if ! grep -q '^# my2ndbrain-trusted' "${HBA}" 2>/dev/null; then
    log "Adding trust entries to pg_hba.conf"
    cat >>"${HBA}" <<'EOF'
# my2ndbrain-trusted
local   all    all                   trust
host    all    all    127.0.0.1/32   trust
host    all    all    ::1/128        trust
EOF
fi

# ---------------------------------------------------------------------------
# 3. Configure listen_addresses + port. We bind to localhost only
#    since FastAPI runs in the same container.
# ---------------------------------------------------------------------------
PGCONF_FILE="${PGDATA}/postgresql.conf"
if ! grep -q '^# my2ndbrain-listener' "${PGCONF_FILE}" 2>/dev/null; then
    log "Patching postgresql.conf (listen_addresses=localhost, port=${DB_PORT:-5432})"
    cat >>"${PGCONF_FILE}" <<EOF
# my2ndbrain-listener
listen_addresses = '127.0.0.1'
port = ${DB_PORT:-5432}
unix_socket_directories = '${PG_RUN}'
EOF
fi

# ---------------------------------------------------------------------------
# 4. Start postgres (as postgres OS user). -w waits for it to be
#    ready, so we know by the time it returns that psql will work.
# ---------------------------------------------------------------------------
log "Starting postgres (data=${PGDATA}, port=${DB_PORT:-5432})"
gosu postgres "${PG_BIN}/pg_ctl" \
    -D "${PGDATA}" \
    -l "${PG_RUN}/postgres.log" \
    -o "-c unix_socket_directories='${PG_RUN}'" \
    start
"${PG_BIN}/pg_isready" \
    -h 127.0.0.1 -p "${DB_PORT:-5432}" \
    -t 30 \
    || { log "postgres failed to start"; cat "${PG_RUN}/postgres.log" >&2; exit 1; }
log "postgres is up"

# ---------------------------------------------------------------------------
# 5. Create the role + database the backend expects (idempotent).
# ---------------------------------------------------------------------------
gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "${DB_PORT:-5432}" <<EOSQL
DO \$\$
BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASSWORD}';
   END IF;
END
\$\$;
EOSQL

# Idempotent database creation. CREATE DATABASE can't be in DO block
# in older pg versions, so do it separately.
DB_EXISTS=$(gosu postgres psql -h 127.0.0.1 -p "${DB_PORT:-5432}" \
    -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || true)
if [ "${DB_EXISTS}" != "1" ]; then
    log "Creating database ${DB_NAME} owned by ${DB_USER}"
    gosu postgres createdb \
        -h 127.0.0.1 -p "${DB_PORT:-5432}" \
        -O "${DB_USER}" "${DB_NAME}"
fi

# ---------------------------------------------------------------------------
# 6. Install pgvector extension in the target database. CREATE
#    EXTENSION IF NOT EXISTS is a no-op if it's already there. The
#    .deb postgresql-16-pgvector package ships the .so file.
# ---------------------------------------------------------------------------
log "Creating pgvector extension (if not present)"
gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "${DB_PORT:-5432}" \
    -d "${DB_NAME}" \
    -c 'CREATE EXTENSION IF NOT EXISTS vector;'

# ---------------------------------------------------------------------------
# 7. Hand off to the CMD (uvicorn) as the non-root user. We chown
#    /app/data + /app/logs so any later code that writes there can
#    do so without permission errors.
# ---------------------------------------------------------------------------
mkdir -p /app/data /app/logs
chown -R nobody:nogroup /app/data /app/logs 2>/dev/null || \
    chown -R root:root /app/data /app/logs
chmod 0755 /app/data /app/logs

# The backend-builder stage creates a venv with python linked
# to /usr/local/bin/python (the path inside python:3.12-bookworm).
# The runtime stage is debian:bookworm where python lives at
# /usr/bin/python3. If the venv can't find /usr/local/bin/python,
# uvicorn fails with "required file not found". Detect that and
# create a compat symlink.
if [ ! -x /usr/local/bin/python ] && [ -x /usr/bin/python3 ]; then
    log "linking /usr/local/bin/python -> /usr/bin/python3 (venv compat)"
    mkdir -p /usr/local/bin
    ln -sf /usr/bin/python3 /usr/local/bin/python
fi

# Ensure venv tools are on PATH for the exec
export PATH="/app/venv/bin:${PATH}"

# Make venv work even if HOME is unset
export HOME="${HOME:-/root}"

log "Starting backend: $@"
exec "$@"
