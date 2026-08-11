"""/api/graph — payload for the 3D sphere UI."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.knowledge import build_graph_payload


router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
def graph(
    category: str | None = Query(
        default=None,
        description="If set, restrict the payload to nodes in this category. "
                    "Edges between filtered and unfiltered nodes are dropped.",
    ),
    db: Session = Depends(get_db),
):
    return build_graph_payload(db, category=category)