"""/api/nodes — knowledge node CRUD + ingest pipeline."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import IngestResponse, NodeCreate, NodeUpdate
from app.services.knowledge import (
    _node_to_dict,
    delete_node,
    get_node,
    ingest_node,
    list_nodes,
)

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("", response_model=list[dict])
def list_all_nodes(
    category: str | None = None,
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
):
    """List nodes (used by management UI / side panels)."""
    nodes = list_nodes(db, category=category, limit=limit)
    return [_node_to_dict(n) for n in nodes]


@router.post("", response_model=IngestResponse)
def create_node(payload: NodeCreate, db: Session = Depends(get_db)):
    """The main 'Add Bubble' endpoint: full AI pipeline."""
    res = ingest_node(
        db,
        title=payload.title,
        content=payload.content,
        category=payload.category,
        keywords=payload.keywords,
        importance=payload.importance,
        source=payload.source,
        auto_link=payload.auto_link,
    )
    return res


@router.get("/{node_id}", response_model=dict)
def read_node(node_id: str, db: Session = Depends(get_db)) -> dict:
    node = get_node(db, node_id)
    if not node:
        raise HTTPException(404, "node not found")
    d = _node_to_dict(node)
    # Neighbors from BOTH directions (edges_from and edges_to). If
    # a bidirectional pair exists (A→B AND B→A), dedup by target
    # id so the UI doesn't render the same neighbor twice with
    # different similarity scores. We keep the higher score.
    raw_neighbors = (
        [{"id": str(e.target_node_id),
          "score": float(e.similarity_score or 0.0),
          "relation": e.relation_type,
          "title": e.target.title if e.target else None}
         for e in node.edges_from]
        + [{"id": str(e.source_node_id),
            "score": float(e.similarity_score or 0.0),
            "relation": e.relation_type,
            "title": e.source.title if e.source else None}
           for e in node.edges_to]
    )
    by_id: dict[str, dict] = {}
    for nb in raw_neighbors:
        prev = by_id.get(nb["id"])
        if prev is None or nb["score"] > prev["score"]:
            by_id[nb["id"]] = nb
    d["neighbors"] = list(by_id.values())
    d["neighbor_count"] = len(d["neighbors"])
    return d


@router.patch("/{node_id}", response_model=dict)
def update_node(node_id: str, payload: NodeUpdate, db: Session = Depends(get_db)):
    from app.services.embedding import embed_texts
    node = get_node(db, node_id)
    if not node:
        raise HTTPException(404, "node not found")
    if payload.title is not None:
        node.title = payload.title
    if payload.content is not None:
        node.content = payload.content
    if payload.category is not None:
        node.category = payload.category
    if payload.keywords is not None:
        node.keywords = payload.keywords
    if payload.importance is not None:
        node.importance = payload.importance
    # re-embed if title or content changed
    if payload.title is not None or payload.content is not None:
        node.embedding = embed_texts([f"{node.title}\n{node.content}"])[0].tolist()
    db.commit()
    db.refresh(node)
    return _node_to_dict(node)


@router.delete("/{node_id}")
def remove_node(node_id: str, db: Session = Depends(get_db)):
    ok = delete_node(db, node_id)
    if not ok:
        raise HTTPException(404, "node not found")
    return {"deleted": node_id}