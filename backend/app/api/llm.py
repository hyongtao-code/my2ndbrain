"""/api/llm — manage LLM provider + key, and suggest improvements."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.knowledge import KnowledgeEdge, KnowledgeNode
from app.services.llm import (
    PROVIDERS,
    clear_runtime_overrides,
    complete,
    resolve_provider,
    set_runtime_override,
    test_connection,
)

router = APIRouter(prefix="/api/llm", tags=["llm"])


# ---------- schema ----------

class LLMConfigIn(BaseModel):
    provider: str = Field(
        default="heuristic",
        pattern="^(heuristic|openai|ollama|deepseek|kimi|qwen|minimax|gemini)$",
    )
    api_key: str = Field(default="")
    model: str = Field(default="gpt-4o-mini")


# ---------- status ----------

@router.get("/status")
def status():
    """Return the active LLM configuration (no key echoed).

    Also surfaces the full provider registry so the frontend can build
    the provider dropdown without hard-coding it.
    """
    cfg = resolve_provider()
    return {
        "provider": cfg["provider"],
        "provider_label": cfg["provider_label"],
        "provider_kind": cfg["provider_kind"],
        "base_url": cfg["base_url"],
        "model": cfg["model"],
        "has_api_key": cfg["has_api_key"],
        "api_key_source": cfg["api_key_source"],
        "providers": [
            {
                "name": name,
                "label": meta["label"],
                "default_model": meta["default_model"],
                "needs_api_key": meta["needs_api_key"],
                "api_key_label": meta["api_key_label"],
                "kind": meta["kind"],
            }
            for name, meta in PROVIDERS.items()
        ],
    }


@router.post("/config")
def set_config(payload: LLMConfigIn):
    """Apply a runtime LLM config. Restart-safe: in-memory only."""
    set_runtime_override("llm_provider", payload.provider)
    if payload.api_key:
        set_runtime_override("openai_api_key", payload.api_key)
    if payload.model:
        set_runtime_override("llm_model", payload.model)
    return status()


@router.post("/clear")
def clear_config():
    clear_runtime_overrides()
    return status()


class LLMSuggestIn(BaseModel):
    """Optional override so the Settings tab can probe the values the
    user has typed in the form (provider/api_key/model) before they
    have clicked Save. The backend runtime override is not consulted
    when this payload is sent."""
    provider: str | None = None
    api_key: str | None = None
    model: str | None = None


@router.post("/test")
def test(payload: LLMSuggestIn | None = None):
    """Probe the configured provider with a tiny request and report
    whether the endpoint + key actually work. The frontend uses the
    returned ok + detail to drive the connection status light.

    If the body carries provider/api_key/model fields, those values are
    used instead of the backend runtime override. This lets the user
    click Test before clicking Save and still see a real probe of
    what they just typed in.
    """
    override: dict[str, str] = {}
    if payload:
        if payload.provider: override["llm_provider"] = payload.provider
        if payload.api_key:  override["openai_api_key"] = payload.api_key
        if payload.model:     override["llm_model"]    = payload.model
    return test_connection(override=override or None)


# ---------- suggest improvements ----------

SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["link", "merge", "split", "noop"]},
        "rationale": {"type": "string"},
        "nodes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["action", "rationale", "nodes"],
}


@router.post("/suggest-improvements")
def suggest_improvements(db: Session = Depends(get_db)):
    """Ask the active LLM for ONE concrete improvement suggestion.

    Looks at the current graph (up to 50 nodes, top 20 edges) and asks
    the LLM which two nodes should be linked, merged, or split. Falls
    back to a heuristic if no LLM is configured.
    """
    cfg = resolve_provider()
    # Build a compact representation of the graph
    nodes = list(db.scalars(select(KnowledgeNode).limit(50)).all())
    edges = list(db.scalars(select(KnowledgeEdge).limit(20)).all())

    if not nodes:
        return {
            "action": "noop",
            "rationale": "graph is empty — add some knowledge first.",
            "nodes": [],
            "provider": cfg["provider"],
        }

    # Build the prompt
    n_lines = []
    for n in nodes[:50]:
        kw = getattr(n, "keywords", None) or []
        kwstr = ", ".join(kw)[:80]
        n_lines.append(f"- id={n.id} title={n.title!r} category={n.category!r} keywords={kwstr}")
    e_lines = []
    for e in edges[:20]:
        sim = float(getattr(e, "similarity_score", 0) or 0)
        rt = getattr(e, "relation_type", "related") or "related"
        e_lines.append(f"- {e.source_node_id} --{rt}--> {e.target_node_id} (sim={sim:.2f})")
    prompt = (
        "You have a personal knowledge graph with the following nodes and edges.\n"
        "Suggest EXACTLY ONE improvement. Pick one of:\n"
        "  - 'link': two nodes that should be connected (give both ids).\n"
        "  - 'merge': two nodes that describe the same concept (give both ids).\n"
        "  - 'split': one node that covers two different concepts (give its id).\n"
        "  - 'noop': nothing to improve at this time.\n"
        "Be conservative: only suggest when you are genuinely confident.\n\n"
        "Nodes:\n" + "\n".join(n_lines) + "\n\n"
        "Existing edges:\n" + ("\n".join(e_lines) if e_lines else "(none)") + "\n\n"
        "Output JSON: {\"action\": \"link|merge|split|noop\", \"rationale\": \"one short sentence\", \"nodes\": [\"id1\", \"id2\"]}"
    )

    raw = complete(prompt, json_schema=SUGGEST_SCHEMA)
    # Fall back to a heuristic pick if the LLM returned noop with no real reason
    if raw.get("action") == "noop" and "heuristic fallback" in (raw.get("rationale") or "").lower():
        # Pick the top non-linked pair by embedding similarity
        nodes_with_emb = [n for n in nodes if n.embedding is not None]
        if len(nodes_with_emb) < 2:
            return {**raw, "provider": cfg["provider"]}
        # Just compute the top pair
        import numpy as np
        # Re-normalize all
        matrix = np.array([list(n.embedding) for n in nodes_with_emb], dtype="float32")
        matrix = matrix / np.linalg.norm(matrix, axis=1, keepdims=True)
        # Take top 5 popular nodes (importance desc) and find best pair
        nodes_with_emb.sort(key=lambda n: -float(getattr(n, "importance", 0) or 0))
        sample = nodes_with_emb[:8]
        best = None
        for i in range(len(sample)):
            for j in range(i + 1, len(sample)):
                a, b = sample[i], sample[j]
                # Check they're not already linked
                linked = any(
                    (e.source_node_id == a.id and e.target_node_id == b.id) or
                    (e.source_node_id == b.id and e.target_node_id == a.id)
                    for e in edges
                )
                if linked:
                    continue
                # Cosine similarity
                vi = np.array(list(a.embedding), dtype="float32")
                vj = np.array(list(b.embedding), dtype="float32")
                sim = float(np.dot(vi, vj) / (np.linalg.norm(vi) * np.linalg.norm(vj) + 1e-9))
                if best is None or sim > best["sim"]:
                    best = {"a": a, "b": b, "sim": sim}
        if best and best["sim"] > 0.40:
            return {
                "action": "link",
                "rationale": f"high similarity ({best['sim']:.2f}) but not yet linked",
                "nodes": [str(best["a"].id), str(best["b"].id)],
                "similarity": best["sim"],
                "provider": "heuristic",
            }
        return {**raw, "provider": cfg["provider"]}

    return {**raw, "provider": cfg["provider"]}


@router.post("/link")
def link_two_nodes(
    source_id: str,
    target_id: str,
    relation: str = "related",
    db: Session = Depends(get_db),
):
    """Manually create an edge between two nodes (idempotent — if the
    edge already exists, just return it).

    This is the /api/llm/link endpoint that the NodeDetail 'add relation'
    UI button hits.
    """
    from uuid import UUID
    try:
        sid = UUID(source_id)
        tid = UUID(target_id)
    except ValueError:
        raise HTTPException(400, "invalid uuid")
    if sid == tid:
        raise HTTPException(400, "source and target must differ")
    src = db.get(KnowledgeNode, sid)
    tgt = db.get(KnowledgeNode, tid)
    if not src or not tgt:
        raise HTTPException(404, "node not found")
    # Idempotent: check for existing edge
    existing = next(
        (e for e in (getattr(src, "edges_from", []) or []) if e.target_node_id == tid),
        None,
    )
    if existing:
        return {
            "id": str(existing.id),
            "source": str(existing.source_node_id),
            "target": str(existing.target_node_id),
            "relation_type": existing.relation_type,
            "similarity_score": float(existing.similarity_score or 0.0),
            "already_existed": True,
        }
    edge = KnowledgeEdge(
        source_node_id=sid,
        target_node_id=tid,
        relation_type=relation,
        similarity_score=1.0,
        auto_generated=0,  # 0 = manual
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return {
        "id": str(edge.id),
        "source": str(edge.source_node_id),
        "target": str(edge.target_node_id),
        "relation_type": edge.relation_type,
        "similarity_score": float(edge.similarity_score or 0.0),
        "already_existed": False,
    }


@router.post("/unlink")
def unlink_two_nodes(
    source_id: str,
    target_id: str,
    db: Session = Depends(get_db),
):
    """Remove an edge between two nodes (idempotent — if no edge
    exists in either direction, just return deleted=0).

    The original implementation only looked at the directed edge
    source → target, but the NodeDetail UI shows neighbors from
    BOTH edges_from and edges_to, so when the user clicks the
    "remove link" button on a row whose underlying edge actually
    points the OTHER way, the request was silently a no-op. Now
    we accept the (source_id, target_id) pair as an UNORDERED set
    of node ids and delete whichever directed edge exists between
    them (there can be at most one in the current schema, since
    the /link endpoint is also idempotent — see link_two_nodes).

    This is the /api/llm/unlink endpoint that the NodeDetail
    neighbor-row "remove" UI button hits.
    """
    from uuid import UUID
    try:
        sid = UUID(source_id)
        tid = UUID(target_id)
    except ValueError:
        raise HTTPException(400, "invalid uuid")
    if sid == tid:
        raise HTTPException(400, "source and target must differ")
    # The two ids are unordered — the edge can be either direction.
    # Look in both sets; the first hit is the one to delete.
    src_node = db.get(KnowledgeNode, sid)
    if src_node:
        edge = next(
            (
                e for e in (getattr(src_node, "edges_from", []) or [])
                if e.target_node_id == tid
            ),
            None,
        )
        if edge:
            edge_id = str(edge.id)
            db.delete(edge)
            db.commit()
            return {"deleted": 1,
                    "source": source_id, "target": target_id,
                    "edge_id": edge_id,
                    "direction": "forward",
                    "already_absent": False}
    tgt_node = db.get(KnowledgeNode, tid)
    if tgt_node:
        edge = next(
            (
                e for e in (getattr(tgt_node, "edges_from", []) or [])
                if e.target_node_id == sid
            ),
            None,
        )
        if edge:
            edge_id = str(edge.id)
            db.delete(edge)
            db.commit()
            return {"deleted": 1,
                    "source": source_id, "target": target_id,
                    "edge_id": edge_id,
                    "direction": "reverse",
                    "already_absent": False}
    return {"deleted": 0,
            "source": source_id, "target": target_id,
            "already_absent": True}