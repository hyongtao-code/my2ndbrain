"""Embedding service.

Strategy:
  1. Try to load sentence-transformers/all-MiniLM-L6-v2 locally.
  2. If not installed OR model download fails, fall back to a deterministic
     TF-IDF + TruncatedSVD pipeline (sklearn) that yields the SAME 384 dims
     so the rest of the system doesn't have to special-case anything.

Either way, all vectors are L2-normalised so cosine similarity == dot product.
"""
from __future__ import annotations

import re
import threading
from functools import lru_cache
from typing import Iterable

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer

from app.core.config import get_settings


_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[一-鿿]+")


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


class _BaseEmbedder:
    dim: int

    def encode(self, texts: Iterable[str]) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    @staticmethod
    def _l2(x: np.ndarray) -> np.ndarray:
        n = np.linalg.norm(x, axis=1, keepdims=True)
        n[n == 0.0] = 1.0
        return x / n


class _SentenceTransformerEmbedder(_BaseEmbedder):
    def __init__(self, model_name: str, device: str):
        from sentence_transformers import SentenceTransformer
        self.model = SentenceTransformer(model_name, device=device)
        self.dim = int(self.model.get_sentence_embedding_dimension())

    def encode(self, texts: Iterable[str]) -> np.ndarray:
        vecs = self.model.encode(
            list(texts), convert_to_numpy=True,
            normalize_embeddings=True, show_progress_bar=False,
        )
        return vecs.astype(np.float32)


class _TfidfSvdEmbedder(_BaseEmbedder):
    """Deterministic offline fallback. Fitted on demand from a seed corpus."""

    def __init__(self, dim: int):
        self.dim = dim
        # Newer sklearn (>=1.4) always calls `tokenizer` once more on the
        # preprocessed doc and assumes the preprocessor returns a string.
        # We do lowercase + trivial cleanup in preprocessor and let the
        # default `token_pattern` split into words.
        self.vectorizer = TfidfVectorizer(
            preprocessor=lambda s: (s or "").lower(),
            tokenizer=lambda doc: _tokenize(doc),
            token_pattern=None,
            lowercase=False,
            min_df=1,
            max_df=1.0,
        )
        self.svd: TruncatedSVD | None = None
        self._fitted = False
        self._lock = threading.Lock()
        self._seed_corpus: list[str] = []

    def _ensure_fitted(self) -> None:
        if self._fitted:
            return
        with self._lock:
            if self._fitted:
                return
            seed = list(self._seed_corpus) or [
                "knowledge graph personal brain ai assistant",
                "machine learning deep learning reinforcement learning",
                "python fastapi postgres vector search",
                "transformer attention embedding token language model",
            ]
            self.vectorizer.fit(seed)
            n_features = len(self.vectorizer.vocabulary_)
            n_comp = min(self.dim, max(2, n_features))
            self.svd = TruncatedSVD(n_components=n_comp, random_state=42)
            X = self.vectorizer.transform(seed)
            self.svd.fit(X)
            self._fitted = True

    def add_seed(self, text: str) -> None:
        self._seed_corpus.append(text)

    def encode(self, texts: Iterable[str]) -> np.ndarray:
        self._ensure_fitted()
        texts = list(texts)
        X = self.vectorizer.transform(texts)
        Z = self.svd.transform(X)
        if Z.shape[1] < self.dim:
            pad = np.zeros((Z.shape[0], self.dim - Z.shape[1]), dtype=np.float32)
            Z = np.concatenate([Z.astype(np.float32), pad], axis=1)
        return self._l2(Z)


@lru_cache(maxsize=1)
def get_embedder() -> _BaseEmbedder:
    settings = get_settings()
    try:
        return _SentenceTransformerEmbedder(settings.embed_model, settings.embed_device)
    except Exception as exc:
        print(f"[embedder] sentence-transformers unavailable ({exc.__class__.__name__}: {exc}); using TF-IDF fallback")
        return _TfidfSvdEmbedder(settings.embed_dim)


def embed_texts(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, get_embedder().dim), dtype=np.float32)
    e = get_embedder()
    return e.encode(texts)


def embed_one(text: str) -> list[float]:
    arr = embed_texts([text])
    return arr[0].tolist()


def report_backend() -> str:
    e = get_embedder()
    return f"{type(e).__name__} (dim={e.dim})"