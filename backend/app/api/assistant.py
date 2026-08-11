"""/api/clusters + /api/assistant + /api/skills"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.knowledge import CategoryCluster, AISkill
from app.services.knowledge import (
    recompute_clusters, assistant_answer, generate_skill, organise_knowledge,
)


clusters_router = APIRouter(prefix="/api/clusters", tags=["clusters"])
assistant_router = APIRouter(prefix="/api/assistant", tags=["assistant"])
skills_router = APIRouter(prefix="/api/skills", tags=["skills"])


# -------- clusters --------

@clusters_router.get("")
def list_clusters(db: Session = Depends(get_db)):
    return [c.to_dict() for c in db.scalars(select(CategoryCluster)).all()]


@clusters_router.post("/recompute")
def recompute(db: Session = Depends(get_db)):
    n = recompute_clusters(db)
    return {"recomputed": n}


# -------- assistant --------

@assistant_router.post("")
def ask(payload: dict, db: Session = Depends(get_db)):
    question = (payload.get("question") or "").strip()
    if not question:
        return {"answer": "请输入你的问题", "related_nodes": [], "blind_spots": {"missing": []}}
    res = assistant_answer(db, question, top_k=int(payload.get("top_k", 8)))
    return res


@assistant_router.post("/organise")
def organise(payload: dict, db: Session = Depends(get_db)):
    topic = (payload.get("topic") or "").strip() or None
    return organise_knowledge(db, topic=topic)


# -------- skills --------

@skills_router.get("")
def list_skills(db: Session = Depends(get_db)):
    return [s.to_dict() for s in db.scalars(select(AISkill).order_by(AISkill.created_at.desc())).all()]


@skills_router.post("/generate")
def gen_skill(payload: dict, db: Session = Depends(get_db)):
    focus = (payload.get("focus") or "").strip() or None
    return generate_skill(db, focus=focus)


@skills_router.delete("/{skill_id}")
def drop_skill(skill_id: str, db: Session = Depends(get_db)):
    import uuid
    s = db.get(AISkill, uuid.UUID(skill_id)) if _is_uuid(skill_id) else None
    if not s:
        return {"deleted": False}
    db.delete(s)
    db.commit()
    return {"deleted": skill_id}


def _is_uuid(s: str) -> bool:
    try:
        import uuid as _u
        _u.UUID(s)
        return True
    except Exception:
        return False