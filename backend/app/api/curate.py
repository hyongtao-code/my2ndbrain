"""LLM-powered knowledge-graph curation features (Step 2 of the
chat-LLM roadmap). Exposed via /api/llm/curate/* endpoints.

All endpoints use the active LLM (MiniMax-M3 by default). When the
LLM is the local heuristic, every call returns a structured
fallback so the UI can still render something useful.

Three endpoints:

  POST /api/llm/curate/clean-draft
      body: {"draft_id": "<uuid>"}
      Picks the user's draft, asks the LLM to produce ONE polished
      KnowledgeNode (title / content / category / keywords). Returns
      {title, content, category, keywords, rationale}. The user
      can then confirm and we ingest it.

  POST /api/llm/curate/find-merges
      body: {"limit": 10, "sample_strategy": "popular"|"random"|"oldest"}
      Samples ~10 nodes from the graph, asks the LLM which pair is
      a clear duplicate / merger candidate. Returns a single
      suggestion {action, rationale, nodes: [id1, id2]}.

  POST /api/llm/curate/find-edges
      body: {"limit": 10, "sample_strategy": "popular"|"random"|"oldest"}
      Samples ~10 nodes from a single category, asks the LLM which
      new edges would make sense (citing nodes by id). Returns up
      to 3 edge suggestions.

Design notes:
  - We never call DELETE on user data. All endpoints only READ and
    return suggestions. The UI then asks for explicit confirmation
    before any write happens (via the existing POST /api/nodes
    ingest path or POST /api/llm/link).
  - Sampling is done with deterministic randomness (sort by a
    hash of (id, day)) so the user sees different suggestions on
    different days but the same suggestion across a session if
    they re-click.
"""
from __future__ import annotations

import json
import re
import secrets
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.knowledge import KnowledgeDraft, KnowledgeEdge, KnowledgeNode
from app.services.embedding import embed_texts
from app.services.llm import complete, complete_chat, resolve_provider

router = APIRouter(prefix="/api/llm/curate", tags=["llm-curate"])


# --------- shared helpers ---------

def _heuristic_fallback_suggest(action: str, rationale: str = "未配置大模型，使用本地 heuristic") -> dict:
    """A deterministic fallback when no LLM is configured."""
    return {
        "provider": "heuristic",
        "action": action,
        "rationale": rationale,
        "nodes": [],
    }


def _node_card(n: KnowledgeNode) -> str:
    """One-line summary used inside prompts."""
    title = (n.title or "").replace("\n", " ")[:80]
    cat = n.category or "(no category)"
    kw = ", ".join((n.keywords or [])[:8])
    return f"- id={n.id} | title={title!r} | category={cat!r} | keywords={kw}"


def _sample_nodes(db: Session, limit: int, strategy: str) -> list[KnowledgeNode]:
    """Pick up to `limit` nodes deterministically but rotating over
    a salt so each call gives a fresh sample.

    We avoid Python's `random` here so that tests / audit logs are
    reproducible for a given salt.
    """
    salt = secrets.token_hex(2)  # 4 hex chars; varies per request
    # Cast to a deterministic ordering key that depends on salt.
    nodes = list(db.scalars(select(KnowledgeNode)).all())
    if not nodes:
        return []
    if strategy == "popular":
        nodes.sort(key=lambda n: -float(getattr(n, "importance", 0) or 0))
    elif strategy == "oldest":
        nodes.sort(key=lambda n: getattr(n, "created_at", None) or "")
    else:  # random
        # Stable per-salt hash-based sort
        nodes.sort(key=lambda n: hash((salt, str(n.id))))

    # If we have more than `limit` nodes, take a sliding window that
    # depends on the salt so different calls return different
    # subsets.
    if len(nodes) <= limit:
        return nodes
    span = len(nodes) - limit
    offset = (int(salt, 16) % (span + 1)) if span > 0 else 0
    return nodes[offset : offset + limit]


def _sample_same_category(db: Session, category: str, limit: int, salt: str) -> list[KnowledgeNode]:
    """Pick up to `limit` nodes from a single category."""
    nodes = list(
        db.scalars(
            select(KnowledgeNode).where(KnowledgeNode.category == category).limit(200)
        ).all()
    )
    if len(nodes) <= limit:
        return nodes
    nodes.sort(key=lambda n: hash((salt, str(n.id))))
    span = len(nodes) - limit
    offset = (int(salt, 16) % (span + 1)) if span > 0 else 0
    return nodes[offset : offset + limit]


