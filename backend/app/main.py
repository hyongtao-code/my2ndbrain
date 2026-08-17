"""FastAPI app entrypoint."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core.logging import setup_logging
from app.api.nodes import router as nodes_router
from app.api.graph import router as graph_router
from app.api.assistant import (
    clusters_router, assistant_router, skills_router,
)

from app.api.drafts import router as drafts_router
from app.services.embedding import report_backend

setup_logging()

# Auto-create any missing tables (idempotent; safe to run on every start).
from app.db.session import Base, engine
from sqlalchemy import text
with engine.begin() as conn:
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
Base.metadata.create_all(bind=engine)
app = FastAPI(title="MySecondBrain", version="0.1.0", description="AI 第二大脑")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "embedding_backend": report_backend(),
    }


app.include_router(nodes_router)
app.include_router(graph_router)
app.include_router(clusters_router)
app.include_router(assistant_router)
app.include_router(skills_router)
app.include_router(drafts_router)


# ----- static frontend (Vite build output) -----
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    @app.get("/")
    def _no_frontend():
        return {
            "message": "frontend not built yet. run `cd frontend && npm run build`, "
                       "or use Vite dev server on :5173 with VITE_API_BASE.",
            "api_docs": "/docs",
        }