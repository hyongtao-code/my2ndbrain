# MySecondBrain — Docker deployment

A single Docker image that bundles **everything**: PostgreSQL 16 + the
`pgvector` extension, the FastAPI backend, and the pre-built React
frontend. One image, one command, one persistent volume.

## Quick start (the only command you need)

The easiest way is `./compose-up.sh` (a thin shim that calls
`scripts/start.sh`, which runs `docker compose up -d` for you):

```bash
./compose-up.sh                     # build image if missing, then docker compose up -d
open http://localhost:8000/
```

If you prefer to call docker compose directly (e.g. to pass extra
flags), the equivalent raw docker commands are:



```bash
docker run -d -p 8000:8000 \
    --name my2ndbrain \
    -v my2ndbrain-data:/var/lib/postgresql/data \
    -e DB_PASSWORD=my2ndbrain \
    my2ndbrain:latest
```

Then open `http://localhost:8000/` (or `http://<host-ip>:8000/` from any
machine on the same network) in a browser. The page loads, the API
responds, the database persists across restarts.

To stop:

```bash
docker stop my2ndbrain
```

To remove the container (but **keep** the data volume):

```bash
docker rm my2ndbrain
```

To **also** wipe the data:

```bash
docker rm my2ndbrain
docker volume rm my2ndbrain-data
```

## docker compose (alternative)

```bash
DB_PASSWORD=my2ndbrain docker compose up -d
```

`docker-compose.yml` ships with the same defaults and exposes the
data via a named volume `my2ndbrain-data`.

## Build the image

```bash
docker build -t my2ndbrain:latest .
```

Build takes 5-10 minutes on first run (downloads `node:20-bookworm`,
`python:3.12-bookworm`, `debian:bookworm`, and the `pgvector` extension).

If you want to **skip the embedding-model download** during build (you
have no internet, or the model is already cached), pass
`HF_HUB_OFFLINE=1`. The image will then fall back to a TF-IDF
embedder on first start (worse quality but works fully offline).

```bash
docker build --build-arg HF_HUB_OFFLINE=1 -t my2ndbrain:latest .
```

## Configuration

All settings are **environment variables** on `docker run` (or in the
`environment:` block of `docker-compose.yml`). Defaults are baked
into the image so you can run with no flags if you only want the
default offline mode.

| Var | Default | Notes |
|-----|---------|-------|
| `DB_USER` | `my2ndbrain` | Postgres role the backend connects as |
| `DB_PASSWORD` | `my2ndbrain` | **Set this for any real deployment.** The default is local-only. |
| `DB_NAME` | `my2ndbrain` | Postgres database |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | 384-dim, ~90MB, English-leaning |
| `EMBED_DEVICE` | `cpu` | `cuda` if you have a GPU |
| `LLM_PROVIDER` | `heuristic` | `openai` / `minimax` / `kimi` / `qwen` / `gemini` / `deepseek` / `ollama` |
| `LLM_MODEL` | (vendor default) | e.g. `MiniMax-M3` |
| `OPENAI_API_KEY` | (empty) | Used for any OpenAI-compat provider (`openai` / `minimax` / `kimi` / etc.) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Only matters if `LLM_PROVIDER=ollama` |

You can also set the LLM provider and key from the Settings tab inside
the app — those are stored in process memory and **don't** persist
across container restarts. To make them survive, set them via env
on `docker run`.

## Exposing to the network

The backend binds to `0.0.0.0:8000` inside the container. Map
port 8000 to whatever host port you want:

```bash
docker run -d -p 9000:8000 -v my2ndbrain-data:/var/lib/postgresql/data my2ndbrain:latest
```

Then `http://<host>:9000/` is your second brain, reachable from any
machine that can reach the host. The frontend uses **relative**
URLs for all API calls, so it works from any origin.

## What's inside the image

- **debian:bookworm** — base OS
- **postgresql-16 + postgresql-16-pgvector** — the database, runs
  on `127.0.0.1:5432` inside the container (not exposed)
- **python:3.12-bookworm venv** — the backend deps (`fastapi`,
  `uvicorn`, `sqlalchemy`, `psycopg2-binary`, `pgvector`, `numpy`,
  `scikit-learn`, `httpx`)
- **pre-built React frontend** — served by FastAPI's
  `StaticFiles` mount at `/`
- **`docker-entrypoint.sh`** — boots Postgres, creates the role +
  database, installs the pgvector extension, then execs uvicorn

## Architecture

```
┌─────────────────────────────────────────┐
│ Container: my2ndbrain                   │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ Postgres 16 + pgvector            │ │
│  │ 127.0.0.1:5432 (in-container)     │ │
│  │ /var/lib/postgresql/data (volume)  │ │
│  └──────────────┬─────────────────────┘ │
│                 │ TCP localhost         │
│  ┌──────────────▼─────────────────────┐ │
│  │ FastAPI (uvicorn)                 │ │
│  │ 0.0.0.0:8000                      │ │
│  │ - serves React build at /         │ │
│  │ - serves /api/* endpoints         │ │
│  │ - reads .env / env vars            │ │
│  └────────────────────────────────────┘ │
│                 ▲                         │
│                 │ /api/* (relative)       │
│  ┌──────────────┴─────────────────────┐ │
│  │ Browser (your machine)            │ │
│  │ http://<docker-host>:8000/         │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Data persistence

The **only** persistent state is `/var/lib/postgresql/data` (mounted
to a named volume `my2ndbrain-data`). This includes:
- Your knowledge graph (nodes + edges)
- Your drafts
- Your cluster assignments
- Your skills
- Your conversation history in the AI Assistant

Everything else (Python venv, React build, embedding model) is
baked into the image and rebuilt on every `docker build`.

To **migrate** to a new host: stop the old container, copy
`my2ndbrain-data` volume to the new host, run the new image with
the same `-v my2ndbrain-data:/var/lib/postgresql/data` flag, and
the data is preserved.

## Troubleshooting

### `docker build` hangs on metadata fetch

Your network can't reach Docker Hub. Use a mirror, or pull the base
images once on a machine that *can* reach Docker Hub and then load
them with `docker load -i`. Or pre-pull:

```bash
docker pull python:3.12-bookworm
docker pull node:20-bookworm
docker pull debian:bookworm
docker build -t my2ndbrain:latest .
```

### First start is slow (1-2 min)

The `CREATE EXTENSION vector` + initial embedding-model download (if
not skipped) take time. Watch `docker logs -f my2ndbrain` — you'll
see "postgres is up", then the FastAPI startup log, then "Application
startup complete." Once that's done, every subsequent request is fast.

### `/api/health` returns 500

Check the logs: `docker logs my2ndbrain | tail -50`. Most common
cause is a permissions issue on the mounted volume (the entrypoint
chowns it, but if you mount over an existing dir with different
ownership, it can break). Fix: `docker volume rm my2ndbrain-data`
and re-run.

### Frontend shows `❌ Connection refused` on API calls

You're accessing the app from a different origin than the backend
expects. The frontend uses **relative** API paths (`/api/...`) so
this should never happen — but if you have a corporate proxy or
custom domain in front, make sure it forwards `/api/*` to the
backend, not to an external service.

## Development vs Docker

The `start.sh` script (in the repo root) still works for local
development outside Docker — it expects a system-installed
PostgreSQL. The Docker image is the **deployment** path; `start.sh`
is the **dev** path. They share the same `.env` file format and
the same backend code, so config translates 1:1.

For local dev:

```bash
./start.sh start    # backend + frontend dev servers
./start.sh stop
./start.sh status
```