def _pick_popular_category(db: Session) -> str | None:
    """Pick the category with the most nodes (for find-edges seeding)."""
    nodes = list(db.scalars(select(KnowledgeNode.category)).all())
    counts: dict[str, int] = {}
    for n in nodes:
        c = n or ""
        counts[c] = counts.get(c, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


# --------- shared prompt helpers ---------

PROMPT_SYSTEM_NOTE = (
    "You are an AI curator for a personal knowledge graph. "
    "Output strict JSON only — no prose, no markdown fences."
)


def _extract_json(text: str) -> dict | None:
    """Best-effort JSON extractor for sloppy model output."""
    text = text.strip()
    text = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)
    text = re.sub(r"^\s*```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*\Z", "", text)
    # Try direct
    try:
        return json.loads(text)
    except Exception:
        pass
    # Try to find the first {...} block
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


# --------- POST /clean-draft ---------

class CleanDraftIn(BaseModel):
    draft_id: str


@router.post("/clean-draft")
def curate_clean_draft(payload: CleanDraftIn, db: Session = Depends(get_db)):
    """Take a single draft and ask the LLM to produce ONE polished
    node (title / content / category / keywords).
    """
    try:
        import uuid as _u
        did = _u.UUID(payload.draft_id)
    except ValueError:
        raise HTTPException(400, "invalid draft_id")
    draft = db.get(KnowledgeDraft, did)
    if not draft:
        raise HTTPException(404, "draft not found")

    raw = (draft.content or "").strip()
    if not raw:
        raise HTTPException(400, "draft is empty")

    prompt = (
        f"以下是用户的一条草稿笔记:\n\n"
        f"--- BEGIN DRAFT ---\n{raw}\n--- END DRAFT ---\n\n"
        "请你把它整理成一条正式的知识节点。要求:\n"
        "  - title: 短而精炼 (≤ 30 个字符), 直接说核心概念\n"
        "  - content: 把草稿整理成 Markdown (加适当的标题/列表/链接); "
        "如果草稿只是几个字, 就在 content 里把它展开成结构化说明, "
        "不要凭空编造未在草稿中出现的具体事实.\n"
        "  - category: 一个分类标签 (尽量复用已有分类, 否则起个新名)\n"
        "  - keywords: 3-6 个核心关键词数组\n"
        "  - rationale: 一句话告诉用户你做了什么整理 (例如 '把草稿中的 3 点 bullet 整理成了 ...')\n\n"
        "返回严格 JSON, 不要 markdown 围栏:\n"
        "{\n"
        '  "title": "...",\n'
        '  "content": "...",\n'
        '  "category": "...",\n'
        '  "keywords": ["...", "..."],\n'
        '  "rationale": "..."\n'
        "}"
    )

    cfg = resolve_provider()
    if cfg["provider"] == "heuristic":
        # Local fallback: pick the first non-empty line as title and
        # treat everything else as content.
        lines = [l for l in raw.splitlines() if l.strip()]
        title = (lines[0][:30] if lines else "(untitled)").strip()
        # naive category: leave blank so the heuristic classifier kicks in
        return {
            "provider": "heuristic",
            "title": title,
            "content": raw,
            "category": "",
            "keywords": [],
            "rationale": "未配置大模型；只取了草稿第一行做标题",
        }

    raw_resp = complete_chat(prompt, system=PROMPT_SYSTEM_NOTE)
    parsed = _extract_json(raw_resp)
    if not parsed:
        raise HTTPException(502, f"LLM returned non-JSON: {raw_resp[:200]}")
    return {
        "provider": cfg["provider"],
        "title": (parsed.get("title") or "").strip()[:200] or "(untitled)",
        "content": (parsed.get("content") or raw).strip(),
        "category": (parsed.get("category") or "").strip(),
        "keywords": parsed.get("keywords") or [],
        "rationale": (parsed.get("rationale") or "").strip(),
    }


# --------- POST /find-merges ---------

class FindMergesIn(BaseModel):
    limit: int = 10
    sample_strategy: str = "random"  # popular | random | oldest


@router.post("/find-merges")
def curate_find_merges(payload: FindMergesIn, db: Session = Depends(get_db)):
    """Sample ~limit nodes and ask the LLM which TWO should be merged.

    Returns a single suggestion:
        {action: 'merge', rationale: '...', nodes: [id1, id2]}
    or {action: 'noop', rationale: 'no clear merge candidate', nodes: []}.
    """
    nodes = _sample_nodes(db, payload.limit, payload.sample_strategy)
    if len(nodes) < 2:
        return {
            "provider": "heuristic",
            "action": "noop",
            "rationale": "graph has fewer than 2 nodes — add more first",
            "nodes": [],
        }

    lines = "\n".join(_node_card(n) for n in nodes)

    prompt = (
        f"以下是用户知识图谱里随机抽出的 {len(nodes)} 个节点:\n\n"
        f"{lines}\n\n"
        "请仔细比对, 找出这组里最像应该被合并 (merge)) 的两个节点 — "
        "也就是说, 它们描述的是同一个概念, 只是用了不同的标题/措辞.\n\n"
        "返回严格 JSON:\n"
        "{\n"
        '  "action": "merge" | "noop",\n'
        '  "rationale": "一句话解释为什么应该合并 (或为什么不应该)",\n'
        '  "nodes": ["<id1>", "<id2>"]\n'
        "}\n"
        "如果你没有把握, 返回 {\"action\": \"noop\", \"rationale\": \"...\", \"nodes\": []} — "
        "宁可漏报也不要乱合并."
    )

    cfg = resolve_provider()
    if cfg["provider"] == "heuristic":
        # Heuristic fallback: pick the two nodes with the highest
        # cosine similarity among the sample.
        try:
            import numpy as np
            from app.services.embedding import get_embedder
            emb = get_embedder()
            embs: list[list[float]] = []
            for n in nodes:
                emb_attr = getattr(n, "embedding", None)
                embs.append(list(emb_attr) if emb_attr is not None else [0.0])
            matrix = np.array(embs, dtype="float32")
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            matrix = matrix / np.clip(norms, 1e-9, None)
            sims = matrix @ matrix.T
            best = (0, 1, -1.0)
            for i in range(len(nodes)):
                for j in range(i + 1, len(nodes)):
                    if sims[i, j] > best[2]:
                        best = (i, j, float(sims[i, j]))
            if best[2] > 0.85:
                return {
                    "provider": "heuristic",
                    "action": "merge",
                    "rationale": f"embedding cosine similarity {best[2]:.2f} > 0.85",
                    "nodes": [str(nodes[best[0]].id), str(nodes[best[1]].id)],
                    "similarity": best[2],
                }
        except Exception:
            pass
        return _heuristic_fallback_suggest(
            "noop", rationale="heuristic 没有找到高相似度节点对 (阈值 0.85)"
        )

    raw_resp = complete_chat(prompt, system=PROMPT_SYSTEM_NOTE)
    parsed = _extract_json(raw_resp)
    if not parsed:
        return {
            "provider": cfg["provider"],
            "action": "noop",
            "rationale": f"LLM 返回非 JSON: {raw_resp[:120]}",
            "nodes": [],
        }
    # Validate IDs are real
    valid = {str(n.id) for n in nodes}
    ids = parsed.get("nodes") or []
    ids = [i for i in ids if i in valid]
    return {
        "provider": cfg["provider"],
        "action": parsed.get("action") or "noop",
        "rationale": (parsed.get("rationale") or "").strip(),
        "nodes": ids,
    }


# --------- POST /find-edges ---------

class FindEdgesIn(BaseModel):
    limit: int = 10
    sample_strategy: str = "random"


