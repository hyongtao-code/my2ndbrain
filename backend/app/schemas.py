"""Pydantic schemas (request/response DTOs)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# -------- Node --------

class NodeCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    category: Optional[str] = None
    keywords: Optional[list[str]] = None
    importance: float = Field(default=1.0, ge=0.0, le=10.0)
    source: str = "manual"
    auto_link: bool = True                 # run AI auto-link after insert


class NodeUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    keywords: Optional[list[str]] = None
    importance: Optional[float] = None


class NodeOut(BaseModel):
    id: str
    title: str
    content: str
    summary: str
    category: str
    keywords: list[str]
    importance: float
    source: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


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
    created_at: Optional[datetime]