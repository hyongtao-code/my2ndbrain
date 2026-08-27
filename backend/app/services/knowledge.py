"""Core knowledge-graph operations.

This is where everything ties together: embedding ↔ DB ↔ LLM.
"""
from __future__ import annotations

import hashlib
import uuid
from collections import defaultdict
from collections.abc import Iterable

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.knowledge import (
    AISkill,
    CategoryCluster,
    KnowledgeDraft,
    KnowledgeEdge,
    KnowledgeNode,
)
from app.services.embedding import embed_texts
from app.services.llm import llm_call

settings = get_settings()


# =========================================================
# Node CRUD
# =========================================================

def _node_to_dict(node: KnowledgeNode) -> dict:
    d = node.to_dict()
    d["neighbor_count"] = len(node.edges_from) + len(node.edges_to)
    return d


def get_node(db: Session, node_id: str) -> KnowledgeNode | None:
    try:
        uid = uuid.UUID(node_id)
    except ValueError:
        return None
    return db.get(KnowledgeNode, uid)


def list_nodes(db: Session, *, category: str | None = None, limit: int = 200) -> list[KnowledgeNode]:
    stmt = select(KnowledgeNode)
    if category:
        stmt = stmt.where(KnowledgeNode.category == category)
    stmt = stmt.order_by(KnowledgeNode.importance.desc(), KnowledgeNode.updated_at.desc()).limit(limit)
    return list(db.scalars(stmt))


def delete_node(db: Session, node_id: str) -> bool:
    node = get_node(db, node_id)
    if not node:
        return False
    db.delete(node)
    db.commit()
    return True


# =========================================================
# Ingest: title check, extract, embed, link
# =========================================================

def ingest_node(
    db: Session,
    *,
    title: str,
    content: str,
    category: str | None = None,
    keywords: list[str] | None = None,
    importance: float = 1.0,
    source: str = "manual",
    auto_link: bool = True,
) -> dict:
    """Create a node with full AI pipeline. Returns ingest summary."""

    # 1) AI title check
    title_check = llm_call("title_check", {"title": title, "content": content})

    # 2) AI extraction (keywords + summary + category hint)
    extracted = llm_call("extract", {"title": title, "content": content})

    final_keywords = list(dict.fromkeys((keywords or []) + extracted.get("keywords", [])))
    final_category = category or extracted.get("category_hint") or "未分类"

    # 3) Embedding
    embed_input = f"{title}\n{content}"
    vec = embed_texts([embed_input])[0].tolist()

    # 4) Persist
    node = KnowledgeNode(
        title=title,
        content=content,
        summary=extracted.get("summary", ""),
        category=final_category,
        keywords=final_keywords,
        embedding=vec,
        importance=max(0.0, min(10.0, importance)),
        source=source,
    )
    db.add(node)
    db.flush()  # need node.id for edges

    # 5) Auto-link to nearest neighbours
    suggested_links: list[dict] = []
    if auto_link:
        suggested_links = auto_link_new_node(db, node)

    # 6) Cluster upsert
    cluster_suggestion = upsert_cluster(db, final_category, final_keywords)

    db.commit()

    return {
        "node": _node_to_dict(node),
        "suggested_links": suggested_links,
        "title_check": title_check,
        "cluster_suggestion": cluster_suggestion,
    }


def auto_link_new_node(db: Session, node: KnowledgeNode, threshold: float | None = None) -> list[dict]:
    """Find the top-K most similar existing nodes and create edges for those
    whose combined similarity exceeds the threshold.

    Combined score = emb_sim * 0.75 + jaccard(keywords) * 0.25
    — gives a small boost when two nodes share explicit domain keywords.
    """
    from sqlalchemy import select
    threshold = threshold if threshold is not None else settings.auto_edge_threshold

    target_vec = list(node.embedding) if node.embedding is not None else []
    target_kw = {k.lower() for k in (node.keywords or [])}

    # SQLAlchemy ORM: pgvector's Vector column handles binding via
    # cosine_distance / l2_distance / max_inner_product.
    dist_col = KnowledgeNode.embedding.cosine_distance(target_vec).label("dist")
    stmt = (
        select(KnowledgeNode, dist_col)
        .where(KnowledgeNode.id != node.id, KnowledgeNode.embedding.is_not(None))
        .order_by("dist")
        .limit(settings.top_k_neighbors)
    )

    applied = []
    for other, dist in db.execute(stmt).all():
        try:
            dist_f = float(dist)
            if dist_f != dist_f:  # NaN
                dist_f = 1.0
        except (TypeError, ValueError):
            dist_f = 1.0
        emb_sim = max(0.0, 1.0 - dist_f)
        # jaccard over keywords — boosts "obviously related" cases like QLoRA/LoRA
        other_kw = {k.lower() for k in (other.keywords or [])}
        if target_kw or other_kw:
            jacc = len(target_kw & other_kw) / max(1, len(target_kw | other_kw))
        else:
            jacc = 0.0
        sim = emb_sim * 0.75 + jacc * 0.25
        if sim < threshold:
            continue
        a, b = sorted([str(node.id), str(other.id)])
        # avoid duplicates (ordered pair)
        existing = db.execute(
            select(KnowledgeEdge).where(
                (KnowledgeEdge.source_node_id == uuid.UUID(a)) &
                (KnowledgeEdge.target_node_id == uuid.UUID(b))
            )
        ).scalar_one_or_none()
        if existing:
            continue
        edge = KnowledgeEdge(
            source_node_id=uuid.UUID(a),
            target_node_id=uuid.UUID(b),
            relation_type="related",
            similarity_score=sim,
            auto_generated=1,
        )
        db.add(edge)
        applied.append({
            "target_id": str(other.id),
            "target_title": other.title,
            "target_category": other.category,
            "similarity": round(sim, 4),
            "applied": True,
        })
    return applied


# =========================================================
# Clusters
# =========================================================

CLUSTER_COLORS = [
    "#7c5cff", "#00d4ff", "#ff5cad", "#ffd166", "#06d6a0",
    "#ef476f", "#118ab2", "#fb8500", "#8338ec", "#3a86ff",
    "#a05195", "#2a9d8f", "#e76f51", "#264653", "#e9c46a",
    "#f4a261", "#b5179e", "#7209b7", "#560bad", "#3a0ca3",
    "#4361ee", "#4895ef", "#4cc9f0", "#f72585",
]


def _pick_color(name: str) -> str:
    """Deterministic, low-collision colour for a category name.

    Uses SHA-256 then a 2nd hash-mod mix to avoid collisions when the
    category count approaches the palette size (MD5 with 24 colours would
    still collide around 5 categories — SHA-256 widens the hash space and
    we use *both* halves for a better spread).
    """
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    h = (int.from_bytes(digest[:8], "big") ^ int.from_bytes(digest[8:16], "big")) % len(CLUSTER_COLORS)
    return CLUSTER_COLORS[h]


def upsert_cluster(db: Session, name: str, keywords: list[str]) -> dict:
    """Insert or update a cluster by name, merge keywords."""
    cluster = db.execute(
        select(CategoryCluster).where(CategoryCluster.name == name)
    ).scalar_one_or_none()

    if not cluster:
        cluster = CategoryCluster(
            name=name,
            description="",
            keywords=sorted(set(keywords)),
            color=_pick_color(name),
            size=0,
        )
        db.add(cluster)
        db.flush()
    else:
        merged = sorted(set((cluster.keywords or []) + keywords))
        cluster.keywords = merged
    # refresh size
    cluster.size = db.execute(
        text("SELECT COUNT(*) FROM knowledge_node WHERE category = :c"), {"c": name}
    ).scalar_one()
    return {"name": cluster.name, "size": cluster.size}


