"""ORM models for MySecondBrain."""
from __future__ import annotations

import uuid as _uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, Integer, Float, ForeignKey, Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.db.session import Base, Vector


def _uuid_pk():
    return Column(UUID(as_uuid=True), primary_key=True, default=_uuid.uuid4)


class KnowledgeNode(Base):
    __tablename__ = "knowledge_node"

    id = _uuid_pk()
    title = Column(String(255), nullable=False, index=True)
    content = Column(Text, nullable=False, default="")
    summary = Column(Text, default="")
    category = Column(String(128), index=True, default="未分类")
    keywords = Column(JSONB, default=list)            # ["RLHF", "PPO", ...]
    embedding = Column(Vector(384))                   # populated by embedding service
    importance = Column(Float, default=1.0)           # 0..1, used for bubble size
    source = Column(String(64), default="manual")     # manual | import | assistant
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    edges_from = relationship(
        "KnowledgeEdge", foreign_keys="KnowledgeEdge.source_node_id",
        back_populates="source", cascade="all, delete-orphan",
    )
    edges_to = relationship(
        "KnowledgeEdge", foreign_keys="KnowledgeEdge.target_node_id",
        back_populates="target", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_node_category_importance", "category", "importance"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "title": self.title,
            "content": self.content,
            "summary": self.summary or "",
            "category": self.category or "未分类",
            "keywords": self.keywords or [],
            "importance": float(self.importance or 0.0),
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class KnowledgeEdge(Base):
    __tablename__ = "knowledge_edge"

    id = _uuid_pk()
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_node.id", ondelete="CASCADE"), nullable=False, index=True)
    target_node_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_node.id", ondelete="CASCADE"), nullable=False, index=True)
    relation_type = Column(String(64), default="related")   # related | derived_from | contradicts | part_of
    similarity_score = Column(Float, default=0.0)
    auto_generated = Column(Integer, default=1)             # bool flag stored as int
    created_at = Column(DateTime, default=datetime.utcnow)

    source = relationship("KnowledgeNode", foreign_keys=[source_node_id], back_populates="edges_from")
    target = relationship("KnowledgeNode", foreign_keys=[target_node_id], back_populates="edges_to")

    __table_args__ = (
        Index("ux_edge_pair", "source_node_id", "target_node_id", unique=True),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "source": str(self.source_node_id),
            "target": str(self.target_node_id),
            "relation_type": self.relation_type,
            "similarity_score": float(self.similarity_score or 0.0),
            "auto_generated": bool(self.auto_generated),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class CategoryCluster(Base):
    __tablename__ = "category_cluster"

    id = _uuid_pk()
    name = Column(String(128), unique=True, nullable=False)
    description = Column(Text, default="")
    keywords = Column(JSONB, default=list)
    color = Column(String(16), default="#7c5cff")
    size = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "name": self.name,
            "description": self.description or "",
            "keywords": self.keywords or [],
            "color": self.color,
            "size": int(self.size or 0),
        }


class AISkill(Base):
    __tablename__ = "ai_skill"

    id = _uuid_pk()
    name = Column(String(255), nullable=False)
    summary = Column(Text, default="")
    body = Column(Text, default="")          # the generated skill markdown
    trigger = Column(String(255), default="")
    based_on_nodes = Column(JSONB, default=list)  # node ids it was distilled from
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "name": self.name,
            "summary": self.summary or "",
            "body": self.body or "",
            "trigger": self.trigger or "",
            "based_on_nodes": self.based_on_nodes or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }