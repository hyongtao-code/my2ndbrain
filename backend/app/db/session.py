"""SQLAlchemy engine + session factory."""
from pgvector.psycopg2 import register_vector
from pgvector.sqlalchemy import Vector  # re-exported for ORM models
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=False,
)


# pgvector: register vector type on every new DBAPI connection so psycopg2
# knows how to serialise Python lists into the `vector` SQL type automatically.
@event.listens_for(engine, "connect")
def _on_connect(dbapi_connection, _):
    register_vector(dbapi_connection)


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
Base = declarative_base()

# Re-export Vector so models don't need to import pgvector directly
__all__ = ["Base", "Session", "SessionLocal", "Vector", "engine", "get_db"]


def get_db():
    """FastAPI dependency: yields a Session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()