def recompute_clusters(db: Session) -> int:
    """Recompute size + aggregate keywords for every cluster from current nodes."""
    clusters = list(db.scalars(select(CategoryCluster)))
    for c in clusters:
        rows = db.execute(
            text("SELECT keywords FROM knowledge_node WHERE category = :c"),
            {"c": c.name},
        ).fetchall()
        bag: list[str] = []
        for r in rows:
            for kw in (r.keywords or []):
                if kw not in bag:
                    bag.append(kw)
        c.keywords = bag[:50]
        c.size = len(rows)
        c.color = _pick_color(c.name)            # re-roll colour to avoid collisions
    db.commit()
    return len(clusters)


# =========================================================
# Graph layout (3D sphere)
# =========================================================

def _fibonacci_sphere(n: int) -> np.ndarray:
    """Place n points roughly evenly on a sphere using the Fibonacci spiral."""
    if n <= 0:
        return np.zeros((0, 3))
    i = np.arange(n, dtype=float)
    phi = np.arccos(1 - 2 * (i + 0.5) / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    x = np.sin(phi) * np.cos(theta)
    y = np.sin(phi) * np.sin(theta)
    z = np.cos(phi)
    return np.stack([x, y, z], axis=1)


def build_graph_payload(db: Session, category: str | None = None) -> dict:
    """Compose the full payload for the 3D visualisation.

    Nodes are first placed on a Fibonacci sphere, then pulled slightly toward
    their cluster centroid so visually related bubbles cluster together.
    Cluster colours are *reassigned* here so they are guaranteed unique
    across the categories present (the stored cluster.color can collide when
    the palette is smaller than the category count).

    If `category` is given, restrict the payload to nodes whose category
    matches. Edges that touch a node outside the filter are dropped (they
    would be dangling anyway). stats are recomputed from the filtered set
    so the UI doesn't lie.
    """
    if category is not None and category != "":
        all_nodes = list_nodes(db, limit=2000)
        # Force-fetch the category attribute on each row so the SQLAlchemy
        # Column doesn't trip up Pyright's strict boolean check.
        nodes = [
            n for n in all_nodes
            if (getattr(n, "category", None) or "未分类") == category
        ]
    else:
        nodes = list_nodes(db, limit=2000)
    raw_clusters = {c.name: c for c in db.scalars(select(CategoryCluster)).all()}

    n = len(nodes)
    base_pts = _fibonacci_sphere(n) * 5.0  # radius 5

    # per-cluster centroid
    cluster_members: dict[str, list[int]] = defaultdict(list)
    for idx, nd in enumerate(nodes):
        cluster_members[nd.category or "未分类"].append(idx)

    RADIUS = 5.0
    COMPRESS = 0.55  # how much to drag toward centroid (0=none, 1=collapse)
    for name, ids in cluster_members.items():
        if len(ids) < 2:
            continue
        centroid = base_pts[ids].mean(axis=0)
        # re-normalise centroid to the sphere surface so we keep distance to origin
        norm = np.linalg.norm(centroid)
        if norm > 0:
            centroid = centroid / norm * RADIUS
        for i in ids:
            base_pts[i] = base_pts[i] * (1 - COMPRESS) + centroid * COMPRESS
            norm = np.linalg.norm(base_pts[i])
            if norm > 0:
                base_pts[i] = base_pts[i] / norm * RADIUS

    # Sort categories by node-count desc so biggest gets the most saturated colour
    sorted_names = sorted(cluster_members.keys(), key=lambda k: -len(cluster_members[k]))
    name_to_color = {name: _pick_color(name) for name in sorted_names}
    # Resolve collisions by walking the palette
    used = set()
    final_colors: dict[str, str] = {}
    pool = list(CLUSTER_COLORS)
    for name in sorted_names:
        c = name_to_color[name]
        idx = pool.index(c)
        while c in used:
            idx = (idx + 1) % len(pool)
            c = pool[idx]
        used.add(c)
        final_colors[name] = c

    n_descs = []
    for idx, nd in enumerate(nodes):
        cat = nd.category or "未分类"
        n_descs.append({
            "id": str(nd.id),
            "title": nd.title,
            "category": cat,
            "keywords": nd.keywords or [],
            "importance": float(nd.importance or 1.0),
            "x": float(base_pts[idx, 0]),
            "y": float(base_pts[idx, 1]),
            "z": float(base_pts[idx, 2]),
            "cluster_color": final_colors[cat],
        })

    # edges — load all, then drop any that touch a node not in the filtered set
    all_edges = list(db.scalars(select(KnowledgeEdge)))
    if category:
        kept_ids = {str(n.id) for n in nodes}
        edges = [
            e for e in all_edges
            if str(e.source_node_id) in kept_ids and str(e.target_node_id) in kept_ids
        ]
    else:
        edges = all_edges
    edge_descs = [
        {
            "id": str(e.id),
            "source": str(e.source_node_id),
            "target": str(e.target_node_id),
            "similarity_score": float(e.similarity_score or 0.0),
            "relation_type": e.relation_type or "related",
        }
        for e in edges
    ]

    cluster_descs = [
        {
            "id": str(raw_clusters[name].id) if name in raw_clusters else "",
            "name": name,
            "description": (raw_clusters[name].description if name in raw_clusters else ""),
            "keywords": (raw_clusters[name].keywords if name in raw_clusters else []),
            "color": final_colors[name],
            "size": len(cluster_members[name]),
        }
        for name in sorted_names
    ]

    stats = {
        "node_count": len(n_descs),
        "edge_count": len(edge_descs),
        "cluster_count": len(cluster_descs),
        "categories": sorted({nd.category for nd in nodes}),
    }
    return {"nodes": n_descs, "edges": edge_descs, "clusters": cluster_descs, "stats": stats}


# =========================================================
# Assistant: organise, blind-spot, skill-gen
# =========================================================

def assistant_answer(db: Session, question: str, top_k: int = 8) -> dict:
    """Local 'RAG': embed the question, fetch nearest nodes, return a
    deterministic structured answer (no external LLM required)."""
    qvec = embed_texts([question])[0].tolist()
    dist_col = KnowledgeNode.embedding.cosine_distance(qvec).label("dist")
    stmt = (
        select(KnowledgeNode, dist_col)
        .where(KnowledgeNode.embedding.is_not(None))
        .order_by("dist")
        .limit(top_k)
    )
    rows = db.execute(stmt).all()

    related = []
    for n, dist in rows:
        related.append({
            "id": str(n.id),
            "title": n.title,
            "summary": n.summary or (n.content[:120] + "…"),
            "category": n.category,
            "keywords": n.keywords or [],
            "similarity": round(1.0 - float(dist or 0.0), 4),
        })

    # heuristic answer
    if not related:
        answer = "你的第二大脑里还没有相关知识。先新建一些节点，系统就能帮你组织了。"
    else:
        by_cat = defaultdict(list)
        for r in related:
            by_cat[r["category"]].append(r["title"])
        lines = [f"我找到 {len(related)} 条与你问题最相关的知识："]
        for cat, titles in list(by_cat.items())[:6]:
            lines.append(f"  • 【{cat}】" + "、".join(titles[:5]))
        answer = "\n".join(lines)

    # Blind-spot detection: collect every top-level keyword across all nodes
    # and flag the ones NOT covered by the user's question cluster.
    blindspot = detect_blindspots(db, focus_categories=[r["category"] for r in related])
    if blindspot["missing"]:
        answer += "\n\n⚠️  知识盲区提醒：\n" + "\n".join(f"  • {m}" for m in blindspot["missing"][:5])

    return {
        "answer": answer,
        "related_nodes": related,
        "blind_spots": blindspot,
    }


def detect_blindspots(db: Session, *, focus_categories: Iterable[str] | None = None, top: int = 12) -> dict:
    """Return keywords present in many nodes but NOT covered by any node whose
    category is in focus_categories."""
    all_rows = db.execute(text("SELECT category, keywords FROM knowledge_node")).fetchall()
    if not all_rows:
        return {"missing": [], "covered": [], "all_keywords": []}

    focus = set(focus_categories or [])
    global_kw = defaultdict(int)
    focus_kw = set()
    for r in all_rows:
        for kw in (r.keywords or []):
            global_kw[kw] += 1
            if not focus or r.category in focus:
                focus_kw.add(kw)
    common = sorted(global_kw.items(), key=lambda kv: -kv[1])
    missing = [k for k, c in common if c >= 3 and k not in focus_kw][:top]
    covered = [k for k, c in common if k in focus_kw][:top]
    return {
        "missing": missing,
        "covered": covered,
        "all_keywords": [k for k, _ in common[:30]],
    }


def generate_skill(db: Session, focus: str | None = None) -> dict:
    """Distill a personal skill (markdown body) from the user's strongest cluster."""
    if focus:
        cluster_name = focus
    else:
        # pick the largest cluster
        rows = db.execute(text("""
            SELECT category, COUNT(*) AS n FROM knowledge_node
            GROUP BY category ORDER BY n DESC LIMIT 1
        """)).fetchall()
        cluster_name = rows[0][0] if rows else None

    if not cluster_name:
        return {"error": "no nodes to derive a skill from"}

    nodes = list(db.execute(
        text("SELECT id::text, title, summary, content, keywords, importance FROM knowledge_node "
             "WHERE category = :c ORDER BY importance DESC LIMIT 30"),
        {"c": cluster_name},
    ).fetchall())

    kw_count: dict[str, int] = defaultdict(int)
    for n in nodes:
        for kw in (n.keywords or []):
            kw_count[kw] += 1
    top_kws = sorted(kw_count, key=kw_count.get, reverse=True)[:15]

    body = []
    body.append(f"# MySecondBrain Skill: {cluster_name}")
    body.append("")
    body.append(f"> 由 {len(nodes)} 条关于「{cluster_name}」的个人知识自动蒸馏生成。")
    body.append("")
    body.append("## 核心要点")
    for n in nodes[:8]:
        body.append(f"- **{n.title}** — {n.summary or n.content[:80]}")
    body.append("")
    body.append("## 关键术语")
    body.append("、".join(top_kws) or "(暂无)")
    body.append("")
    body.append("## 使用场景")
    body.append(f"当用户问及「{cluster_name}」相关的 {', '.join(top_kws[:5]) or '概念'} 时，参考以上要点作答。")
    body.append("")
    body.append("## 触发关键词")
    body.append(", ".join(top_kws[:10]))

    skill = AISkill(
        name=f"我的{cluster_name}Skill",
        summary=f"基于 {len(nodes)} 条个人知识蒸馏的「{cluster_name}」领域技能包",
        body="\n".join(body),
        trigger=", ".join(top_kws[:10]),
        based_on_nodes=[n.id for n in nodes],
    )
    db.add(skill)
    db.commit()

    return {"skill": skill.to_dict()}


def organise_knowledge(db: Session, *, topic: str | None = None) -> dict:
    """Return a knowledge tree for the given topic (or the whole brain)."""
    nodes = list_nodes(db, limit=2000)
    if topic:
        nodes = [n for n in nodes if topic.lower() in (n.title + " " + n.category).lower()]
    tree: dict[str, list[dict]] = defaultdict(list)
    for n in nodes:
        tree[n.category or "未分类"].append({
            "id": str(n.id),
            "title": n.title,
            "summary": n.summary or "",
            "importance": float(n.importance or 0.0),
        })
    for cat, items in tree.items():
        items.sort(key=lambda x: -x["importance"])
    return {"topic": topic, "tree": tree, "total": len(nodes)}

# ============================================================
# Drafts — transient inbox the user feeds before curation
# ============================================================

def create_draft(db: Session, *, content: str, source: str = "chat", pinned: bool = False) -> KnowledgeDraft:
    d = KnowledgeDraft(content=content, source=source, pinned=1 if pinned else 0)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def list_drafts(db: Session, *, include_promoted: bool = False, limit: int = 500) -> list[KnowledgeDraft]:
    stmt = select(KnowledgeDraft).order_by(
        KnowledgeDraft.pinned.desc(),  # pinned first
        KnowledgeDraft.created_at.desc(),
    ).limit(limit)
    drafts = list(db.scalars(stmt).all())
    if not include_promoted:
        drafts = [d for d in drafts if d.promoted_to_node_id is None]
    return drafts


def get_draft(db: Session, draft_id: str) -> KnowledgeDraft | None:
    try:
        uid = uuid.UUID(draft_id)
    except ValueError:
        return None
    return db.get(KnowledgeDraft, uid)


def update_draft(db: Session, draft_id: str, *, content: str | None = None, pinned: bool | None = None) -> KnowledgeDraft | None:
    d = get_draft(db, draft_id)
    if not d:
        return None
    if content is not None:
        d.content = content
    if pinned is not None:
        d.pinned = 1 if pinned else 0
    db.commit()
    db.refresh(d)
    return d


def delete_draft(db: Session, draft_id: str) -> bool:
    d = get_draft(db, draft_id)
    if not d:
        return False
    db.delete(d)
    db.commit()
    return True


# ----- curation -----

def _group_short_drafts(drafts: list[KnowledgeDraft]) -> list[list[KnowledgeDraft]]:
    """Heuristic: any two drafts with content <= 200 chars created within
    60s of each other are merged into one node. Larger drafts always
    become their own node.

    Returns a list of groups (each group is one or more drafts).
    """
    groups: list[list[KnowledgeDraft]] = []
    pending: list[KnowledgeDraft] = []
    # stable order: created_at asc within the same pinned bucket
    for d in sorted(drafts, key=lambda x: x.created_at):
        if len(d.content or "") <= 200:
            if pending and (d.created_at - pending[-1].created_at).total_seconds() <= 60:
                pending.append(d)
                continue
            # close current pending group, start a new one
            if pending:
                groups.append(pending)
            pending = [d]
        else:
            # flush any pending short-draft group
            if pending:
                groups.append(pending)
                pending = []
            groups.append([d])
    if pending:
        groups.append(pending)
    return groups


def promote_drafts(
    db: Session,
    draft_ids: list[str],
    *,
    body_override: str | None = None,
    importance: float | None = None,
    auto_link: bool = True,
) -> dict:
    """Turn a list of drafts into KnowledgeNodes.
    Returns a dict shaped like PromoteResponse.
    """
    # 1. Load drafts
    drafts: list[KnowledgeDraft] = []
    for did in draft_ids:
        d = get_draft(db, did)
        if d is None:
            continue
        drafts.append(d)
    if not drafts:
        return {"results": [], "promoted_count": 0, "failed_count": len(draft_ids)}

    # 2. Group: short drafts created close together get merged into one node
    groups = _group_short_drafts(drafts)

    results: list[dict] = []
    promoted_count = 0
    failed_count = 0

    for group in groups:
        try:
            # Concatenate content if multiple drafts, join with double newline
            merged_content = "\n\n".join((d.content or "").strip() for d in group if d.content)
            # If user provided a body override, use it instead of the AI/merged content
            content_for_ingest = body_override if body_override is not None else merged_content

            # Use the first draft's source as the node source
            node_source = group[0].source or "draft"

            # 3. Ingest via the standard pipeline (title check, auto-link, etc.)
            ingest_result = ingest_node(
                db,
                title=group[0].content[:60].strip() or "Untitled",  # initial title; AI extract may overwrite
                content=content_for_ingest,
                category=None,  # let AI pick
                keywords=None,
                importance=importance if importance is not None else 1.0,
                source=f"draft:{node_source}",
                auto_link=auto_link,
            )
            new_node = ingest_result["node"]

            # 4. Mark all drafts in this group as promoted + link to new node
            for d in group:
                d.promoted_to_node_id = new_node["id"]
            db.commit()

            # 5. Build per-group result
            results.append({
                "draft_id": str(group[0].id),
                "merged_with": [str(d.id) for d in group[1:]],
                "node": new_node,
                "error": None,
            })
            promoted_count += 1
        except Exception as e:
            failed_count += len(group)
            results.append({
                "draft_id": str(group[0].id),
                "merged_with": [str(d.id) for d in group[1:]],
                "node": None,
                "error": str(e),
            })

    return {"results": results, "promoted_count": promoted_count, "failed_count": failed_count}