@router.post("/find-edges")
def curate_find_edges(payload: FindEdgesIn, db: Session = Depends(get_db)):
    """Sample ~limit nodes from ONE category and ask the LLM which
    pairs should be linked by an edge (relation type).

    Returns up to 3 suggestions:
        [{action: 'link', rationale, source: id1, target: id2, relation: 'related'}, ...]
    """
    cat = _pick_popular_category(db)
    if not cat:
        return {
            "provider": "heuristic",
            "category": None,
            "suggestions": [],
            "rationale": "graph is empty",
        }
    salt = secrets.token_hex(2)
    nodes = _sample_same_category(db, cat, payload.limit, salt)
    if len(nodes) < 2:
        return {
            "provider": "heuristic",
            "category": cat,
            "suggestions": [],
            "rationale": f"category {cat!r} has fewer than 2 nodes",
        }

    # Build a set of existing edges among these nodes so we don't
    # propose duplicate links.
    node_ids = {str(n.id) for n in nodes}
    edges = list(
        db.scalars(
            select(KnowledgeEdge).where(
                KnowledgeEdge.source_node_id.in_(list(node_ids))  # type: ignore[arg-type]
            )
        ).all()
    )
    existing_pairs = {
        (str(e.source_node_id), str(e.target_node_id))
        for e in edges
    } | {
        (str(e.target_node_id), str(e.source_node_id))
        for e in edges
    }

    lines = "\n".join(_node_card(n) for n in nodes)

    prompt = (
        f"以下是用户知识图谱中分类为 {cat!r} 的 {len(nodes)} 个节点:\n\n"
        f"{lines}\n\n"
        "请仔细比对, 找出这组里应该被连接的节点对 (新边)。最多返回 3 对。\n"
        "只返回**当前还没连接**的节点对。\n\n"
        "返回严格 JSON 数组 (每条边一个对象):\n"
        "[\n"
        '  {"source": "<id1>", "target": "<id2>", "relation": "related" | "causes" | "part_of" | "contradicts", "rationale": "..."},\n'
        "  ...\n"
        "]\n"
        "如果你不确定, 可以返回空数组 [] — 宁缺毋滥."
    )

    cfg = resolve_provider()
    if cfg["provider"] == "heuristic":
        # Heuristic fallback: use embedding similarity within this
        # category to propose top pairs.
        try:
            import numpy as np
            from app.services.embedding import get_embedder
            emb = get_embedder()
            embs: list[list[float]] = []
            for n in nodes:
                emb_attr = getattr(n, "embedding", None)
                embs.append(list(emb_attr) if emb_attr is not None else [0.0])
            matrix = np.array(embs, dtype="float32")
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            matrix = matrix / np.clip(norms, 1e-9, None)
            sims = matrix @ matrix.T
            pairs = []
            for i in range(len(nodes)):
                for j in range(i + 1, len(nodes)):
                    key = (str(nodes[i].id), str(nodes[j].id))
                    if key in existing_pairs or key[::-1] in existing_pairs:
                        continue
                    pairs.append((i, j, float(sims[i, j])))
            pairs.sort(key=lambda x: -x[2])
            top = pairs[:3]
            suggestions = [
                {
                    "source": str(nodes[i].id),
                    "target": str(nodes[j].id),
                    "relation": "related",
                    "rationale": f"embedding cosine {s:.2f} (within category {cat!r})",
                    "similarity": s,
                }
                for i, j, s in top
                if s > 0.40
            ]
            return {
                "provider": "heuristic",
                "category": cat,
                "suggestions": suggestions,
                "rationale": "embedding cosine top pairs (threshold 0.40)",
            }
        except Exception:
            pass
        return {
            "provider": "heuristic",
            "category": cat,
            "suggestions": [],
            "rationale": "未配置大模型；heuristic 也没有找到合适节点对",
        }

    raw_resp = complete_chat(prompt, system=PROMPT_SYSTEM_NOTE)
    parsed = _extract_json(raw_resp)
    if parsed is None:
        return {
            "provider": cfg["provider"],
            "category": cat,
            "suggestions": [],
            "rationale": f"LLM 返回非 JSON: {raw_resp[:120]}",
        }
    # Accept both list and dict-of-shape {suggestions: [...]}
    items = parsed if isinstance(parsed, list) else parsed.get("suggestions") or []
    cleaned = []
    for it in items:
        if not isinstance(it, dict):
            continue
        src = str(it.get("source") or "")
        tgt = str(it.get("target") or "")
        if src not in node_ids or tgt not in node_ids or src == tgt:
            continue
        key = (src, tgt)
        if key in existing_pairs or key[::-1] in existing_pairs:
            continue
        cleaned.append({
            "source": src,
            "target": tgt,
            "relation": it.get("relation") or "related",
            "rationale": (it.get("rationale") or "").strip(),
        })
    return {
        "provider": cfg["provider"],
        "category": cat,
        "suggestions": cleaned[:3],
    }


# --------- Step 3: retrieval-augmented Q&A ---------

class AskIn(BaseModel):
    question: str
    top_k: int = 8


