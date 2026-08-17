"""/api/drafts — transient inbox for raw ideas before curation."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.knowledge import KnowledgeDraft
from app.schemas import DraftCreate, DraftUpdate, PromoteRequest, PromoteResponse
from app.services.knowledge import (
    create_draft, list_drafts, get_draft, update_draft, delete_draft,
    promote_drafts,
)


router = APIRouter(prefix="/api/drafts", tags=["drafts"])


@router.get("", response_model=list[dict])
def list_all(
    include_promoted: bool = Query(default=False, description="Include drafts already promoted to a node"),
    limit: int = Query(default=500, le=2000),
    db: Session = Depends(get_db),
):
    """List drafts newest-first, pinned at top."""
    return [d.to_dict() for d in list_drafts(db, include_promoted=include_promoted, limit=limit)]


@router.post("", response_model=dict)
def create(payload: DraftCreate, db: Session = Depends(get_db)):
    """Add a new draft (cheap, no embedding, no category)."""
    d = create_draft(db, content=payload.content, source=payload.source, pinned=payload.pinned)
    return d.to_dict()


@router.get("/{draft_id}", response_model=dict)
def read(draft_id: str, db: Session = Depends(get_db)):
    d = get_draft(db, draft_id)
    if not d:
        from fastapi import HTTPException
        raise HTTPException(404, "draft not found")
    return d.to_dict()


@router.patch("/{draft_id}", response_model=dict)
def update(draft_id: str, payload: DraftUpdate, db: Session = Depends(get_db)):
    d = update_draft(db, draft_id, content=payload.content, pinned=payload.pinned)
    if not d:
        from fastapi import HTTPException
        raise HTTPException(404, "draft not found")
    return d.to_dict()


@router.delete("/{draft_id}")
def remove(draft_id: str, db: Session = Depends(get_db)):
    ok = delete_draft(db, draft_id)
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(404, "draft not found")
    return {"deleted": draft_id}


@router.post("/promote", response_model=PromoteResponse)
def promote(payload: PromoteRequest, db: Session = Depends(get_db)):
    """Promote one or more drafts through the AI ingest pipeline.

    Per-group behaviour:
      - One draft => one node.
      - Several short drafts created within 60s of each other => merged
        into a single node (auto-merged content; user's currently-selected
        pinned order is preserved).
      - Drafts flagged as promoted get a promoted_to_node_id pointer so
        they stay visible in the inbox with a "已固化" hint.
    """
    result = promote_drafts(
        db,
        draft_ids=payload.draft_ids,
        body_override=payload.body_override,
        importance=payload.importance,
        auto_link=payload.auto_link,
    )
    return result
