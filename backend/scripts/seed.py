"""Seed MySecondBrain with a small starter knowledge base so first-run
users see something meaningful in the 3D sphere right away.

The default seeds here are deliberately domain-neutral (general CS / thinking
tools). Replace with your own notes to make the brain yours.

Idempotent: skips nodes whose title already exists.
"""
from app.core.logging import setup_logging
from app.db.session import SessionLocal
from app.models.knowledge import KnowledgeNode
from app.services.knowledge import ingest_node


# Each tuple: (title, content, category, importance)
# Keep these short — they're just demonstration nodes to prove the system
# works. Replace with anything that matches your own learning.
SEED = [
    ("FastAPI",        "Modern async Python web framework. Type-hinted, fast, auto OpenAPI docs.",                          "编程开发", 1.0),
    ("PostgreSQL",     "Advanced open-source relational database. JSONB, FTS, pgvector for vector search.",                "编程开发", 1.0),
    ("pgvector",       "PostgreSQL extension for vector similarity search. Supports cosine / L2 / inner-product distances.","编程开发", 1.0),
    ("React",          "Component-based UI library. JSX + hooks + a virtual DOM.",                                          "编程开发", 1.0),
    ("3D Knowledge Sphere",
                       "Place knowledge nodes on the surface of a sphere. Related nodes share a colour and cluster visually.",
                       "思维方式", 1.5),
    ("Zettelkasten",   "Slip-box note-taking method: one idea per note, linked by references.",                            "思维方式", 1.5),
    ("番茄工作法",     "25-minute focused work blocks with short breaks.",                                                "生活方式", 0.5),
]


def main() -> None:
    setup_logging()
    with SessionLocal() as db:
        existing_titles = {t for (t,) in db.query(KnowledgeNode.title).all()}
        added = 0
        for title, body, category, importance in SEED:
            if title in existing_titles:
                continue
            ingest_node(db, title=title, content=body, category=category,
                        importance=importance, auto_link=True)
            added += 1
            print(f"  + {title}")
        print(f"\nseeded {added} new nodes (skipped {len(SEED) - added} existing)")


if __name__ == "__main__":
    main()