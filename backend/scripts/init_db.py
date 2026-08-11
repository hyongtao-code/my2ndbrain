"""Create the pgvector extension and all tables. Idempotent."""
from app.core.logging import setup_logging
from app.db.session import engine, Base
# Import all models so SQLAlchemy registers them
from app.models.knowledge import KnowledgeNode, KnowledgeEdge, CategoryCluster, AISkill  # noqa: F401
from sqlalchemy import text


def main() -> None:
    setup_logging()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    print("✅ schema ready at", engine.url.render_as_string(hide_password=True))


if __name__ == "__main__":
    main()