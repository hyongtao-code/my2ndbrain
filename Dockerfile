#
# MySecondBrain — single all-in-one image.
#
# What runs inside the container:
#   - PostgreSQL 16 with the pgvector extension (single instance)
#   - FastAPI backend (uvicorn) on 0.0.0.0:8000
#   - The pre-built React frontend, served by FastAPI as static files
#
# Stages:
#   1. frontend-builder: npm ci + npm run build, produces /src-out
#   2. backend-builder : pip install + pre-download sentence-transformers
#                       model so the first run works offline
#   3. runtime         : Debian + PostgreSQL + pgvector + Python venv
#                       + frontend assets + entrypoint script
#
# User-facing run:
#   docker run -d -p 8000:8000 \
#       -v my2ndbrain-data:/var/lib/postgresql/data \
#       -e DB_PASSWORD=changeme \
#       -e LLM_PROVIDER=heuristic \
#       my2ndbrain:latest
#
# The single image ships with everything. The /var/lib/postgresql/data
# volume is the only persistent state (the user's graph + drafts).
#

# =============================================================================
# Stage 1 — build the React frontend
# =============================================================================
FROM node:20-bookworm AS frontend-builder
WORKDIR /src

# Cache npm install layer
COPY frontend/package.json frontend/package-lock.json* ./
# --legacy-peer-deps because vite@^8.2.1 (in package.json) and
# @vitejs/plugin-react@^4.7.0 (peer: vite@^4.2.0 || ^5 || ^6 || ^7)
# disagree on what major version of vite is supported. The local
# dev environment works because npm install --force was run there
# at some point; in a fresh Docker build we can't do that, so
# fall back to the legacy peer-dep resolver. The lockfile pins
# actual versions, so the install is reproducible.
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# Build with empty API base so all api calls hit relative paths
# (Vite dev server proxies /api to backend; in production, the
# FastAPI server itself proxies /api at the same origin).
COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 2 — install Python deps + pre-cache the embedding model
# =============================================================================
FROM python:3.12-bookworm AS backend-builder

# System deps for psycopg2-binary (libpq5 only; psycopg2-binary
# vendors its own libpq so we don't need build-essentials).
# We DO need build-essential for sentence-transformers + numpy
# compilation against the slim base if it falls back from wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./
# Build into a target dir so the runtime stage can COPY it without
# dragging the build tooling along.
RUN python -m venv /app/venv \
    && /app/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/venv/bin/pip install --no-cache-dir -r requirements.txt

# Pre-download the sentence-transformers model so the runtime
# container can run offline. The model is ~90MB and ends up in
# /app/models/. We only do this if HF_HUB_OFFLINE != 1; users with
# air-gapped installs can pass that env to skip the download.
ARG HF_HUB_OFFLINE=0
ENV HF_HUB_OFFLINE=${HF_HUB_OFFLINE} \
    HF_HOME=/app/models
RUN if [ "$HF_HUB_OFFLINE" != "1" ]; then \
       /app/venv/bin/pip install --no-cache-dir sentence-transformers && \
       /app/venv/bin/python -c "from sentence_transformers import SentenceTransformer; \
         SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')"; \
    fi

# =============================================================================
# Stage 3 — runtime: Debian + PostgreSQL 16 + pgvector
# =============================================================================
FROM debian:bookworm AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Runtime system deps:
#   - postgresql-16 + postgresql-contrib-16 + postgresql-16-pgvector
#     (pgvector is shipped in the official PGDG repo for pg16)
#   - gosu for stepping down from root to the postgres user in
#     entrypoint.sh
#   - libpq5 is already a dep of postgresql-client-16
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        gosu \
        postgresql-common \
    && . /etc/os-release \
    && echo "deb https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
            > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-16 \
        postgresql-contrib-16 \
        postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*

# Where everything lives in the image
ENV APP_HOME=/app \
    PGDATA=/var/lib/postgresql/data \
    PGBIN=/usr/lib/postgresql/16/bin \
    FRONTEND_DIST=/app/frontend-dist \
    HF_HOME=/app/models

# Python venv (from stage 2)
COPY --from=backend-builder /app/venv ${APP_HOME}/venv

# Backend code
COPY backend/app ${APP_HOME}/app
COPY backend/scripts ${APP_HOME}/scripts
COPY backend/requirements.txt ${APP_HOME}/requirements.txt

# Frontend build (from stage 1)
COPY --from=frontend-builder /src/dist ${FRONTEND_DIST}

# Embedding model cache (from stage 2; harmless if absent)
COPY --from=backend-builder /app/models /app/models

# Entrypoint: start postgres, wait, CREATE EXTENSION vector, exec uvicorn
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Default ports / dirs
EXPOSE 8000
VOLUME ["/var/lib/postgresql/data"]

# Make sure postgres data dir exists with the right ownership.
# We can't chown a mounted volume at build time, so the entrypoint
# script handles ownership of the freshly-initdb'd data directory.
RUN mkdir -p /var/lib/postgresql/data /var/run/postgresql /app/data /app/logs && \
    chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql && \
    chmod 2777 /var/run/postgresql

# Default env (overridable at `docker run -e ...`)
ENV DB_HOST=127.0.0.1 \
    DB_PORT=5432 \
    DB_USER=my2ndbrain \
    DB_PASSWORD=my2ndbrain \
    DB_NAME=my2ndbrain \
    EMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2 \
    EMBED_DEVICE=cpu \
    LLM_PROVIDER=heuristic \
    LLM_MODEL=MiniMax-M3 \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
