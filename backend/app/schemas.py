"""Pydantic schemas (request/response DTOs)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# -------- Node --------

class NodeCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    category: str | None = None
    keywords: list[str] | None = None
    importance: float = Field(default=1.0, ge=0.0, le=10.0)
    source: str = "manual"
    auto_link: bool = True                 # run AI auto-link after insert


class NodeUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None
    keywords: list[str] | None = None
    importance: float | None = None


class NodeOut(BaseModel):
    id: str
    title: str
    content: str
    summary: str
    category: str
    keywords: list[str]
    importance: float
    source: str
    created_at: datetime | None
    updated_at: datetime | None


class NodeSummary(BaseModel):
    """Lightweight projection for the 3D graph payload."""
    id: str
    title: str
    category: str
    keywords: list[str]
    importance: float
    # coordinates on the sphere — set by /api/graph layout service
    x: float
    y: float
    z: float
    cluster_color: str = "#7c5cff"


class GraphPayload(BaseModel):
    nodes: list[NodeSummary]
    edges: list[dict]
    clusters: list[dict]
    stats: dict


# -------- Edge --------

class EdgeCreate(BaseModel):
    source_node_id: str
    target_node_id: str
    relation_type: str = "related"
    similarity_score: float = 0.0
    auto_generated: bool = False


class EdgeOut(BaseModel):
    id: str
    source: str
    target: str
    relation_type: str
    similarity_score: float
    auto_generated: bool


# -------- Cluster --------

class ClusterOut(BaseModel):
    id: str
    name: str
    description: str
    keywords: list[str]
    color: str
    size: int


# -------- AI assistant --------

class AssistantRequest(BaseModel):
    question: str
    top_k: int = 8


class AssistantResponse(BaseModel):
    answer: str
    related_nodes: list[NodeOut]
    skills: list[dict] = Field(default_factory=list)


class IngestResponse(BaseModel):
    node: NodeOut
    suggested_links: list[dict]
    title_check: dict
    cluster_suggestion: dict


# -------- Skill --------

class SkillOut(BaseModel):
    id: str
    name: str
    summary: str
    body: str
    trigger: str
    based_on_nodes: list[str]
    created_at: datetime | None

# -------- Draft --------

class DraftCreate(BaseModel):
    content: str = Field(..., min_length=1)
    source: str = Field(default="chat", max_length=32)
    pinned: bool = False


class DraftUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1)
    pinned: bool | None = None


class DraftOut(BaseModel):
    id: str
    content: str
    source: str
    pinned: bool
    promoted_to_node_id: str | None = None
    created_at: datetime | None
    updated_at: datetime | None


# -------- Draft promotion (curation) --------

class PromoteRequest(BaseModel):
    """Promote one or more drafts into real KnowledgeNodes.

    body: when set, replaces the AI-extracted content (lets the user
          override the AI's title/content choice).
    auto_link: run hybrid auto-link on the resulting node.
    importance: explicit importance override; else AI-picked.
    """
    draft_ids: list[str] = Field(..., min_length=1)
    body_override: str | None = None
    importance: float | None = None
    auto_link: bool = True


class PromoteResult(BaseModel):
    """One row in the PromoteResponse.results list."""
    draft_id: str
    merged_with: list[str] = Field(default_factory=list)  # other draft ids merged into this one
    node: dict | None = None   # _node_to_dict() output, only on success
    error: str | None = None


class PromoteResponse(BaseModel):
    results: list[PromoteResult]
    promoted_count: int
    failed_count: int