def _retrieve_relevant_nodes(db: Session, question: str, top_k: int) -> list[dict]:
    """Embed the question, fetch nearest nodes, return as dicts."""
    qvec = embed_texts([question])[0].tolist()
    dist_col = KnowledgeNode.embedding.cosine_distance(qvec).label("dist")
    stmt = (
        select(KnowledgeNode, dist_col)
        .where(KnowledgeNode.embedding.is_not(None))
        .order_by("dist")
        .limit(top_k)
    )
    rows = db.execute(stmt).all()
    # Skip rows whose embedding is degenerate (zero-norm). These
    # are old test-residue nodes whose embedding never got
    # populated and produce NaN distances. They never help with
    # RAG anyway.
    import math
    def _is_finite(x: float) -> bool:
        return x is not None and not (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))
    rows = [(n, d) for (n, d) in rows if _is_finite(d)]
    out = []
    for n, dist in rows:
        # Sanitize NaN/inf to 0.0 (happens when a node's embedding
        # is the zero vector, which makes cosine distance
        # undefined). Without this the response crashes FastAPI's
        # json.dumps with "Out of range float values are not JSON
        # compliant: nan".
        try:
            sim = 1.0 - float(dist)
        except (TypeError, ValueError):
            sim = 0.0
        import math
        if not math.isfinite(sim):
            sim = 0.0
        out.append({
            "id": str(n.id),
            "title": n.title,
            "summary": n.summary or ((n.content[:160] + "…") if n.content else ""),
            "content": (n.content or "")[:800],
            "category": n.category or "",
            "keywords": n.keywords or [],
            "similarity": round(sim, 4),
        })
    return out


@router.post("/ask")
def curate_ask(payload: AskIn, db: Session = Depends(get_db)):
    """Retrieval-augmented Q&A: embed question → top-k nodes → LLM
    generates an answer grounded in those nodes."""
    q = (payload.question or "").strip()
    if not q:
        raise HTTPException(400, "question is empty")
    top_k = max(1, min(int(payload.top_k or 8), 20))
    related = _retrieve_relevant_nodes(db, q, top_k)

    cfg = resolve_provider()
    if cfg["provider"] == "heuristic":
        # Heuristic fallback: list the nodes with summaries.
        if not related:
            return {
                "provider": "heuristic",
                "answer": "你的第二大脑里还没有相关知识。先新建一些节点，系统就能帮你组织了。",
                "related_nodes": [],
                "used_nodes": [],
            }
        lines = [f"我找到 {len(related)} 条与你问题最相关的知识：\n"]
        for r in related:
            tag = f"【{r['category']}】" if r["category"] else ""
            lines.append(f"  • {tag}{r['title']} — {r['summary'][:80]}")
        return {
            "provider": "heuristic",
            "answer": "\n".join(lines),
            "related_nodes": related,
            "used_nodes": [r["id"] for r in related],
        }

    if not related:
        return {
            "provider": cfg["provider"],
            "answer": "你的第二大脑里还没有相关知识。先新建一些节点，系统就能帮你组织了。",
            "related_nodes": [],
            "used_nodes": [],
        }

    # Build the prompt with RAG context
    ctx_lines = []
    for i, r in enumerate(related, 1):
        ctx_lines.append(f"[{i}] id={r['id']} title={r['title']!r} category={r['category']!r}")
        if r["summary"]:
            ctx_lines.append(f"   summary: {r['summary']}")
        if r["content"]:
            ctx_lines.append(f"   content: {r['content']}")
    context = "\n".join(ctx_lines)

    system = (
        "You are an AI assistant for the user's personal knowledge graph. "
        "Answer the user's question using ONLY the notes provided below. "
        "Be concise, friendly, and cite which note you're drawing from by "
        "its [N] number when relevant. If the notes don't cover the question, "
        "say so explicitly and suggest what to add."
    )
    prompt = (
        f"用户问题:\n{q}\n\n"
        f"相关笔记 (按相似度排序):\n{context}\n\n"
        "请用中文回答, 引用笔记时用 [N] 标记。\n"
        "回答末尾追加一行 'USED:' 列出你引用过的笔记编号 (例如 'USED: [1] [3]')."
    )
    answer = complete_chat(prompt, system=system)

    # Extract which notes we used (best effort)
    used: list[str] = []
    m = re.search(r"USED:\s*(.*)", answer)
    if m:
        for tag in re.findall(r"\[(\d+)\]", m.group(1)):
            try:
                idx = int(tag) - 1
                if 0 <= idx < len(related):
                    used.append(related[idx]["id"])
            except ValueError:
                pass
    if not used:
        # Conservative default: assume all retrieved notes were used.
        used = [r["id"] for r in related[: min(3, len(related))]]

    return {
        "provider": cfg["provider"],
        "answer": answer,
        "related_nodes": related,
        "used_nodes": used,
    }